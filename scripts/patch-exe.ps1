param(
  [string]$ExePath = (Join-Path $PSScriptRoot '..\release\win-unpacked\注解.exe'),
  [string]$IconPath = (Join-Path $PSScriptRoot '..\build\icon.ico')
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $ExePath)) { throw "找不到 exe: $ExePath" }
if (-not (Test-Path $IconPath)) { throw "找不到图标: $IconPath" }

$exe = (Resolve-Path $ExePath).Path
$icon = (Resolve-Path $IconPath).Path
$pkg = Get-Content (Join-Path $PSScriptRoot '..\package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$version = [string]$pkg.version

$rcedit = Get-ChildItem (Join-Path $env:LOCALAPPDATA 'electron-builder\Cache\winCodeSign') -Recurse -Filter 'rcedit-x64.exe' -ErrorAction SilentlyContinue |
  Select-Object -First 1
if (-not $rcedit) { throw '找不到 rcedit-x64.exe；请先运行一次 electron-builder 以生成缓存' }

& $rcedit.FullName $exe `
  --set-icon $icon `
  --set-file-version $version `
  --set-product-version $version `
  --set-version-string 'CompanyName' 'piona' `
  --set-version-string 'FileDescription' '注解 · 划词 AI 助手' `
  --set-version-string 'ProductName' '注解' `
  --set-version-string 'LegalCopyright' 'Copyright © 2026 piona'

if ($LASTEXITCODE -ne 0) { throw "rcedit 失败，退出码 $LASTEXITCODE" }
Write-Output "PATCHED=$exe VERSION=$version ICON=$icon"
