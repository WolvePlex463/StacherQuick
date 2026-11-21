const HOST = "com.stacherquick.host";
const FORMATS = { mp4: "MP4 (video)", mp3: "MP3 (audio)", wav: "WAV (audio)" };
const AUDIO = new Set(["mp3", "wav"]);
const YT_PATTERNS = ["*://*.youtube.com/*", "*://youtu.be/*"];
const CTX = ["link", "page", "video", "frame"];

// ---------- settings ----------
async function getSettings() {
  const s = await chrome.storage.local.get([
    "mode", "folder", "audioFolder", "audioSame", "lastFolder",
    "cookiesSource", "cookiesFile", "cookiesAlways", "lastFormat",
  ]);
  return {
    mode: s.mode || "folder",
    folder: s.folder || "",
    audioFolder: s.audioFolder || "",
    audioSame: s.audioSame !== false,
    lastFolder: s.lastFolder || "",
    cookies: { source: s.cookiesSource || "none", file: s.cookiesFile || "", always: !!s.cookiesAlways },
    lastFormat: s.lastFormat || "mp4",
  };
}

// ---------- context menu ----------
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    const add = (o) => chrome.contextMenus.create({ contexts: CTX, documentUrlPatterns: YT_PATTERNS, ...o });
    add({ id: "sq-root", title: "Download with Stacher" });
    for (const [id, title] of Object.entries(FORMATS)) add({ id: "sq-" + id, parentId: "sq-root", title });
    add({ id: "sq-sep1", parentId: "sq-root", type: "separator" });
    add({ id: "sq-pl", parentId: "sq-root", title: "Whole playlist" });
    for (const [id, title] of Object.entries(FORMATS)) add({ id: "sq-pl-" + id, parentId: "sq-pl", title });
    add({ id: "sq-clip", parentId: "sq-root", title: "Clip a section…" });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const id = String(info.menuItemId);
  const raw = info.linkUrl || info.pageUrl;
  if (id === "sq-clip") {
    const url = pickVideoUrl(info.linkUrl) || pickVideoUrl(info.pageUrl);
    if (!url) return notify("No video here", "Right-click a video, thumbnail or video page.");
    return chrome.tabs.sendMessage(tab.id, { type: "openClip", url, samePage: !info.linkUrl || pickVideoUrl(info.pageUrl) === url });
  }
  const pl = id.match(/^sq-pl-(\w+)$/);
  if (pl) {
    const url = pickPlaylistUrl(info.linkUrl) || pickPlaylistUrl(info.pageUrl);
    if (!url) return notify("No playlist here", "Right-click a playlist link, or open a video that's playing from a playlist.");
    return startDownload({ url, kind: pl[1], playlist: true });
  }
  const kind = id.replace("sq-", "");
  if (!FORMATS[kind]) return;
  const url = pickVideoUrl(info.linkUrl) || pickVideoUrl(info.pageUrl);
  if (!url) return notify("No video here", "Right-click a video, thumbnail or video page.");
  startDownload({ url, kind });
});

// ---------- keyboard shortcut ----------
chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab && pickVideoUrl(tab.url);
  if (!url) return notify("No video on this tab", "Open a YouTube video, then press the shortcut.");
  const s = await getSettings();
  const kind = command === "download-mp3" ? "mp3" : command === "download-mp4" ? "mp4" : s.lastFormat;
  startDownload({ url, kind });
});

// Single-video URL (drops playlist/radio params).
function pickVideoUrl(raw) {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.hostname === "youtu.be") return "https://www.youtube.com/watch?v=" + u.pathname.slice(1);
    if (!/youtube\.com$/.test(u.hostname)) return null;
    if (u.pathname === "/watch" && u.searchParams.get("v")) return "https://www.youtube.com/watch?v=" + u.searchParams.get("v");
    const m = u.pathname.match(/^\/(shorts|live|embed)\/([\w-]{6,})/);
    if (m) return "https://www.youtube.com/watch?v=" + m[2];
  } catch (_) {}
  return null;
}

function pickPlaylistUrl(raw) {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (!/youtube\.com$|youtu\.be$/.test(u.hostname)) return null;
    const list = u.searchParams.get("list");
    if (list) return "https://www.youtube.com/playlist?list=" + list;
  } catch (_) {}
  return null;
}

// ---------- messages from page script / popup ----------
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  switch (msg.type) {
    case "download": {
      const url = msg.playlist ? pickPlaylistUrl(msg.url) : pickVideoUrl(msg.url);
      if (url) startDownload({ url, kind: msg.format, playlist: !!msg.playlist, section: msg.section || null });
      reply({ ok: !!url });
      return;
    }
    case "cancel":
      cancelJob(msg.id);
      reply({ ok: true });
      return;
    case "retry":
      retryJob(msg.id).then(() => reply({ ok: true }));
      return true;
    case "pickFolder":
      oneShot({ action: "pickFolder", initial: msg.initial, title: msg.title }).then(reply);
      return true;
    case "pickFile":
      oneShot({ action: "pickFile", initial: msg.initial }).then(reply);
      return true;
    case "reveal":
      oneShot({ action: "reveal", path: msg.path, folder: msg.folder }).then(reply);
      return true;
    case "open":
      oneShot({ action: "open", path: msg.path }).then(reply);
      return true;
    case "ping":
      oneShot({ action: "ping" }).then(reply);
      return true;
    case "ytdlpStatus":
      ytdlpStatus(msg.force).then(reply);
      return true;
    case "ytdlpUpdate":
      oneShot({ action: "ytdlpUpdate" }).then(async (r) => {
        if (r && r.current) await chrome.storage.local.set({ ytdlp: { ...r, ts: Date.now() } });
        reply(r);
      });
      return true;
    case "openShortcuts":
      chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
      reply({ ok: true });
      return;
  }
});

function oneShot(payload) {
  return new Promise((resolve) => {
    chrome.runtime.sendNativeMessage(HOST, payload, (res) => {
      if (chrome.runtime.lastError) resolve({ type: "error", error: chrome.runtime.lastError.message });
      else resolve(res);
    });
  });
}

// yt-dlp version check, cached for 12 hours.
async function ytdlpStatus(force) {
  const { ytdlp } = await chrome.storage.local.get("ytdlp");
  if (!force && ytdlp && Date.now() - ytdlp.ts < 12 * 3600 * 1000) return ytdlp;
  const r = await oneShot({ action: "ytdlpStatus" });
  if (r && r.current) {
    const val = { ...r, ts: Date.now() };
    await chrome.storage.local.set({ ytdlp: val });
    if (r.updateAvailable) chrome.action.setBadgeText({ text: "↑" });
    return val;
  }
  return r;
}

// ---------- download jobs (shown in popup) ----------
const ports = new Map(); // job id -> native port

async function updateJob(id, patch) {
  const { jobs = [] } = await chrome.storage.local.get("jobs");
  const i = jobs.findIndex((j) => j.id === id);
  if (i >= 0) Object.assign(jobs[i], patch);
  else jobs.unshift({ id, ...patch });
  await chrome.storage.local.set({ jobs: jobs.slice(0, 25) });
  updateBadge(jobs);
}

async function getJob(id) {
  const { jobs = [] } = await chrome.storage.local.get("jobs");
  return jobs.find((j) => j.id === id);
}

function updateBadge(jobs) {
  const active = jobs.filter((j) => j.status === "downloading" || j.status === "waiting").length;
  chrome.action.setBadgeBackgroundColor({ color: "#e53935" });
  chrome.action.setBadgeText({ text: active ? String(active) : "" });
}

function folderFor(s, kind) {
  if (s.mode !== "folder") return { folder: null, saveAs: null };
  if (AUDIO.has(kind) && !s.audioSame) return { folder: s.audioFolder || null, saveAs: s.audioFolder ? null : "audioFolder" };
  return { folder: s.folder || null, saveAs: s.folder ? null : "folder" };
}

async function startDownload(job, existingId) {
  const s = await getSettings();
  const { folder, saveAs } = folderFor(s, job.kind);
  const id = existingId || Date.now() + "-" + Math.random().toString(36).slice(2, 6);
  chrome.storage.local.set({ lastFormat: job.kind });
  const title = job.title || (await fetchTitle(job.url, job.playlist));
  await updateJob(id, {
    url: job.url, kind: job.kind, playlist: !!job.playlist, section: job.section || null, title,
    status: folder ? "downloading" : "waiting", percent: 0, item: 0, total: 0, stage: "",
    error: "", detail: "", file: "", ts: Date.now(),
  });

  let port;
  try {
    port = chrome.runtime.connectNative(HOST);
  } catch (e) {
    return fail(id, String(e));
  }
  ports.set(id, port);
  let finished = false;
  const finish = () => {
    finished = true;
    ports.delete(id);
    try { port.disconnect(); } catch (_) {}
  };
  port.onMessage.addListener((m) => {
    if (m.type === "started") {
      updateJob(id, { status: "downloading", folder: m.folder });
      if (!folder) chrome.storage.local.set({ lastFolder: m.folder });
      // "Set folders" mode but this kind had no folder yet: the first pick becomes it.
      if (saveAs) chrome.storage.local.set({ [saveAs]: m.folder });
    } else if (m.type === "progress") {
      updateJob(id, { percent: m.percent, stage: m.stage || "", item: m.item || 0, total: m.total || 0 });
    } else if (m.type === "done") {
      finish();
      const patch = { status: "done", percent: 100, stage: "", file: m.file || "", folder: m.folder };
      if (job.playlist) Object.assign(patch, { count: m.count, failed: m.failed, total: m.total });
      updateJob(id, patch);
      const what = job.playlist ? `Playlist: ${m.count} file${m.count === 1 ? "" : "s"}${m.failed ? `, ${m.failed} failed` : ""}` : m.name || title || job.url;
      notify(`Downloaded ${job.kind.toUpperCase()}${job.section ? " clip" : ""}`, what);
    } else if (m.type === "cancelled") {
      finish();
      updateJob(id, { status: "cancelled", stage: "" });
    } else if (m.type === "error") {
      finish();
      fail(id, m.error, m.detail);
    }
  });
  port.onDisconnect.addListener(() => {
    ports.delete(id);
    if (!finished) fail(id, chrome.runtime.lastError ? chrome.runtime.lastError.message : "The helper closed unexpectedly.");
  });
  port.postMessage({
    action: "download",
    url: job.url,
    format: job.kind,
    playlist: !!job.playlist,
    section: job.section || null,
    folder,
    lastFolder: s.lastFolder || s.folder,
    cookies: s.cookies,
  });
}

function cancelJob(id) {
  const port = ports.get(id);
  if (port) port.postMessage({ action: "cancel" });
  else updateJob(id, { status: "cancelled" });
}

async function retryJob(id) {
  const j = await getJob(id);
  if (!j) return;
  await startDownload({ url: j.url, kind: j.kind, playlist: j.playlist, section: j.section, title: j.title }, id);
}

async function fail(id, error, detail) {
  await updateJob(id, { status: "error", error: error || "Download failed.", detail: detail || "", stage: "" });
  notify("Download failed", (error || "").slice(0, 200));
}

async function fetchTitle(url, playlist) {
  try {
    const r = await fetch("https://www.youtube.com/oembed?format=json&url=" + encodeURIComponent(url));
    if (r.ok) return (await r.json()).title;
  } catch (_) {}
  return playlist ? "Playlist" : "";
}

function notify(title, message) {
  chrome.notifications.create({ type: "basic", iconUrl: "icons/128.png", title, message: message || "" });
}

// Check yt-dlp once when the browser starts.
chrome.runtime.onStartup.addListener(() => ytdlpStatus(false));
