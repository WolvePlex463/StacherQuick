@echo off
rem Removes the helper registration. Then remove the extension in your browser and delete this folder.
for %%K in (
  "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.stacherquick.host"
  "HKCU\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.stacherquick.host"
  "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.stacherquick.host"
  "HKCU\Software\Chromium\NativeMessagingHosts\com.stacherquick.host"
  "HKCU\Software\Vivaldi\NativeMessagingHosts\com.stacherquick.host"
) do reg delete %%K /f >nul 2>&1
echo StacherQuick helper unregistered. Remove the extension from your browser, then delete this folder.
pause
