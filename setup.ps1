# StacherQuick setup: points the browser at the helper and makes sure yt-dlp + ffmpeg exist.
# Run with setup.bat (no admin needed; everything goes in your user account).
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$hostDir = Join-Path $root "host"
$tools = Join-Path $root "tools"
$stacher = Join-Path $env:USERPROFILE ".stacher"

function Say($t, $c = "Gray") { Write-Host $t -ForegroundColor $c }
Say "`nStacherQuick setup`n" Cyan

# 1. Python (needs tkinter for the folder picker)
$py = $null
$probe = 'import sys, tkinter; print(sys.executable)'
foreach ($cand in @(@("py", "-3"), @("python"), @("python3"))) {
    try {
        $exe = $cand[0]; $rest = @($cand | Select-Object -Skip 1)
        $out = & $exe @rest -c $probe 2>$null
        if ($LASTEXITCODE -eq 0 -and $out -and (Test-Path $out.Trim())) { $py = $out.Trim(); break }
    } catch {}
}
if (-not $py) {
    Say "Python 3 wasn't found." Red
    Say "Install it from https://www.python.org/downloads/ (keep 'tcl/tk' ticked), then run setup.bat again."
    exit 1
}
Say "Python: $py" Green
Set-Content -Path (Join-Path $hostDir "host.bat") -Encoding ASCII -Value "@echo off`r`n`"$py`" -u `"%~dp0host.py`" %*"

# 2. Register the helper with every Chromium browser
$json = Join-Path $hostDir "com.stacherquick.host.json"
$keys = @(
    "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.stacherquick.host",        # Chrome, Opera, Vivaldi
    "HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.stacherquick.host",
    "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.stacherquick.host",
    "HKCU:\Software\Chromium\NativeMessagingHosts\com.stacherquick.host",
    "HKCU:\Software\Vivaldi\NativeMessagingHosts\com.stacherquick.host"
)
foreach ($k in $keys) {
    New-Item -Path $k -Force | Out-Null
    Set-ItemProperty -Path $k -Name "(default)" -Value $json
}
Say "Helper registered for Chrome, Brave, Edge, Opera, Vivaldi, Chromium." Green

# 3. yt-dlp / ffmpeg / deno
function Have($name) {
    (Test-Path (Join-Path $stacher "$name.exe")) -or (Test-Path (Join-Path $tools "$name.exe")) -or (Get-Command $name -ErrorAction SilentlyContinue)
}
if (Test-Path (Join-Path $stacher "yt-dlp.exe")) {
    Say "Stacher7 found: using its yt-dlp and ffmpeg." Green
} elseif ((Have "yt-dlp") -and (Have "ffmpeg")) {
    Say "yt-dlp and ffmpeg found." Green
} else {
    Say "Stacher7 isn't installed and yt-dlp/ffmpeg weren't found."
    $a = Read-Host "Download yt-dlp, ffmpeg and deno into $tools now? (about 150 MB) [Y/n]"
    if ($a -notmatch '^[nN]') {
        New-Item -ItemType Directory -Force $tools | Out-Null
        $tmp = Join-Path $env:TEMP "stacherquick-setup"
        New-Item -ItemType Directory -Force $tmp | Out-Null
        $ProgressPreference = "SilentlyContinue"
        if (-not (Have "yt-dlp")) {
            Say "Downloading yt-dlp..."
            Invoke-WebRequest "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe" -OutFile (Join-Path $tools "yt-dlp.exe")
        }
        if (-not (Have "ffmpeg")) {
            Say "Downloading ffmpeg..."
            $z = Join-Path $tmp "ffmpeg.zip"
            Invoke-WebRequest "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip" -OutFile $z
            Expand-Archive $z -DestinationPath (Join-Path $tmp "ff") -Force
            Get-ChildItem (Join-Path $tmp "ff") -Recurse -Include ffmpeg.exe, ffprobe.exe | Copy-Item -Destination $tools -Force
        }
        if (-not (Have "deno")) {
            Say "Downloading deno (YouTube needs it for some videos)..."
            $z = Join-Path $tmp "deno.zip"
            Invoke-WebRequest "https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip" -OutFile $z
            Expand-Archive $z -DestinationPath $tools -Force
        }
        Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
        Say "Tools installed in $tools" Green
    } else {
        Say "Skipped. Install Stacher7, or put yt-dlp.exe and ffmpeg.exe in $tools, then reload the extension." Yellow
    }
}

Say "`nDone. Now load the extension:" Cyan
Say "  1. Open brave://extensions (or chrome://extensions, edge://extensions)"
Say "  2. Turn on Developer mode"
Say "  3. Load unpacked -> pick the 'extension' folder in $root"
Say "  4. Click the StacherQuick icon: the dot should be green.`n"
