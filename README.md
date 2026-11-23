# StacherQuick

Unofficial companion for [Stacher7](https://stacher.io): download from YouTube straight from YouTube's own menus. Not made by or affiliated with the Stacher developers.

- **Stash** as MP4 / MP3 / WAV from the ⋮ menu on any video, the top of the player's right-click menu, or the browser right-click menu.
- **Whole playlist**, **clip a section** (trim right in YouTube's player: drag the start/end on the progress bar, preview, stash), **keyboard shortcut** (Alt+Shift+D: last format).
- **Save to a set folder or ask every time**, with a separate folder for audio if you want.
- **Login cookies** (Firefox, Chrome, Brave, Edge, Opera, Vivaldi, Chromium, Whale or a cookies.txt) for age-restricted / members-only videos. Used only when a video needs it.
- Progress, cancel, retry, open file, show in folder, plain-English errors, and a one-click yt-dlp update.

MP4 uses `bv*[vcodec^=avc1]+ba[ext=m4a]/bv*+ba/b` (H.264 + AAC, plays everywhere).

## Requirements
- Windows, and a Chromium browser (Brave, Chrome, Edge, Opera, Vivaldi).
- [Python 3](https://www.python.org/downloads/) (runs the small helper that starts yt-dlp).
- **Stacher7** installed: StacherQuick uses its yt-dlp and ffmpeg, so they stay updated together.
  No Stacher? Setup can download yt-dlp, ffmpeg and deno for you instead.

## Agent Prompt
For AI agents with computer use:

```text
Install StacherQuick on this Windows PC: download and unzip https://github.com/WolvePlex463/StacherQuick/releases/latest/download/StacherQuick.zip to my Documents folder, install Python 3 if it's missing, run setup.ps1 there with -Yes, then load its "extension" folder as an unpacked extension in my browser (or walk me through it) and confirm the StacherQuick icon shows a green dot.
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
