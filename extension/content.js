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
  // Clip mode: trim right inside YouTube's player
  // =========================================================
  // The video already playing is the preview. While clipping, the player's progress bar is
  // swapped for a trim bar with two handles, and a small pill above it holds the times,
  // a preview button and the formats. Nothing pops up.
  function fmtTime(t) {
    t = Math.max(0, Math.round(t * 10) / 10);
    const whole = Math.floor(t), tenth = Math.round((t - whole) * 10);
    const h = Math.floor(whole / 3600), m = Math.floor((whole % 3600) / 60), s = whole % 60;
    const mm = String(m).padStart(h ? 2 : 1, "0"), ss = String(s).padStart(2, "0");
    return (h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`) + "." + tenth;
  }
  function fmtLen(t) {
    t = Math.round(t * 10) / 10;
    return t < 60 ? `${t.toFixed(1)}s` : fmtTime(t).replace(/\.\d$/, "");
  }
  function videoIdOf(url) {
    try {
      const u = new URL(url, location.href);
      return u.searchParams.get("v") || (u.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]{6,})/) || [])[1] || null;
    } catch (_) {
      return null;
    }
  }
  // The player that's showing this page's video (the biggest visible one: watch page or the active Short).
  function mainPlayer() {
    let best = null, area = 0;
    document.querySelectorAll(".html5-video-player").forEach((p) => {
      const r = p.getBoundingClientRect();
      if (r.width * r.height > area && p.querySelector("video")) (best = p), (area = r.width * r.height);
    });
    return best;
  }

  const ICON_PLAY = "M8 5v14l11-7z";
  const ICON_PAUSE = "M6 5h4v14H6zm8 0h4v14h-4z";
  const ICON_X = "M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7 2.9 18.3 9.2 12 2.9 5.7l1.4-1.4 6.3 6.3 6.3-6.3z";

  let clip = null; // the active clip session

  // Entry point for every ✂ Clip button and the browser menu's "Clip a section…".
  function startClip(url) {
    const id = videoIdOf(url);
    if (!id) return toast("Couldn't find the video to clip");
    if (videoIdOf(location.href) === id && mainPlayer()) return enterClip(url);
    // A video from a feed: open it, then the trim bar appears there.
    try {
      sessionStorage.setItem("sqClipPending", id);
    } catch (_) {}
    location.assign("https://www.youtube.com/watch?v=" + id);
  }
  function resumePendingClip() {
    let id = null;
    try {
      id = sessionStorage.getItem("sqClipPending");
    } catch (_) {}
    if (!id || videoIdOf(location.href) !== id) return;
    const tryEnter = (n) => {
      const p = mainPlayer(), v = p && p.querySelector("video");
      if (v && isFinite(v.duration) && v.duration > 0 && videoIdOf(location.href) === id) {
        try {
          sessionStorage.removeItem("sqClipPending");
        } catch (_) {}
        enterClip(location.href);
      } else if (n < 60) setTimeout(() => tryEnter(n + 1), 250);
    };
    tryEnter(0);
  }

  function enterClip(url) {
    exitClip();
    const player = mainPlayer();
    const video = player && player.querySelector("video");
    if (!video) return toast("Couldn't find the player");
    const dur = isFinite(video.duration) ? video.duration : 0;
    if (!dur) return toast("Wait for the video to load, then try again");

    let a = Math.min(video.currentTime, Math.max(0, dur - 1));
    let b = Math.min(dur, a + 30);
    if (b - a < 1) a = Math.max(0, b - 30);
    let previewing = false;

    // ---- build ----
    const fill = el("div", "sq-tb-fill");
    const head = el("div", "sq-tb-head");
    const hA = el("div", "sq-tb-h sq-tb-a");
    const hB = el("div", "sq-tb-h sq-tb-b");
    hA.title = "Drag to set the start  ·  [ sets it to the current time";
    hB.title = "Drag to set the end  ·  ] sets it to the current time";
    const track = el("div", "sq-tb-track", el("div", "sq-tb-rail"), fill, head, hA, hB);

    const playIcon = icon(ICON_PLAY);
    const playBtn = el("button", "sq-tb-btn sq-tb-play", playIcon);
    playBtn.title = "Preview the clip";
    const range = el("span", "sq-tb-range");
    const len = el("span", "sq-tb-len");
    const fmts = el("span", "sq-tb-fmts");
    for (const [f, label, hint] of FORMATS) {
      const b2 = el("button", "sq-tb-fmt", label);
      b2.title = "Stash this clip as " + label + " (" + hint.toLowerCase() + ")";
      b2.addEventListener("click", (e) => {
        e.stopPropagation();
        // Clean link: a "&t=" in the page URL must not shift the clip.
        send("https://www.youtube.com/watch?v=" + videoIdOf(url), f, { section: { start: Math.round(a * 10) / 10, end: Math.round(b * 10) / 10 } });
        exitClip();
      });
      fmts.append(b2);
    }
    const closeBtn = el("button", "sq-tb-btn sq-tb-close", icon(ICON_X));
    closeBtn.title = "Stop clipping (Esc)";
    closeBtn.addEventListener("click", () => exitClip());
    const pill = el("div", "sq-tb-pill", playBtn, range, len, el("span", "sq-tb-sep"), fmts, closeBtn);
    const root = el("div", "sq-trim", pill, track);
    // Clicks on our controls must not reach YouTube (which would play/pause the video).
    for (const ev of ["click", "mousedown", "pointerdown", "dblclick", "contextmenu"]) root.addEventListener(ev, (e) => e.stopPropagation());
    player.append(root);
    player.classList.add("sq-clipping");

    // ---- layout: sit exactly where YouTube's progress bar is ----
    const layout = () => {
      const pr = player.getBoundingClientRect();
      const bar = player.querySelector(".ytp-progress-bar-container");
      const br = bar && bar.getBoundingClientRect();
      if (br && br.width > 50) {
        root.style.left = br.left - pr.left + "px";
        root.style.width = br.width + "px";
        root.style.bottom = pr.bottom - br.bottom - 8 + "px";
      } else {
        root.style.left = "12px";
        root.style.width = pr.width - 24 + "px";
        root.style.bottom = "56px";
      }
      root.classList.toggle("sq-narrow", parseFloat(root.style.width) < 520);
    };
    const ro = new ResizeObserver(layout);
    ro.observe(player);
    layout();

    // ---- state -> screen ----
    const pct = (t) => (t / dur) * 100 + "%";
    const render = () => {
      fill.style.left = pct(a);
      fill.style.width = ((b - a) / dur) * 100 + "%";
      hA.style.left = pct(a);
      hB.style.left = pct(b);
      range.textContent = fmtTime(a) + "  –  " + fmtTime(b);
      len.textContent = fmtLen(b - a);
      const playing = !video.paused;
      playIcon.firstChild.setAttribute("d", playing && previewing ? ICON_PAUSE : ICON_PLAY);
      playBtn.title = playing && previewing ? "Pause" : "Preview the clip";
    };
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const t = video.currentTime;
      head.style.left = pct(Math.min(t, dur));
      head.classList.toggle("out", t < a - 0.05 || t > b + 0.05);
      if (previewing && !video.paused && t >= b) {
        previewing = false;
        video.pause();
        video.currentTime = a; // ready to preview again
        render();
      }
    };
    raf = requestAnimationFrame(tick);

    const clamp = () => {
      a = Math.max(0, Math.min(a, dur - 0.5));
      b = Math.max(a + 0.5, Math.min(b, dur));
    };

    // ---- preview ----
    playBtn.addEventListener("click", () => {
      if (previewing && !video.paused) {
        previewing = false;
        video.pause();
      } else {
        const t = video.currentTime;
        if (t < a - 0.05 || t >= b - 0.1) video.currentTime = a;
        previewing = true;
        video.play().catch(() => {});
      }
      render();
    });
    const onVid = () => {
      if (video.paused) previewing = false;
      render();
    };
    video.addEventListener("play", onVid);
    video.addEventListener("pause", onVid);

    // ---- dragging ----
    const timeAt = (x) => {
      const r = track.getBoundingClientRect();
      return Math.round(Math.max(0, Math.min(1, (x - r.left) / r.width)) * dur * 10) / 10;
    };
    const drag = (h, which) =>
      h.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        h.setPointerCapture(e.pointerId);
        previewing = false;
        video.pause();
        h.classList.add("drag");
        root.classList.add("dragging");
        const move = (ev) => {
          const t = timeAt(ev.clientX);
          if (which === "a") a = Math.min(t, b - 0.5);
          else b = Math.max(t, a + 0.5);
          clamp();
          video.currentTime = which === "a" ? a : b; // the video shows the frame you're on
          render();
        };
        const up = () => {
          h.classList.remove("drag");
          root.classList.remove("dragging");
          h.removeEventListener("pointermove", move);
          h.removeEventListener("pointerup", up);
          h.removeEventListener("pointercancel", up);
          // Back to the start, so Preview plays from it straight away.
          if (which === "b") setTimeout(() => clip && (video.currentTime = a), 350);
        };
        h.addEventListener("pointermove", move);
        h.addEventListener("pointerup", up);
        h.addEventListener("pointercancel", up);
      });
    drag(hA, "a");
    drag(hB, "b");
    // Clicking the bar moves the playhead there.
    track.addEventListener("pointerdown", (e) => {
      if (e.target === hA || e.target === hB) return;
      video.currentTime = timeAt(e.clientX);
    });

    // ---- keys: [ and ] set the ends at the current time, Esc closes ----
    const onKey = (e) => {
      const tag = (e.target && e.target.tagName) || "";
      if (/INPUT|TEXTAREA/.test(tag) || (e.target && e.target.isContentEditable)) return;
      if (e.key === "Escape" && e.isTrusted) exitClip();
      else if (e.key === "[") (a = video.currentTime), b <= a + 0.5 && (b = Math.min(dur, a + 30)), clamp(), render();
      else if (e.key === "]") (b = video.currentTime), b <= a + 0.5 && (a = Math.max(0, b - 30)), clamp(), render();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    document.addEventListener("keydown", onKey, true);

    // Leaving the video ends the clip session.
    const onNav = () => exitClip();
    document.addEventListener("yt-navigate-start", onNav);

    clip = {
      exit() {
        cancelAnimationFrame(raf);
        ro.disconnect();
        video.removeEventListener("play", onVid);
        video.removeEventListener("pause", onVid);
        document.removeEventListener("keydown", onKey, true);
        document.removeEventListener("yt-navigate-start", onNav);
        player.classList.remove("sq-clipping");
        root.remove();
      },
    };
    clamp();
    render();
    video.pause();
  }

  function exitClip() {
    if (clip) clip.exit();
    clip = null;
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "openClip") startClip(msg.url);
  });
  // A clip started from a feed opens the video first; pick it up once the player is ready.
  document.addEventListener("yt-navigate-finish", resumePendingClip);
  resumePendingClip();

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
      if (t.closest(".sq-row, ytd-popup-container, .sq-trim")) return;
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
  function buildRows(url, onDone) {
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
            startClip(url);
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
    rows = buildRows(menuVideo, closeYtPopup);
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
      watchMenus(player);
      // Fallback for the very first open, in case the menu shows up some other way.
      setTimeout(() => decoratePlayerMenu(), 0);
    },
    true
  );

  // YouTube builds, sizes and places the menu right after the contextmenu event, sometimes
  // over a few steps. A MutationObserver runs right after each of those changes and before
  // the browser paints, so our card is always drawn in step with the menu (no jolt).
  const menuObs = new MutationObserver(() => {
    if (!alive()) return menuObs.disconnect();
    decoratePlayerMenu();
    menuObs.takeRecords(); // our own writes above; don't react to them
  });
  const watched = new WeakSet();
  // YouTube creates the menu lazily, and depending on the player version puts it inside the
  // player or straight on <body>. Watch both places for it to appear, then watch the menu.
  function watchMenus(player) {
    for (const host of [player, document.body]) {
      if (host && !watched.has(host)) {
        watched.add(host);
        menuObs.observe(host, { childList: true });
      }
    }
    document.querySelectorAll(".ytp-contextmenu").forEach((cm) => {
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

  // Our rows live in their own small card that sits right above (or below) YouTube's menu,
  // never inside it. YouTube sizes its menu itself on every open; whenever we resized it
  // too, the two fought (a scrollbar, a menu that grew wide). Now we never touch it.
  const cards = new WeakMap(); // YouTube menu -> our card
  function decoratePlayerMenu() {
    document.querySelectorAll(".ytp-contextmenu").forEach((cm) => {
      const host = cm.parentElement;
      if (!host) return;
      watchMenus(cm.closest(".html5-video-player"));
      cleanLegacy(cm);
      let card = cards.get(cm);
      const open = cm.style.display !== "none" && cm.offsetWidth > 0;
      if (!open) {
        if (card) card.hidden = true;
        return;
      }
      const url = () => playerVideo || currentPageVideo();
      const wantList = hasList(url() || "");
      if (!card || !card.isConnected || card.dataset.build !== BUILD || !!card.querySelector(".sq-ytp-pl") !== wantList) {
        if (card) card.remove();
        card = buildPlayerCard(cm, url, wantList);
        cards.set(cm, card);
      }
      // Same parent as the menu, so both are positioned in the same coordinates.
      if (card.parentElement !== host) host.appendChild(card);
      card.hidden = false;
      placeCard(cm, card);
    });
  }

  // Undo what older versions of this extension did to YouTube's menu (rows inside it, a
  // forced width), so an updated extension starts from YouTube's own menu.
  function cleanLegacy(cm) {
    if (cm.dataset.sqClean === BUILD) return;
    cm.dataset.sqClean = BUILD;
    cm.querySelectorAll(".sq-ytp-block").forEach((b) => b.remove());
    const pm = cm.querySelector(".ytp-panel-menu");
    if (pm) pm.style.width = ""; // YouTube never sets this one itself
  }

  function placeCard(cm, card) {
    const gap = 6, pad = 4;
    card.style.minWidth = cm.offsetWidth + "px";
    const cw = card.offsetWidth, ch = card.offsetHeight;
    const r = cm.getBoundingClientRect(); // on screen, to decide where there's room
    let y = cm.offsetTop - ch - gap; // above the menu…
    if (r.top - ch - gap < pad) {
      // …or below it when there's no room above (and only if it fits there)
      if (r.bottom + gap + ch <= innerHeight - pad) y = cm.offsetTop + cm.offsetHeight + gap;
    }
    let x = cm.offsetLeft;
    const overflowRight = r.left + cw - (innerWidth - pad);
    if (overflowRight > 0) x -= overflowRight;
    card.style.left = x + "px";
    card.style.top = y + "px";
  }

  function buildPlayerCard(cm, url, wantList) {
    const card = el("div", "sq-ytp-card");
    card.dataset.build = BUILD;
    // Clicks in the card are ours: don't let YouTube take them as clicks on the video.
    for (const ev of ["click", "mousedown", "mouseup", "pointerdown", "dblclick", "contextmenu"]) card.addEventListener(ev, (e) => e.stopPropagation());
    const done = () => {
      card.hidden = true;
      closePlayerMenu(cm);
    };
    card.appendChild(playerItem("sq-ytp-dl", ICON_DL, "Stash",
      formatChips(
        (f) => {
          send(url(), f);
          done();
        },
        () => {
          done();
          startClip(url());
        }
      )));
    if (wantList) {
      card.appendChild(playerItem("sq-ytp-pl", ICON_LIST, "Whole playlist",
        formatChips((f) => {
          send(url(), f, { playlist: true });
          done();
        })));
    }
    return card;
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
