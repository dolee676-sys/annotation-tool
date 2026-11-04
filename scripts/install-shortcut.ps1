param(
  [string]$Source = (Join-Path $PSScriptRoot '..\release\win-unpacked'),
  [string]$InstallDir = 'D:\Apps\zhujie'
)

$ErrorActionPreference = 'Stop'

$exe = Join-Path $Source '注解.exe'
if (-not (Test-Path $exe)) {
  throw "找不到 $exe，请先运行: npm run build 和 electron-builder --win --dir --x64"
}

Get-Process | Where-Object { $_.Path -like "$InstallDir\*.exe" } | Stop-Process -Force -ErrorAction SilentlyContinue
for ($i = 0; $i -lt 20; $i++) {
  $left = @(Get-Process | Where-Object { $_.Path -like "$InstallDir\*.exe" } -ErrorAction SilentlyContinue)
  if ($left.Count -eq 0) { break }
  $left | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 250
}

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
for ($attempt = 1; $attempt -le 4; $attempt++) {
  try {
    Copy-Item -Path (Join-Path $Source '*') -Destination $InstallDir -Recurse -Force -ErrorAction Stop
    break
  } catch {
    if ($attempt -eq 4) { throw }
    Start-Sleep -Seconds 1
  }
}

$sourceExe = Get-FileHash $exe -Algorithm SHA256
$installedExe = Get-FileHash (Join-Path $InstallDir '注解.exe') -Algorithm SHA256
if ($sourceExe.Hash -ne $installedExe.Hash) { throw '安装后 exe 校验失败' }
$sourceAsar = Join-Path $Source 'resources\app.asar'
$installedAsar = Join-Path $InstallDir 'resources\app.asar'
if ((Get-FileHash $sourceAsar -Algorithm SHA256).Hash -ne (Get-FileHash $installedAsar -Algorithm SHA256).Hash) {
  throw '安装后 app.asar 校验失败'
}
Write-Output ('VERIFIED=' + $installedExe.Hash.Substring(0, 12))

$iconSource = Join-Path $PSScriptRoot '..\build\icon.ico'
$iconTarget = Join-Path $InstallDir 'icon.ico'
if (Test-Path $iconSource) {
  Copy-Item $iconSource $iconTarget -Force
}

$desktop = [Environment]::GetFolderPath('Desktop')
$lnkPath = Join-Path $desktop '注解.lnk'
$shell = New-Object -ComObject WScript.Shell
$lnk = $shell.CreateShortcut($lnkPath)
$lnk.TargetPath = Join-Path $InstallDir '注解.exe'
$lnk.WorkingDirectory = $InstallDir
if (Test-Path $iconTarget) {
  $lnk.IconLocation = $iconTarget + ',0'
} else {
  $lnk.IconLocation = (Join-Path $InstallDir '注解.exe') + ',0'
}
$lnk.Description = '划词 AI 注解：选中文字，旁边出现「注解」'
$lnk.Save()

Write-Output "INSTALLED=$InstallDir"
Write-Output "SHORTCUT=$lnkPath"
