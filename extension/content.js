// StacherQuick: adds download options to
//   1. every ⋮ three-dot menu on YouTube (feeds, search, sidebar, playlists, watch page)
//   2. the video player's own right-click menu (Loop, Miniplayer, Stats for nerds…)
// plus a "Clip a section" dialog. Built with DOM calls only: YouTube enforces Trusted Types.
(() => {
  const FORMATS = [
    ["mp4", "MP4", "Video"],
    ["mp3", "MP3", "Audio"],
    ["wav", "WAV", "Lossless audio"],
  ];
  // Rows we add are tagged with this, so after an extension update the page's leftover
  // rows from the old version get rebuilt instead of reused.
  const BUILD = chrome.runtime.getManifest().version;
  // After the extension is reloaded, the old copy of this script keeps running in open
  // tabs with a dead connection. It must stop touching the page.
  const alive = () => {
    try {
      return !!chrome.runtime.id;
    } catch (_) {
      return false;
    }
  };

  const ICON_DL = "M12 3a1 1 0 0 1 1 1v9.59l3.3-3.3a1 1 0 1 1 1.4 1.42l-5 5a1 1 0 0 1-1.4 0l-5-5a1 1 0 1 1 1.4-1.42l3.3 3.3V4a1 1 0 0 1 1-1zM5 19h14a1 1 0 1 1 0 2H5a1 1 0 1 1 0-2z";
  const ICON_LIST = "M4 6h12v2H4zm0 5h12v2H4zm0 5h8v2H4zm14-2 4 3-4 3z";

  function icon(d = ICON_DL) {
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "24");
    svg.setAttribute("height", "24");
    svg.setAttribute("aria-hidden", "true");
    const p = document.createElementNS(NS, "path");
    p.setAttribute("fill", "currentColor");
    p.setAttribute("d", d);
    svg.appendChild(p);
    return svg;
  }
  function el(tag, cls, ...kids) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    for (const k of kids) e.append(k);
    return e;
  }

  // Elements that represent one video (or playlist) somewhere on YouTube.
  const VIDEO_CONTAINERS = [
    "ytd-rich-item-renderer", "ytd-video-renderer", "ytd-compact-video-renderer", "ytd-grid-video-renderer",
    "ytd-playlist-video-renderer", "ytd-playlist-panel-video-renderer", "ytd-reel-item-renderer",
    "ytd-movie-renderer", "ytd-compact-movie-renderer", "yt-lockup-view-model", "ytm-shorts-lockup-view-model",
    "ytm-shorts-lockup-view-model-v2", "ytd-video-preview", "ytd-reel-video-renderer",
    "ytd-playlist-renderer", "ytd-compact-playlist-renderer", "ytd-grid-playlist-renderer",
  ].join(",");

  function send(url, format, opts = {}) {
    if (!url) return toast("Couldn't find the video for this menu");
    chrome.runtime.sendMessage({ type: "download", url, format, ...opts });
    toast(`${format.toUpperCase()}${opts.playlist ? " playlist" : opts.section ? " clip" : ""} download started`);
  }

  function linkOf(node) {
    if (!node) return null;
    const a = node.querySelector('a[href*="/watch?v="], a[href*="/shorts/"], a[href*="/playlist?list="]');
    return a ? new URL(a.getAttribute("href"), location.origin).href : null;
  }

  function currentPageVideo() {
    if (location.pathname === "/watch" || location.pathname.startsWith("/shorts/")) return location.href;
    return null;
  }

  function hasVideo(url) {
    try {
      const u = new URL(url);
      return !!u.searchParams.get("v") || /^\/(shorts|live)\//.test(u.pathname);
    } catch (_) {
      return false;
    }
  }
  function hasList(url) {
    try {
      return !!new URL(url).searchParams.get("list");
    } catch (_) {
      return false;
    }
  }

  let hovered = null; // last video card under the mouse (for hover-preview players on the home feed)
  document.addEventListener(
    "mouseover",
    (e) => {
      const c = e.target.closest && e.target.closest(VIDEO_CONTAINERS);
      if (c && c.tagName !== "YTD-VIDEO-PREVIEW") hovered = c;
    },
    true
  );

  // Which video does an element (a ⋮ button, a right-clicked player…) belong to?
  function videoFor(node) {
    if (!node || !node.closest) return currentPageVideo();
    if (node.closest("ytd-comments, ytd-comment-view-model, ytd-comment-thread-renderer")) return null;
    if (node.closest("ytd-watch-metadata")) return currentPageVideo();
    if (node.closest(".html5-video-player")) {
      if (location.pathname === "/watch") return location.href;
      if (node.closest("ytd-reel-video-renderer") || location.pathname.startsWith("/shorts/")) return location.href;
      return linkOf(hovered) || currentPageVideo();
    }
    const c = node.closest(VIDEO_CONTAINERS);
    return linkOf(c) || (node.closest("ytd-reel-video-renderer") ? currentPageVideo() : null);
  }

  // ---------- small toast ----------
  let toastEl, toastTimer;
  function toast(text) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.id = "sq-toast";
      document.documentElement.appendChild(toastEl);
    }
    toastEl.textContent = text;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2200);
  }

  function chip(label, title, onClick, extraCls = "") {
    const b = el("button", "sq-chip " + extraCls, label);
    b.type = "button";
    b.title = title;
    b.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });
    // keep YouTube from treating the press as a menu-item activation
    b.addEventListener("mousedown", (e) => e.stopPropagation());
    return b;
  }

  // MP4 / MP3 / WAV (+ optional ✂ Clip) chips.
  function formatChips(onPick, onClip) {
    const wrap = el("span", "sq-chips");
    for (const [f, label, hint] of FORMATS) wrap.appendChild(chip(label, hint, () => onPick(f)));
    if (onClip) wrap.appendChild(chip("✂ Clip", "Download only part of the video", onClip, "sq-chip-clip"));
    return wrap;
  }

  // =========================================================
  // Clip dialog
  // =========================================================
  function parseTime(s) {
    s = String(s).trim();
    if (!s) return NaN;
    if (/^\d+(\.\d+)?$/.test(s)) return +s;
    const parts = s.split(":").map(Number);
    if (parts.some((n) => isNaN(n))) return NaN;
    return parts.reduce((acc, n) => acc * 60 + n, 0);
  }
  // 75.4 -> "1:15.4" (tenths only when they aren't zero)
  function fmtTime(t, tenths = true) {
    t = Math.max(0, Math.round(t * 10) / 10);
    const whole = Math.floor(t), frac = Math.round((t - whole) * 10);
    const h = Math.floor(whole / 3600), m = Math.floor((whole % 3600) / 60), s = whole % 60;
    const mm = String(m).padStart(h ? 2 : 1, "0"), ss = String(s).padStart(2, "0");
    return (h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`) + (tenths && frac ? "." + frac : "");
  }
  function pageVideoEl() {
    return document.querySelector("#movie_player video, .html5-video-player video");
  }
  function videoIdOf(url) {
    try {
      const u = new URL(url);
      return u.searchParams.get("v") || (u.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]{6,})/) || [])[1] || null;
    } catch (_) {
      return null;
    }
  }

  // Small wrapper around a YouTube embed, driven through its postMessage API.
  function embedPlayer(id, startAt, onUpdate) {
    const frame = el("iframe", "sq-clip-frame");
    frame.allow = "autoplay; encrypted-media";
    frame.src =
      `https://www.youtube.com/embed/${encodeURIComponent(id)}?enablejsapi=1&controls=0&disablekb=1&rel=0` +
      `&playsinline=1&iv_load_policy=3&fs=0&start=${Math.floor(startAt)}&origin=${encodeURIComponent(location.origin)}`;
    const st = { t: startAt, dur: 0, playing: false, error: null, at: performance.now() };
    const post = (m) => frame.contentWindow && frame.contentWindow.postMessage(JSON.stringify({ ...m, id: "sq", channel: "widget" }), "*");
    const onMsg = (e) => {
      if (e.source !== frame.contentWindow) return;
      let d;
      try {
        d = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
      } catch (_) {
        return;
      }
      if (!d) return;
      if (d.event === "onError") st.error = d.info;
      const i = d.info;
      if (d.event === "infoDelivery" && i) {
        if (typeof i.currentTime === "number") {
          st.t = i.currentTime;
          st.at = performance.now();
        }
        if (i.duration) st.dur = i.duration;
        if (typeof i.playerState === "number") st.playing = i.playerState === 1;
      }
      onUpdate();
    };
    window.addEventListener("message", onMsg);
    frame.addEventListener("load", () => {
      post({ event: "listening" });
      // Keep asking until the player answers (it ignores us while it's still booting).
      let n = 0;
      const ping = setInterval(() => (st.dur || ++n > 20 ? clearInterval(ping) : post({ event: "listening" })), 250);
    });
    const cmd = (func, args = []) => post({ event: "command", func, args });
    return {
      frame,
      st,
      // currentTime, extrapolated between the player's ~4/s reports so the playhead moves smoothly
      now: () => (st.playing ? st.t + (performance.now() - st.at) / 1000 : st.t),
      seek(t) {
        st.t = t;
        st.at = performance.now();
        cmd("seekTo", [t, true]);
      },
      play: () => cmd("playVideo"),
      pause: () => {
        st.playing = false;
        cmd("pauseVideo");
      },
      destroy: () => window.removeEventListener("message", onMsg),
    };
  }

  // Preview straight from the video on this page: frames are drawn onto a canvas, and
  // play/seek drive the page's own player. No embed needed, so it always works.
  function pagePlayer(video, onUpdate) {
    const canvas = el("canvas", "sq-clip-frame");
    const ctx = canvas.getContext("2d");
    const evs = ["play", "pause", "seeked", "durationchange", "loadedmetadata"];
    evs.forEach((e) => video.addEventListener(e, onUpdate));
    return {
      frame: canvas,
      st: {
        get dur() {
          return isFinite(video.duration) ? video.duration : 0;
        },
        get playing() {
          return !video.paused;
        },
        error: null,
      },
      now: () => video.currentTime,
      seek: (t) => (video.currentTime = t),
      play: () => video.play().catch(() => {}),
      pause: () => video.pause(),
      draw() {
        const dpr = devicePixelRatio || 1;
        const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
        if (!w || !h) return;
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, w, h);
        const vw = video.videoWidth, vh = video.videoHeight;
        if (!vw || !vh) return;
        const k = Math.min(w / vw, h / vh), dw = vw * k, dh = vh * k;
        try {
          ctx.drawImage(video, (w - dw) / 2, (h - dh) / 2, dw, dh);
        } catch (_) {}
      },
      destroy: () => evs.forEach((e) => video.removeEventListener(e, onUpdate)),
    };
  }

  function openClip(url, samePage) {
    document.getElementById("sq-clip")?.remove();
    const id = videoIdOf(url);
    const pageVid = samePage ? pageVideoEl() : null;
    const now = pageVid ? pageVid.currentTime : 0;
    const wasPlaying = pageVid && !pageVid.paused;
    if (wasPlaying) pageVid.pause();

    let dur = pageVid && isFinite(pageVid.duration) ? pageVid.duration : 0;
    let a = now, b = dur ? Math.min(dur, now + 30) : now + 30;
    let looping = false;

    const startIn = el("input", "sq-in");
    const endIn = el("input", "sq-in");
    for (const i of [startIn, endIn]) {
      i.placeholder = "m:ss";
      i.spellcheck = false;
    }
    const lenLabel = el("span", "sq-len");
    const err = el("div", "sq-err");

    // ---- preview ----
    const screen = el("div", "sq-clip-screen");
    // The video you're watching previews from the page's own player; any other video
    // (from a feed's ⋮ menu) needs a YouTube embed.
    const player = pageVid ? pagePlayer(pageVid, () => render()) : id ? embedPlayer(id, a, () => render()) : null;
    if (player) screen.append(player.frame);
    const note = el("div", "sq-clip-note", player ? "Loading preview…" : "No preview for this link.");
    screen.append(note);

    // ---- timeline ----
    const sel = el("div", "sq-tl-sel");
    const hA = el("div", "sq-tl-h sq-tl-a");
    const hB = el("div", "sq-tl-h sq-tl-b");
    const head = el("div", "sq-tl-head");
    const track = el("div", "sq-tl", el("div", "sq-tl-bar"), sel, head, hA, hB);
    const tlStart = el("span", "", "0:00");
    const tlEnd = el("span", "", "");
    const playBtn = chip("▶ Play clip", "Play the selected part (Space)", () => togglePlay(), "sq-play");
    const loopBtn = chip("↻ Loop", "Repeat the clip while previewing", () => {
      looping = !looping;
      loopBtn.classList.toggle("on", looping);
    }, "sq-ghost");
    const setA = chip("[ Set start", "Start the clip at the playhead ( [ )", () => setFromHead("a"), "sq-ghost");
    const setB = chip("Set end ]", "End the clip at the playhead ( ] )", () => setFromHead("b"), "sq-ghost");

    const clampAll = () => {
      const max = dur || Infinity;
      a = Math.max(0, Math.min(a, max));
      b = Math.max(0, Math.min(b, max));
      if (b - a < 0.5) b = Math.min(max, a + 0.5);
      if (b - a < 0.5) a = Math.max(0, b - 0.5);
    };
    const pct = (t) => (dur ? (t / dur) * 100 : 0) + "%";

    function render(fromInput) {
      if (player) {
        if (player.st.dur && !dur) {
          dur = player.st.dur;
          clampAll();
        }
        if (player.st.error) {
          note.textContent =
            player.st.error === 101 || player.st.error === 150
              ? "This video can't be previewed here (the uploader turned off embedding). You can still type the times."
              : "Preview unavailable. You can still type the times.";
          note.hidden = false;
          screen.classList.add("off");
        } else note.hidden = !!player.st.dur;
      }
      track.classList.toggle("off", !dur);
      sel.style.left = pct(a);
      sel.style.width = dur ? ((b - a) / dur) * 100 + "%" : "0";
      hA.style.left = pct(a);
      hB.style.left = pct(b);
      if (!fromInput) {
        if (document.activeElement !== startIn) startIn.value = fmtTime(a);
        if (document.activeElement !== endIn) endIn.value = fmtTime(b);
      }
      tlEnd.textContent = dur ? fmtTime(dur, false) : "";
      lenLabel.textContent = "Length " + fmtTime(b - a);
      playBtn.textContent = player && player.st.playing ? "❚❚ Pause" : "▶ Play clip";
    }

    // playhead + stop/loop at the clip's end
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (player && player.draw) player.draw();
      if (!player || !dur) return;
      const t = player.now();
      head.style.left = pct(Math.min(t, dur));
      if (player.st.playing && t >= b) {
        if (looping) player.seek(a);
        else {
          player.pause();
          player.seek(b);
          render();
        }
      }
    };
    raf = requestAnimationFrame(tick);

    function togglePlay() {
      if (!player || player.st.error) return;
      if (player.st.playing) return player.pause(), render();
      const t = player.now();
      if (t < a - 0.05 || t >= b - 0.05) player.seek(a);
      player.play();
    }
    function setFromHead(which) {
      if (!player || !dur) return;
      const t = player.now();
      if (which === "a") {
        a = t;
        if (b <= a + 0.5) b = Math.min(dur, a + 30);
      } else {
        b = t;
        if (b <= a + 0.5) a = Math.max(0, b - 30);
      }
      clampAll();
      render();
    }

    // dragging the handles / clicking the bar
    const timeAt = (clientX) => {
      const r = track.getBoundingClientRect();
      return Math.round(Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * dur * 10) / 10;
    };
    const drag = (handle, which) =>
      handle.addEventListener("pointerdown", (e) => {
        if (!dur) return;
        e.preventDefault();
        e.stopPropagation();
        handle.setPointerCapture(e.pointerId);
        if (player) player.pause();
        handle.classList.add("drag");
        const move = (ev) => {
          const t = timeAt(ev.clientX);
          if (which === "a") a = Math.min(t, b - 0.5);
          else b = Math.max(t, a + 0.5);
          clampAll();
          if (player) player.seek(which === "a" ? a : b); // live scrub so you can see the frame
          render();
        };
        const up = () => {
          handle.classList.remove("drag");
          handle.removeEventListener("pointermove", move);
          handle.removeEventListener("pointerup", up);
          handle.removeEventListener("pointercancel", up);
        };
        handle.addEventListener("pointermove", move);
        handle.addEventListener("pointerup", up);
        handle.addEventListener("pointercancel", up);
      });
    drag(hA, "a");
    drag(hB, "b");
    track.addEventListener("pointerdown", (e) => {
      if (!dur || !player || e.target === hA || e.target === hB) return;
      player.seek(timeAt(e.clientX));
    });

    // typing times
    const fromInputs = () => {
      const s = parseTime(startIn.value), e = parseTime(endIn.value);
      if (isNaN(s) || isNaN(e)) return (err.textContent = "Use times like 1:23 or 1:02:03.5");
      if (e <= s) return (err.textContent = "The end has to be after the start.");
      if (dur && s >= dur) return (err.textContent = "The start is past the end of the video.");
      err.textContent = "";
      a = s;
      b = dur ? Math.min(e, dur) : e;
      render(true);
      return true;
    };
    for (const i of [startIn, endIn]) {
      i.addEventListener("input", fromInputs);
      i.addEventListener("change", () => fromInputs() && render());
    }

    const close = () => {
      cancelAnimationFrame(raf);
      if (player) player.destroy();
      // Put the page's video back where it was.
      if (pageVid) {
        pageVid.pause();
        pageVid.currentTime = now;
        if (wasPlaying) pageVid.play().catch(() => {});
      }
      box.remove();
      document.removeEventListener("keydown", onKey, true);
    };
    const go = (f) => {
      if (!fromInputs()) return;
      send(url, f, { section: { start: Math.round(a * 10) / 10, end: Math.round(b * 10) / 10 } });
      close();
    };
    const formats = el("div", "sq-clip-formats");
    for (const [f, label] of FORMATS) formats.appendChild(chip(label, "Stash this clip as " + label, () => go(f)));
    const cancel = chip("Cancel", "Close", close, "sq-cancel");

    const card = el(
      "div", "sq-clip-card",
      el("div", "sq-clip-title", "Clip a section"),
      screen,
      el("div", "sq-tl-wrap", track, el("div", "sq-tl-times", tlStart, tlEnd)),
      el("div", "sq-clip-ctrl", playBtn, loopBtn, el("span", "sq-grow"), setA, setB),
      el("div", "sq-clip-times",
        el("label", "", "Start"), startIn,
        el("label", "", "End"), endIn,
        lenLabel),
      err,
      el("div", "sq-clip-foot", cancel, formats)
    );
    const box = el("div", "", card);
    box.id = "sq-clip";
    box.addEventListener("mousedown", (e) => e.target === box && close());
    const onKey = (e) => {
      const typing = e.target === startIn || e.target === endIn;
      // Only a real key press closes it: our own synthetic Escape (used to shut YouTube's menus) must not.
      if (e.key === "Escape" && e.isTrusted) close();
      else if (!typing && e.key === " ") {
        e.preventDefault();
        togglePlay();
      } else if (!typing && e.key === "[") setFromHead("a");
      else if (!typing && e.key === "]") setFromHead("b");
      else if (typing && e.key === "Enter") fromInputs() && render();
      e.stopPropagation(); // keep YouTube's own shortcuts (k, j, l, f…) out of the dialog
    };
    document.addEventListener("keydown", onKey, true);
    document.documentElement.appendChild(box);
    clampAll();
    if (pageVid) player.seek(a);
    render();
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "openClip") openClip(msg.url, msg.samePage);
  });

  // =========================================================
  // 1. ⋮ three-dot menus everywhere
  // =========================================================
  let menuVideo = null;
  // Remember which video's ⋮ was pressed (capture phase, before YouTube handles it).
  document.addEventListener(
    "click",
    (e) => {
      const t = e.target;
      if (!t.closest) return;
      if (t.closest(".sq-row, ytd-popup-container, #sq-clip")) return;
      const trigger = t.closest(
        "ytd-menu-renderer, button[aria-label='Action menu'], button[aria-label='More actions'], " +
          "button-view-model, .yt-lockup-metadata-view-model__menu-button, .shortsLockupViewModelHostOutsideMetadataMenu"
      );
      menuVideo = trigger ? videoFor(trigger) : null;
    },
    true
  );

  function closeYtPopup() {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true }));
  }

  // Rows for a menu: "Stash" for the video, "Whole playlist" when there is one.
  function buildRows(url, onDone, samePage) {
    const frag = el("div", "sq-rows");
    if (hasVideo(url)) {
      // "Stash", not "Download", so it isn't confused with YouTube's own (Premium) "Download" item.
      const row = el("div", "sq-row", el("span", "sq-row-icon", icon()), el("span", "sq-row-label", "Stash"));
      row.appendChild(
        formatChips(
          (f) => {
            send(url, f);
            onDone();
          },
          () => {
            onDone();
            openClip(url, samePage);
          }
        )
      );
      frag.appendChild(row);
    }
    if (hasList(url)) {
      const row = el("div", "sq-row", el("span", "sq-row-icon", icon(ICON_LIST)), el("span", "sq-row-label", "Whole playlist"));
      row.appendChild(
        formatChips((f) => {
          send(url, f, { playlist: true });
          onDone();
        })
      );
      frag.appendChild(row);
    }
    return frag.children.length ? frag : null;
  }

  // YouTube sizes and positions its popup before we add our rows: lift its size caps,
  // then nudge it back on screen if the extra rows pushed it past an edge.
  function refit(node) {
    const dd = node.closest("tp-yt-iron-dropdown");
    for (const n of [node.closest("yt-sheet-view-model"), node.closest("ytd-menu-popup-renderer")]) {
      if (!n) continue;
      n.style.maxHeight = "none";
      n.style.maxWidth = "none";
    }
    if (!dd) return;
    requestAnimationFrame(() => {
      const r = dd.getBoundingClientRect();
      if (r.right > innerWidth - 8) dd.style.left = Math.max(8, innerWidth - r.width - 8) + "px";
      if (r.bottom > innerHeight - 8) dd.style.top = Math.max(8, innerHeight - r.height - 8) + "px";
    });
  }

  function decorate(container, list) {
    let rows = container.querySelector(".sq-rows");
    if (!menuVideo) {
      if (rows) rows.remove();
      return;
    }
    if (rows && rows.dataset.url === menuVideo && rows.dataset.build === BUILD) return;
    if (rows) rows.remove();
    const samePage = currentPageVideo() && menuVideo === currentPageVideo();
    rows = buildRows(menuVideo, closeYtPopup, samePage);
    if (!rows || !list) return;
    rows.dataset.url = menuVideo;
    rows.dataset.build = BUILD;
    list.insertAdjacentElement("afterend", rows);
    refit(rows);
  }

  function decoratePopups() {
    // Classic popup (ytd-menu-popup-renderer)
    document.querySelectorAll("ytd-popup-container ytd-menu-popup-renderer").forEach((pop) => {
      if (pop.getBoundingClientRect().height > 0) decorate(pop, pop.querySelector("#items"));
    });
    // Newer sheet popup (yt-sheet-view-model / yt-list-view-model)
    document.querySelectorAll("ytd-popup-container yt-sheet-view-model").forEach((sheet) => {
      if (sheet.getBoundingClientRect().height > 0) decorate(sheet, sheet.querySelector("yt-list-view-model"));
    });
  }

  // =========================================================
  // 2. Player right-click menu (Loop / Miniplayer / Stats for nerds)
  // =========================================================
  let playerVideo = null;
  document.addEventListener(
    "contextmenu",
    (e) => {
      if (!alive()) return;
      const player = e.target.closest && e.target.closest(".html5-video-player");
      if (!player) return;
      playerVideo = videoFor(player);
      watchPlayer(player);
      // Fallback for the very first open, in case the menu shows up some other way.
      setTimeout(() => decoratePlayerMenu(), 0);
    },
    true
  );

  // YouTube builds and sizes the menu right after the contextmenu event, sometimes over a
  // few steps. A MutationObserver runs right after each of those changes and before the
  // browser paints, so every frame that reaches the screen already has our rows and size
  // (a timer would let YouTube's own size flash first: the "jolt").
  const menuObs = new MutationObserver(() => {
    if (!alive()) return menuObs.disconnect();
    decoratePlayerMenu();
    menuObs.takeRecords(); // our own writes above; don't react to them
  });
  const watched = new WeakSet();
  function watchPlayer(player) {
    if (!watched.has(player)) {
      watched.add(player);
      menuObs.observe(player, { childList: true }); // the menu is created lazily, as a child
    }
    player.querySelectorAll(":scope > .ytp-contextmenu").forEach((cm) => {
      if (watched.has(cm)) return;
      watched.add(cm);
      menuObs.observe(cm, { attributes: true, attributeFilter: ["style", "class"], childList: true, subtree: true });
    });
  }

  // Close YouTube's player menu the way it expects (Escape), so its open/closed state stays in sync.
  function closePlayerMenu(cm) {
    const opts = { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true };
    (cm.querySelector(".ytp-menuitem") || cm).dispatchEvent(new KeyboardEvent("keydown", opts));
    setTimeout(() => {
      if (getComputedStyle(cm).display !== "none") document.dispatchEvent(new KeyboardEvent("keydown", opts));
    }, 50);
  }

  function playerItem(cls, iconPath, label, chips) {
    const content = el("div", "ytp-menuitem-content", chips);
    const item = el("div", "ytp-menuitem sq-ytp-item " + cls, el("div", "ytp-menuitem-icon", icon(iconPath)), el("div", "ytp-menuitem-label", label), content);
    item.setAttribute("role", "menuitem");
    return item;
  }

  function decoratePlayerMenu() {
    document.querySelectorAll(".ytp-contextmenu").forEach((cm) => {
      const player = cm.closest(".html5-video-player");
      if (player) watchPlayer(player);
      if (cm.style.display === "none") return; // closed: nothing to size
      const panel = cm.querySelector(".ytp-panel");
      const panelMenu = cm.querySelector(".ytp-panel-menu");
      if (!panel || !panelMenu) return;
      const url = () => playerVideo || currentPageVideo();
      const wantList = hasList(url() || "");
      // Our rows live in their own block above YouTube's menu, which is laid out as a
      // table: inside it, our wide button column would squeeze YouTube's labels.
      let block = panel.querySelector(":scope > .sq-ytp-block");
      const changed = !block || block.dataset.build !== BUILD || !!block.querySelector(".sq-ytp-pl") !== wantList;
      if (changed) {
        if (block) block.remove();
        block = buildPlayerBlock(cm, url, wantList);
        panel.insertBefore(block, panelMenu);
      }
      fitPlayerMenu(cm, panel, panelMenu, block);
    });
  }

  // YouTube re-measures the menu on every open, and that measurement includes whatever
  // size we set last time. So size everything from the content itself (never from the
  // current styles), which gives the same result no matter how often it runs.
  function natural(node, prop) {
    const old = node.style[prop];
    node.style[prop] = "max-content";
    const v = prop === "width" ? node.offsetWidth : node.offsetHeight;
    node.style[prop] = old;
    return v;
  }
  function fitPlayerMenu(cm, panel, panelMenu, block) {
    let ytH = 0;
    for (const item of panelMenu.children) ytH += item.offsetHeight;
    const w = Math.ceil(Math.max(natural(panelMenu, "width"), natural(block, "width")));
    const h = Math.ceil(ytH + block.offsetHeight);
    for (const node of [cm, panel]) {
      node.style.width = w + "px";
      node.style.height = h + "px";
    }
    panelMenu.style.width = w + "px";
    panelMenu.style.height = ytH + "px";
    // Keep it inside the player (YouTube placed it using its own, smaller size).
    const player = cm.closest(".html5-video-player");
    if (player) {
      const pw = player.clientWidth, ph = player.clientHeight;
      const left = parseFloat(cm.style.left) || 0, top = parseFloat(cm.style.top) || 0;
      if (left + w > pw) cm.style.left = Math.max(0, pw - w) + "px";
      if (top + h > ph) cm.style.top = Math.max(0, ph - h) + "px";
    }
  }

  function buildPlayerBlock(cm, url, wantList) {
    const block = el("div", "sq-ytp-block");
    block.dataset.build = BUILD;
    {
      const dl = playerItem("sq-ytp-dl", ICON_DL, "Stash",
        formatChips(
          (f) => {
            send(url(), f);
            closePlayerMenu(cm);
          },
          () => {
            closePlayerMenu(cm);
            openClip(url(), location.pathname === "/watch" || location.pathname.startsWith("/shorts/"));
          }
        ));
      block.appendChild(dl);
    }
    if (wantList) {
      block.appendChild(playerItem("sq-ytp-pl", ICON_LIST, "Whole playlist",
        formatChips((f) => {
          send(url(), f, { playlist: true });
          closePlayerMenu(cm);
        })));
    }
    return block;
  }

  // =========================================================
  // Theme + keeping up with YouTube's single-page navigation
  // =========================================================
  // Decide light/dark from the page's actual background, not YouTube's flags
  // (they vary, and Brave's forced dark mode can repaint the page without setting them).
  function syncTheme() {
    const app = document.querySelector("ytd-app") || document.body;
    if (!app) return;
    const m = getComputedStyle(app).backgroundColor.match(/[\d.]+/g);
    if (!m || (m.length > 3 && +m[3] === 0)) return;
    const lum = (0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2]) / 255;
    document.documentElement.toggleAttribute("data-sq-dark", lum < 0.5);
  }

  let pending = false;
  const obs = new MutationObserver(() => {
    if (!alive()) return obs.disconnect();
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      syncTheme();
      decoratePopups();
    });
  });
  obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "hidden", "dark"] });
  syncTheme();
})();
