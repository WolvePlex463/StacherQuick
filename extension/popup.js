const $ = (s) => document.querySelector(s);
const send = (m) => chrome.runtime.sendMessage(m);

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function btn(label, onClick, cls = "small") {
  const b = el("button", cls, label);
  b.addEventListener("click", onClick);
  return b;
}

// ---------------- settings ----------------
async function renderSettings() {
  const s = await chrome.storage.local.get([
    "mode", "folder", "audioFolder", "audioSame", "cookiesSource", "cookiesFile", "cookiesAlways", "lastFormat",
  ]);
  const mode = s.mode || "folder";
  document.querySelectorAll(".seg button").forEach((b) => b.classList.toggle("on", b.dataset.mode === mode));
  $("#folders").hidden = mode !== "folder";
  $("#askNote").hidden = mode !== "ask";

  const vp = $("#videoPath");
  vp.textContent = s.folder || "Not set: you'll be asked once";
  vp.title = s.folder || "";
  vp.classList.toggle("dim", !s.folder);
  $("#pickVideo").textContent = s.folder ? "Change" : "Set";

  const audioSame = s.audioSame !== false || !s.audioFolder;
  const ap = $("#audioPath");
  ap.textContent = audioSame ? "Same as video" : s.audioFolder;
  ap.title = audioSame ? "" : s.audioFolder;
  ap.classList.toggle("dim", audioSame);
  $("#pickAudio").textContent = audioSame ? "Set" : "Change";
  $("#resetAudio").hidden = audioSame;

  const src = s.cookiesSource || "none";
  $("#cookieSource").value = src;
  $("#cookieFileRow").hidden = src !== "file";
  $("#cookieFilePath").textContent = s.cookiesFile || "No file chosen";
  $("#cookieFilePath").title = s.cookiesFile || "";
  $("#cookieFilePath").classList.toggle("dim", !s.cookiesFile);
  $("#cookieAlwaysRow").hidden = src === "none";
  $("#cookieAlways").checked = !!s.cookiesAlways;
  const chromiumWarn = ["chrome", "edge", "brave", "opera", "vivaldi", "chromium", "whale"].includes(src);
  $("#cookieNote").textContent =
    src === "none"
      ? "For age-restricted, members-only and private videos. Off: those downloads will fail."
      : chromiumWarn
      ? "Chromium browsers lock and encrypt their cookies on Windows. If it fails, close that browser fully, or use Firefox / a cookies.txt file."
      : src === "file"
      ? "Export a cookies.txt from youtube.com with a cookies.txt extension while signed in."
      : "Used only when a video needs sign-in, unless 'every download' is ticked.";
  $("#cookieNote").classList.toggle("warn", chromiumWarn);

  $("#lastFmt").textContent = (s.lastFormat || "mp4").toUpperCase();
}

document.querySelectorAll(".seg button").forEach((b) =>
  b.addEventListener("click", async () => {
    await chrome.storage.local.set({ mode: b.dataset.mode });
    renderSettings();
  })
);

async function pickInto(key, title) {
  const cur = (await chrome.storage.local.get(key))[key];
  const res = await send({ type: "pickFolder", initial: cur, title });
  if (res && res.folder) {
    const patch = { [key]: res.folder, mode: "folder" };
    if (key === "audioFolder") patch.audioSame = false;
    await chrome.storage.local.set(patch);
  }
  renderSettings();
}
$("#pickVideo").addEventListener("click", () => pickInto("folder", "Folder for videos (MP4)"));
$("#pickAudio").addEventListener("click", () => pickInto("audioFolder", "Folder for audio (MP3 / WAV)"));
$("#resetAudio").addEventListener("click", async () => {
  await chrome.storage.local.set({ audioSame: true });
  renderSettings();
});
for (const [id, key] of [["#videoPath", "folder"], ["#audioPath", "audioFolder"]]) {
  $(id).addEventListener("click", async () => {
    const v = (await chrome.storage.local.get(key))[key];
    if (v && !$(id).classList.contains("dim")) send({ type: "reveal", folder: v });
  });
}

$("#cookieSource").addEventListener("change", async (e) => {
  const v = e.target.value;
  await chrome.storage.local.set({ cookiesSource: v });
  if (v === "file" && !(await chrome.storage.local.get("cookiesFile")).cookiesFile) pickCookieFile();
  renderSettings();
});
async function pickCookieFile() {
  const cur = (await chrome.storage.local.get("cookiesFile")).cookiesFile;
  const res = await send({ type: "pickFile", initial: cur });
  if (res && res.file) await chrome.storage.local.set({ cookiesFile: res.file });
  renderSettings();
}
$("#pickCookieFile").addEventListener("click", pickCookieFile);
$("#cookieAlways").addEventListener("change", (e) => chrome.storage.local.set({ cookiesAlways: e.target.checked }));

$("#shortcuts").addEventListener("click", () => send({ type: "openShortcuts" }));
chrome.commands.getAll((cmds) => {
  const c = cmds.find((x) => x.name === "download-last");
  $("#kbd").textContent = (c && c.shortcut) || "Not set";
});

// ---------------- jobs ----------------
const TAG = (j) => [j.kind.toUpperCase(), j.playlist ? "PLAYLIST" : "", j.section ? "CLIP" : ""].filter(Boolean).join(" · ");

function statusText(j) {
  const items = j.total > 1 ? `Item ${j.item || 1} of ${j.total} · ` : "";
  switch (j.status) {
    case "waiting": return "Waiting for you to pick a folder…";
    case "downloading":
      if (j.stage === "retrying with login cookies") return "Needs sign-in: retrying with login cookies…";
      if (j.stage === "converting") return items + "Converting…";
      return items + `${Math.round(j.percent || 0)}%`;
    case "done":
      if (j.playlist) return `Done · ${j.count || 0} file${j.count === 1 ? "" : "s"}` + (j.failed ? ` · ${j.failed} unavailable` : "");
      return "Done";
    case "cancelled": return "Cancelled";
    case "error": return j.error || "Failed";
  }
  return "";
}

async function renderJobs() {
  const { jobs = [] } = await chrome.storage.local.get("jobs");
  const ul = $("#jobs");
  ul.textContent = "";
  $("#empty").hidden = jobs.length > 0;
  for (const j of jobs) {
    const li = el("li", j.status);
    const t = el("div", "t");
    t.append(el("span", "tag", TAG(j)), el("span", "name", j.title || (j.file ? j.file.split(/[\\/]/).pop() : j.url)));
    t.lastChild.title = j.title || j.url;
    li.append(t, el("div", "sub" + (j.status === "error" ? " err" : ""), statusText(j)));
    if (j.status === "downloading") {
      const bar = el("div", "bar");
      const fill = el("i");
      const overall = j.total > 1 ? (((j.item || 1) - 1) + (j.percent || 0) / 100) / j.total * 100 : j.percent || 0;
      fill.style.width = Math.min(100, overall) + "%";
      bar.append(fill);
      li.append(bar);
    }
    if (j.status === "error" && j.detail) {
      const d = el("details");
      d.append(el("summary", "", "Details"), el("pre", "", j.detail));
      li.append(d);
    }
    const acts = el("div", "acts");
    if (j.status === "downloading" || j.status === "waiting") acts.append(btn("Cancel", () => send({ type: "cancel", id: j.id })));
    if (j.status === "error" || j.status === "cancelled") acts.append(btn("Retry", () => send({ type: "retry", id: j.id })));
    if (j.status === "done") {
      if (j.file && !j.playlist) acts.append(btn("Open", () => send({ type: "open", path: j.file })));
      acts.append(btn("Show in folder", () => send({ type: "reveal", path: j.playlist ? null : j.file, folder: j.folder })));
    }
    if (acts.children.length) li.append(acts);
    ul.append(li);
  }
}

$("#clear").addEventListener("click", async () => {
  const { jobs = [] } = await chrome.storage.local.get("jobs");
  await chrome.storage.local.set({ jobs: jobs.filter((j) => j.status === "downloading" || j.status === "waiting") });
});

// ---------------- yt-dlp version ----------------
function renderYtdlp(r) {
  const line = $("#ytdlpLine");
  line.textContent = "";
  if (!r || !r.current) {
    line.append(el("span", "", "yt-dlp: couldn't check version"));
    return;
  }
  const state = r.updateAvailable ? "update available" : r.latest ? "up to date" : "couldn't reach GitHub";
  line.append(el("span", "", `yt-dlp ${r.current} (${r.channel}) · ${state}`));
  line.append(btn("Check", () => checkYtdlp(true), "link"));
  $("#updateBanner").hidden = !r.updateAvailable;
  $("#updateText").textContent = `yt-dlp update: ${r.current} → ${r.latest}`;
}
async function checkYtdlp(force) {
  if (force) $("#ytdlpLine").firstChild && ($("#ytdlpLine").firstChild.textContent = "Checking yt-dlp…");
  renderYtdlp(await send({ type: "ytdlpStatus", force }));
}
$("#updateBtn").addEventListener("click", async () => {
  const b = $("#updateBtn");
  b.disabled = true;
  b.textContent = "Updating…";
  const r = await send({ type: "ytdlpUpdate" });
  b.disabled = false;
  b.textContent = "Update";
  renderYtdlp(r);
  if (r && r.ok === false) $("#updateText").textContent = "Update failed. Close Stacher if it's downloading, then try again.";
});

// ---------------- init ----------------
chrome.storage.onChanged.addListener((changes) => {
  if (changes.jobs) renderJobs();
  if (Object.keys(changes).some((k) => k !== "jobs" && k !== "ytdlp")) renderSettings();
});
renderSettings();
renderJobs();
checkYtdlp(false);

send({ type: "ping" }).then((r) => {
  const ok = r && r.type === "pong" && r.ytdlp && r.ffmpeg;
  $("#health").className = "dot " + (ok ? "ok" : "bad");
  $("#health").title = ok
    ? "Helper connected · " + ({ stacher: "using Stacher's yt-dlp", own: "using StacherQuick\tools", path: "using yt-dlp from PATH" }[r.from] || "ready")
    : r && r.type === "pong"
    ? "Helper connected, but " + (!r.ytdlp ? "yt-dlp" : "ffmpeg") + " wasn't found. Run setup.bat again."
    : "Helper not reachable: " + ((r && r.error) || "run setup.bat");
});
