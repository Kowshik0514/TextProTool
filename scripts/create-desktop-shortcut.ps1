# Creates a Desktop shortcut that launches TextPro without opening a terminal.
$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$vbs = Join-Path $root 'StartTextPro.vbs'

if (-not (Test-Path $vbs)) {
  throw "Could not find StartTextPro.vbs at $vbs"
}

$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop 'TextPro.lnk'
$wsh = New-Object -ComObject WScript.Shell
$shortcut = $wsh.CreateShortcut($shortcutPath)
$shortcut.TargetPath = 'wscript.exe'
$shortcut.Arguments = "`"$vbs`""
$shortcut.WorkingDirectory = "$root"
$shortcut.WindowStyle = 7
$shortcut.Description = 'TextPro — personal text automation'
$iconCandidate = Join-Path $root 'node_modules\electron\dist\electron.exe'
if (Test-Path $iconCandidate) {
  $shortcut.IconLocation = "$iconCandidate,0"
}
$shortcut.Save()

Write-Host "Desktop shortcut created:"
Write-Host "  $shortcutPath"
Write-Host ""
Write-Host "Double-click it anytime. TextPro runs in the system tray."
Write-Host "Hotkey: Ctrl+Shift+Space"
