$ErrorActionPreference = 'SilentlyContinue'
$AppName = 'ODA Component Doc Specification Web Studio'
$InstallDir = Join-Path $env:LOCALAPPDATA 'Programs\ComponentDocSpecStudio'

Write-Host "Uninstalling $AppName ..."

Get-Process -Name 'ComponentDocSpecStudio' | Stop-Process -Force

$StartMenuDir = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
Remove-Item -Force (Join-Path $StartMenuDir "$AppName.lnk")

Remove-Item -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\ComponentDocSpecStudio' -Recurse -Force

Write-Host "Removed shortcut and registry entry."

# This script runs from inside $InstallDir, so it can't delete its own
# containing folder directly (the running .ps1 file holds a lock on itself).
# Hand off the folder removal to a detached cmd that waits for this process
# to exit first.
$cmd = "timeout /t 2 /nobreak >nul & rmdir /s /q `"$InstallDir`""
Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', $cmd -WindowStyle Hidden

Write-Host "$AppName uninstalled."
Start-Sleep -Seconds 2
