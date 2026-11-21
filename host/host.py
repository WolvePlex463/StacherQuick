"""StacherQuick native messaging host.

Talks to the browser extension over stdin/stdout (Chrome native messaging framing)
and runs yt-dlp / ffmpeg / deno: Stacher7's copies if installed, else StacherQuick\tools or PATH.

One process per browser port. A download runs in a worker thread so the main loop
can still receive {"action": "cancel"} while it is running.
"""
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import threading
import urllib.request

STACHER = os.path.join(os.path.expanduser("~"), ".stacher")
# Our own tools folder (next to host\), for people without Stacher.
OWN_TOOLS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tools")


def find_tool(name):
    """Stacher's copy first, then StacherQuick\\tools, then anything on PATH."""
    for d in (STACHER, OWN_TOOLS):
        p = os.path.join(d, name + ".exe")
        if os.path.exists(p):
            return p
    return shutil.which(name)


YTDLP = find_tool("yt-dlp")
FFMPEG = find_tool("ffmpeg")
DENO = find_tool("deno")
TOOLS_FROM = ("stacher" if YTDLP and YTDLP.startswith(STACHER)
              else "own" if YTDLP and YTDLP.startswith(OWN_TOOLS)
              else "path" if YTDLP else None)

# Same as Stacher's default download format.
VIDEO_FORMAT = "bv*[vcodec^=avc1]+ba[ext=m4a]/bv*+ba/b"

COOKIE_BROWSERS = {"brave", "chrome", "chromium", "edge", "firefox", "opera", "vivaldi", "whale"}
CREATE_NO_WINDOW = 0x08000000

_out_lock = threading.Lock()
_current = {"proc": None, "cancelled": False}


# ---------------------------------------------------------------- messaging
def send(msg):
    data = json.dumps(msg).encode("utf-8")
    with _out_lock:
        sys.stdout.buffer.write(struct.pack("<I", len(data)))
        sys.stdout.buffer.write(data)
        sys.stdout.buffer.flush()


def read():
    raw = sys.stdin.buffer.read(4)
    if len(raw) < 4:
        return None
    (n,) = struct.unpack("<I", raw)
    return json.loads(sys.stdin.buffer.read(n).decode("utf-8"))


# ---------------------------------------------------------------- dialogs
def _tk_root():
    import tkinter

    root = tkinter.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    root.update()
    return root


def pick_folder(initial=None, title="Choose download folder"):
    from tkinter import filedialog

    root = _tk_root()
    path = filedialog.askdirectory(
        parent=root,
        title=title,
        initialdir=initial if initial and os.path.isdir(initial) else os.path.expanduser("~\\Downloads"),
        mustexist=True,
    )
    root.destroy()
    return os.path.normpath(path) if path else None


def pick_file(initial=None):
    from tkinter import filedialog

    root = _tk_root()
    path = filedialog.askopenfilename(
        parent=root,
        title="Choose a cookies.txt file",
        initialdir=os.path.dirname(initial) if initial else os.path.expanduser("~\\Downloads"),
        filetypes=[("Cookies file", "*.txt"), ("All files", "*.*")],
    )
    root.destroy()
    return os.path.normpath(path) if path else None


# ---------------------------------------------------------------- friendly errors
ERRORS = [
    # (pattern, message, needs_login)
    (r"Failed to decrypt with DPAPI|app.bound|AppBound", "This browser encrypts its cookies so yt-dlp can't read them. Pick Firefox or a cookies.txt file under Login cookies.", False),
    (r"could not copy .*cookie database|cookie database is locked|database is locked", "Couldn't read that browser's cookies while it's open. Fully close it (check the tray), or pick Firefox / a cookies.txt file.", False),
    (r"could not find .* cookies database|no cookies found|failed to find .*profile", "No cookies found for that browser. Is it installed and signed in to YouTube?", False),
    (r"Private video", "This video is private. If your account can see it, set Login cookies.", True),
    (r"confirm your age|age.restricted|inappropriate for some users", "Age-restricted video: it needs your YouTube login. Set Login cookies in the popup.", True),
    (r"members.only|Join this channel|available to this channel's members", "Members-only video: needs Login cookies from an account that's a member.", True),
    (r"not a bot|confirm you.re not a bot", "YouTube wants a bot check. Set Login cookies, or update yt-dlp.", True),
    (r"Sign in to|login required|account.*required", "This video needs you to be signed in. Set Login cookies in the popup.", True),
    (r"live event will begin|Premieres in|This live stream recording is not available", "This stream or premiere hasn't started (or isn't saved) yet.", False),
    (r"Video unavailable|video is unavailable|This video has been removed|no longer available|not available in your country|Incomplete YouTube ID", "Video unavailable: removed, blocked in your region, or the link is wrong.", False),
    (r"Unsupported URL|is not a valid URL", "That link isn't something yt-dlp can download.", False),
    (r"Requested format is not available", "That format isn't available for this video. Try another format, or update yt-dlp.", False),
    (r"HTTP Error 403", "YouTube refused the download (403). Updating yt-dlp usually fixes this.", False),
    (r"HTTP Error 429|Too Many Requests", "YouTube is rate-limiting you. Wait a while, or set Login cookies.", False),
    (r"Errno 28|No space left", "Your disk is full.", False),
    (r"Errno 13|Permission denied|being used by another process", "Can't write the file: no permission, or the file is open in another program.", False),
    (r"ffmpeg not found|ffprobe and ffmpeg not found|ffmpeg is not installed", "ffmpeg is missing. Open Stacher once so it reinstalls it, or put ffmpeg.exe in StacherQuick\tools.", False),
    (r"timed out|getaddrinfo|Connection reset|ConnectionError|Network is unreachable|Temporary failure", "Network problem. Check your connection and hit Retry.", False),
    (r"download-sections|Invalid start time|Invalid end time", "The clip times aren't valid for this video.", False),
]


def explain(text):
    for pat, msg, auth in ERRORS:
        if re.search(pat, text, re.I):
            return msg, auth
    return "Download failed.", False


# ---------------------------------------------------------------- yt-dlp
def _secs_label(s):
    s = int(float(s))
    h, rem = divmod(s, 3600)
    m, sec = divmod(rem, 60)
    return ("%dh%02dm%02ds" % (h, m, sec)) if h else ("%dm%02ds" % (m, sec))


def build_args(msg, folder, tempdir, cookies):
    kind = msg.get("format", "mp4")
    url = msg["url"]
    playlist = bool(msg.get("playlist"))
    section = msg.get("section")  # {"start": secs, "end": secs}

    if playlist:
        out = "%(playlist_title|Playlist)s/%(playlist_index|0)03d - %(title)s.%(ext)s"
    elif section:
        out = "%(title)s [clip " + _secs_label(section["start"]) + "-" + _secs_label(section["end"]) + "].%(ext)s"
    else:
        out = "%(title)s.%(ext)s"

    args = [
        YTDLP,
        "--newline", "--no-colors", "--no-simulate", "--progress",
        "--progress-template", "download:SQPROG %(progress._percent_str)s",
        "--print", "before_dl:SQITEM %(playlist_index|0)s/%(n_entries|0)s",
        "--print", "after_move:SQFILE %(filepath)s",
        "-P", folder,
        "-P", "temp:" + tempdir,
        "-o", out,
    ]
    args += ["--yes-playlist", "--ignore-errors"] if playlist else ["--no-playlist"]
    if FFMPEG:
        args[1:1] = ["--ffmpeg-location", FFMPEG]
    if DENO:
        args += ["--js-runtimes", "deno:" + DENO]
    if section:
        args += ["--download-sections", "*%s-%s" % (section["start"], section["end"]), "--force-keyframes-at-cuts"]
    if kind == "mp4":
        args += ["-f", VIDEO_FORMAT, "--merge-output-format", "mp4"]
    elif kind == "mp3":
        args += ["-f", "ba/b", "-x", "--audio-format", "mp3", "--audio-quality", "0"]
    elif kind == "wav":
        args += ["-f", "ba/b", "-x", "--audio-format", "wav"]
    else:
        raise ValueError("unknown format " + kind)
    if cookies:
        src, path = cookies.get("source"), cookies.get("file")
        if src == "file" and path:
            args += ["--cookies", path]
        elif src in COOKIE_BROWSERS:
            args += ["--cookies-from-browser", src]
    args.append(url)
    return args


def kill_tree(proc):
    try:
        subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=CREATE_NO_WINDOW)
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass


def run_once(msg, folder, tempdir, cookies, playlist):
    """Run yt-dlp once. Returns (ok, info dict)."""
    proc = subprocess.Popen(
        build_args(msg, folder, tempdir, cookies),
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
        creationflags=CREATE_NO_WINDOW, text=True, encoding="utf-8", errors="replace",
    )
    _current["proc"] = proc
    files, errors, tail = [], [], []
    last_pct, item, total = -5.0, 0, 0
    for line in proc.stdout:
        line = line.rstrip()
        if not line:
            continue
        tail = (tail + [line])[-25:]
        if line.startswith("SQPROG"):
            m = re.search(r"([\d.]+)%", line)
            if m:
                pct = float(m.group(1))
                if abs(pct - last_pct) >= 2 or pct >= 100:
                    last_pct = pct
                    send({"type": "progress", "percent": pct, "item": item, "total": total,
                          "stage": "converting" if pct >= 100 else ""})
            continue
        if line.startswith("SQFILE "):
            files.append(line[7:].strip())
            continue
        if line.startswith("SQITEM "):
            m = re.match(r"SQITEM (\d+)/(\d+)", line)
            if m:
                item, total, last_pct = int(m.group(1)), int(m.group(2)), -5.0
                send({"type": "progress", "percent": 0, "item": item, "total": total})
            continue
        if line.startswith("ERROR"):
            errors.append(line)
    proc.wait()
    _current["proc"] = None
    text = "\n".join(errors) or "\n".join(tail[-6:])
    ok = proc.returncode == 0 or (playlist and files)
    return ok, {"files": files, "errors": errors, "text": text, "code": proc.returncode, "total": total}


def download(msg):
    _current["cancelled"] = False
    sweep_old_temp()
    kind = msg.get("format", "mp4")
    playlist = bool(msg.get("playlist"))
    folder = msg.get("folder")
    if not folder:
        title = "Choose where to save the %s" % ("audio" if kind in ("mp3", "wav") else "video")
        folder = pick_folder(msg.get("lastFolder"), title)
        if not folder:
            send({"type": "cancelled", "reason": "no-folder"})
            return
    try:
        os.makedirs(folder, exist_ok=True)
    except OSError as e:
        send({"type": "error", "error": "Can't use that folder: %s" % e.strerror, "detail": str(e)})
        return
    send({"type": "started", "folder": folder})

    tempdir = os.path.join(os.environ.get("TEMP", folder), "stacherquick-%d" % os.getpid())
    cookies = msg.get("cookies") or {}
    use_cookies_now = cookies.get("always") and cookies.get("source") not in (None, "", "none")
    try:
        ok, info = run_once(msg, folder, tempdir, cookies if use_cookies_now else None, playlist)
        if _current["cancelled"]:
            send({"type": "cancelled"})
            return
        friendly, needs_login = explain(info["text"])
        # Retry once with login cookies when the video needs sign-in.
        if not ok and needs_login and not use_cookies_now and cookies.get("source") not in (None, "", "none"):
            send({"type": "progress", "percent": 0, "stage": "retrying with login cookies"})
            ok, info = run_once(msg, folder, tempdir, cookies, playlist)
            if _current["cancelled"]:
                send({"type": "cancelled"})
                return
            friendly, needs_login = explain(info["text"])

        if ok:
            files = info["files"]
            last = files[-1] if files else None
            result = {"type": "done", "file": last, "name": os.path.basename(last) if last else None, "folder": folder}
            if playlist:
                result.update({
                    "folder": os.path.dirname(last) if last else folder,
                    "count": len(files),
                    "failed": len(info["errors"]),
                    "total": info["total"],
                })
            send(result)
        else:
            send({"type": "error", "error": friendly, "detail": info["text"][-1500:], "needsLogin": needs_login})
    finally:
        remove_dir(tempdir)


def remove_dir(path):
    import time
    for _ in range(10):  # ffmpeg can hold files for a moment after a cancel
        shutil.rmtree(path, ignore_errors=True)
        if not os.path.exists(path):
            return
        time.sleep(0.5)


def sweep_old_temp():
    import time
    base = os.environ.get("TEMP")
    if not base:
        return
    try:
        for name in os.listdir(base):
            p = os.path.join(base, name)
            if name.startswith("stacherquick-") and os.path.isdir(p) and time.time() - os.path.getmtime(p) > 6 * 3600:
                shutil.rmtree(p, ignore_errors=True)
    except OSError:
        pass


# ---------------------------------------------------------------- yt-dlp updates
def _ver_tuple(v):
    return tuple(int(x) for x in re.findall(r"\d+", v or ""))


def ytdlp_status():
    if not YTDLP:
        return {"type": "ytdlp", "current": None, "latest": None, "channel": None, "checkError": "yt-dlp not found"}
    cur = subprocess.run([YTDLP, "--version"], capture_output=True, text=True,
                         creationflags=CREATE_NO_WINDOW, timeout=60).stdout.strip()
    nightly = bool(re.match(r"^\d{4}\.\d{2}\.\d{2}\.\d+$", cur))
    repo = "yt-dlp/yt-dlp-nightly-builds" if nightly else "yt-dlp/yt-dlp"
    latest = None
    try:
        req = urllib.request.Request(
            "https://api.github.com/repos/%s/releases/latest" % repo,
            headers={"User-Agent": "StacherQuick", "Accept": "application/vnd.github+json"},
        )
        with urllib.request.urlopen(req, timeout=15) as r:
            latest = json.load(r).get("tag_name")
    except Exception as e:
        return {"type": "ytdlp", "current": cur, "channel": "nightly" if nightly else "stable", "latest": None, "checkError": str(e)}
    return {
        "type": "ytdlp", "current": cur, "latest": latest, "channel": "nightly" if nightly else "stable",
        "updateAvailable": bool(latest) and _ver_tuple(latest) > _ver_tuple(cur),
    }


def ytdlp_update():
    r = subprocess.run([YTDLP, "-U"], capture_output=True, text=True, creationflags=CREATE_NO_WINDOW, timeout=300)
    out = (r.stdout + r.stderr).strip()
    st = ytdlp_status()
    st["type"] = "ytdlpUpdated"
    st["ok"] = r.returncode == 0
    st["log"] = out[-800:]
    return st


# ---------------------------------------------------------------- main loop
def main():
    worker = None
    while True:
        msg = read()
        if msg is None:
            # Browser closed the port: stop any running download.
            if _current["proc"]:
                _current["cancelled"] = True
                kill_tree(_current["proc"])
            if worker:
                worker.join(timeout=10)
            return
        action = msg.get("action")
        try:
            if action == "ping":
                send({"type": "pong", "ytdlp": bool(YTDLP), "ffmpeg": bool(FFMPEG), "deno": bool(DENO), "from": TOOLS_FROM})
            elif action == "pickFolder":
                send({"type": "folder", "folder": pick_folder(msg.get("initial"), msg.get("title") or "Choose download folder")})
            elif action == "pickFile":
                send({"type": "file", "file": pick_file(msg.get("initial"))})
            elif action == "reveal":
                path = msg.get("path")
                if path and os.path.exists(path):
                    subprocess.Popen(["explorer", "/select,", path])
                elif msg.get("folder") and os.path.isdir(msg["folder"]):
                    os.startfile(msg["folder"])
                send({"type": "ok"})
            elif action == "open":
                path = msg.get("path")
                if path and os.path.exists(path):
                    os.startfile(path)
                    send({"type": "ok"})
                else:
                    send({"type": "error", "error": "That file isn't there any more."})
            elif action == "ytdlpStatus":
                send(ytdlp_status())
            elif action == "ytdlpUpdate":
                send(ytdlp_update())
            elif action == "download":
                worker = threading.Thread(target=_safe_download, args=(msg,), daemon=True)
                worker.start()
            elif action == "cancel":
                _current["cancelled"] = True
                if _current["proc"]:
                    kill_tree(_current["proc"])
                else:
                    send({"type": "cancelled"})
            else:
                send({"type": "error", "error": "unknown action"})
        except Exception as e:  # report instead of dying silently
            send({"type": "error", "error": "%s: %s" % (type(e).__name__, e)})


def _safe_download(msg):
    try:
        download(msg)
    except Exception as e:
        send({"type": "error", "error": "Helper error: %s" % e, "detail": repr(e)})


if __name__ == "__main__":
    main()
