# Adds or removes a Windows sign-in shortcut so TextPro starts with Windows.
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/set-windows-startup.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/set-windows-startup.ps1 -Remove
param(
  [switch]$Remove
)

$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$vbs = Join-Path $root 'StartTextPro.vbs'
$startup = [Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startup 'TextPro.lnk'

if ($Remove) {
  if (Test-Path $shortcutPath) {
    Remove-Item $shortcutPath -Force
    Write-Host "Removed Windows startup entry:"
    Write-Host "  $shortcutPath"
  } else {
    Write-Host "TextPro was not set to start with Windows."
  }
  exit 0
}

if (-not (Test-Path $vbs)) {
  throw "Could not find StartTextPro.vbs at $vbs"
}

$wsh = New-Object -ComObject WScript.Shell
$shortcut = $wsh.CreateShortcut($shortcutPath)
$shortcut.TargetPath = 'wscript.exe'
$shortcut.Arguments = "`"$vbs`""
$shortcut.WorkingDirectory = "$root"
$shortcut.WindowStyle = 7
$shortcut.Description = 'TextPro — start with Windows'
$iconCandidate = Join-Path $root 'node_modules\electron\dist\electron.exe'
if (Test-Path $iconCandidate) {
  $shortcut.IconLocation = "$iconCandidate,0"
}
$shortcut.Save()

Write-Host "TextPro will start when you sign in to Windows."
Write-Host "  $shortcutPath"
Write-Host ""
Write-Host "To turn this off later: npm run startup:off"
