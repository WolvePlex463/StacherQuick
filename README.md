# StacherQuick

Unofficial companion for [Stacher7](https://stacher.io): download from YouTube straight from YouTube's own menus. Not made by or affiliated with the Stacher developers.

- **MP4 / MP3 / WAV** from the ⋮ menu on any video, the player's right-click menu (next to Loop / Stats for nerds), or the browser right-click menu.
- **Whole playlist**, **clip a section** (start/end, prefilled from where you are), **keyboard shortcut** (Alt+Shift+D: last format).
- **Save to a set folder or ask every time**, with a separate folder for audio if you want.
- **Login cookies** (Firefox, Chrome, Brave, Edge, Opera, Vivaldi, Chromium, Whale or a cookies.txt) for age-restricted / members-only videos. Used only when a video needs it.
- Progress, cancel, retry, open file, show in folder, plain-English errors, and a one-click yt-dlp update.

MP4 uses `bv*[vcodec^=avc1]+ba[ext=m4a]/bv*+ba/b` (H.264 + AAC, plays everywhere).

## Requirements
- Windows, and a Chromium browser (Brave, Chrome, Edge, Opera, Vivaldi).
- [Python 3](https://www.python.org/downloads/) (runs the small helper that starts yt-dlp).
- **Stacher7** installed: StacherQuick uses its yt-dlp and ffmpeg, so they stay updated together.
  No Stacher? Setup can download yt-dlp, ffmpeg and deno for you instead.

## Easy install: let an AI agent do it
If you have an AI agent that can use your computer (Claude Code, the Claude desktop app, Cursor, Codex, and so on), copy this whole box and send it to the agent:

```text
Install the StacherQuick browser extension on this Windows PC for me. I'm not technical, so do every step you can yourself and tell me in plain words when I need to click something.

1. Download https://github.com/WolvePlex463/StacherQuick/releases/latest/download/StacherQuick.zip
   (if that link fails, use the .zip on https://github.com/WolvePlex463/StacherQuick/releases/latest).
   Unzip it to %USERPROFILE%\Documents so the folder is %USERPROFILE%\Documents\StacherQuick.
2. Make sure Python 3 is installed (run: py -3 --version). If it isn't, install it with:
   winget install -e --id Python.Python.3.13 --accept-package-agreements --accept-source-agreements
3. Run setup without prompts:
   powershell -NoProfile -ExecutionPolicy Bypass -File "%USERPROFILE%\Documents\StacherQuick\setup.ps1" -Yes
   It must print "Done." If it prints an error, fix it and run it again.
4. Find which browser I use (Brave, Chrome, Edge, Opera or Vivaldi). Open its extensions page
   (brave://extensions, chrome://extensions, edge://extensions, ...). If you can't control the browser,
   walk me through it: turn on "Developer mode" (top right), click "Load unpacked", and choose the folder
   %USERPROFILE%\Documents\StacherQuick\extension
5. Tell me to pin the StacherQuick icon (puzzle-piece button, then the pin) and click it. The dot at the top
   should be green. If it's red, re-run step 3 and check its output.
6. Finally, tell me how to use it: on YouTube, click the ⋮ menu on any video, or right-click the video player,
   and choose MP4, MP3 or WAV.
```

## Install
1. Unzip anywhere you'll keep it (for example `Documents\StacherQuick`).
2. Double-click **setup.bat**.
3. Open `brave://extensions` (or `chrome://` / `edge://`), turn on **Developer mode**, click **Load unpacked** and pick the `extension` folder.
4. Click the StacherQuick toolbar icon. The dot should be green. Set your folder and go.

Moving the folder later? Run setup.bat again.

## How it works
The extension can't run programs itself, so a tiny Python helper (`host\host.py`) is registered with the browser as a native messaging host. The extension sends it the link and format, and it runs yt-dlp from `%USERPROFILE%\.stacher` (Stacher's copy), else `tools\`, else your PATH. Nothing is sent anywhere except YouTube and, for the update check, GitHub.

## Uninstall
Run **uninstall.bat**, remove the extension from your browser, delete the folder.

## Notes
- Chromium browsers lock and encrypt cookies on Windows, so "use cookies from Chrome/Brave/Edge" often fails while that browser is open. Firefox or a cookies.txt file is reliable.
- If Alt+Shift+D does nothing, set it at `brave://extensions/shortcuts`.
- Only download what you have the right to download.
