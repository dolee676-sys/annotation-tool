export const APPLY_SCRIPT = `param(
  [int]$ProcessId,
  [string]$Source,
  [string]$Target,
  [string]$ExeName,
  [string]$Backup,
  [string]$LogPath,
  [switch]$SkipRestart,
  [switch]$SimulateFailure,
  [int]$SettleMs = 900
)
Wait-Process -Id $ProcessId -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds $SettleMs
$success = $false
try {
  if (Test-Path -LiteralPath $Backup) {
    Remove-Item -LiteralPath $Backup -Recurse -Force -ErrorAction SilentlyContinue
  }
  New-Item -ItemType Directory -Path $Backup -Force | Out-Null
  Copy-Item -Path (Join-Path $Target '*') -Destination $Backup -Recurse -Force -ErrorAction Stop
  if ($SimulateFailure) {
    throw 'simulated-copy-failure'
  }
  Copy-Item -Path (Join-Path $Source '*') -Destination $Target -Recurse -Force -ErrorAction Stop
  if (-not (Test-Path -LiteralPath (Join-Path $Target $ExeName))) {
    throw '安装后找不到主程序'
  }
  $success = $true
  Set-Content -LiteralPath $LogPath -Value 'ok' -Encoding UTF8
} catch {
  $message = $_.Exception.Message
  Set-Content -LiteralPath $LogPath -Value ('fail: ' + $message) -Encoding UTF8
  try {
    if (Test-Path -LiteralPath $Backup) {
      Copy-Item -Path (Join-Path $Backup '*') -Destination $Target -Recurse -Force -ErrorAction Stop
    }
  } catch {
    Add-Content -LiteralPath $LogPath -Value ('rollback-failed: ' + $_.Exception.Message) -Encoding UTF8
  }
}
if (-not $SkipRestart) {
  try {
    Start-Process -FilePath (Join-Path $Target $ExeName)
  } catch {
    Add-Content -LiteralPath $LogPath -Value ('restart-failed: ' + $_.Exception.Message) -Encoding UTF8
  }
}
if ($success) {
  if (-not $SkipRestart) {
    Start-Sleep -Milliseconds 800
  }
  Remove-Item -LiteralPath $Backup -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $Source -Recurse -Force -ErrorAction SilentlyContinue
}
`
