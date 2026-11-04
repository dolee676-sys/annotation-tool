import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { AppEntry } from '../shared/types'

const run = promisify(execFile)

const POWERSHELL_PRELUDE = `
$ErrorActionPreference='SilentlyContinue'
[Console]::OutputEncoding=[System.Text.Encoding]::UTF8
`

const RUNNING_SCRIPT = `${POWERSHELL_PRELUDE}
$items = Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | ForEach-Object {
  [PSCustomObject]@{ Name = $_.ProcessName; Title = $_.MainWindowTitle; Path = $_.Path }
}
ConvertTo-Json -InputObject @($items) -Compress -Depth 3
`

const INSTALLED_SCRIPT = `${POWERSHELL_PRELUDE}
$shell = New-Object -ComObject WScript.Shell
$dirs = @("$env:ProgramData\\Microsoft\\Windows\\Start Menu\\Programs", "$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs")
$items = Get-ChildItem -Path $dirs -Filter *.lnk -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
  $target = $shell.CreateShortcut($_.FullName).TargetPath
  if ($target -and $target -match '\\.exe$') {
    [PSCustomObject]@{ Name = $_.BaseName; Path = $target }
  }
}
ConvertTo-Json -InputObject @($items) -Compress -Depth 3
`

const BAD_NAMES =
  /(卸载|uninstall|帮助|help|readme|website|文档|documentation|license|许可证|更新程序|check for updates)/i
const BAD_EXES =
  /^(unins\d*|uninstall|setup|update|crashpad_handler|node|python|pythonw|cmd|powershell|wscript|cscript|applicationframehost|shellexperiencehost|startmenuexperiencehost|searchexperiencehost|searchhost|textinputhost|lockapp|widgetservice|nvidia overlay|nvidia share|nvsphelper64|gameviewerserver)\.exe$/i

function normalizeExe(name: string): string {
  const base = name.trim().toLowerCase().split(/[\\/]/).pop() ?? ''
  return base.endsWith('.exe') ? base : `${base}.exe`
}

function stripExe(name: string): string {
  return name.replace(/\.exe$/i, '')
}

function parseJson(raw: string): unknown[] {
  const text = raw.trim()
  if (!text) return []
  try {
    const parsed = JSON.parse(text) as unknown
    if (Array.isArray(parsed)) return parsed
    if (parsed && typeof parsed === 'object') return [parsed]
    return []
  } catch {
    return []
  }
}

type RawRunning = { Name?: string; Title?: string; Path?: string }
type RawInstalled = { Name?: string; Path?: string }

let cache: { at: number; items: AppEntry[] } | null = null

export async function listInstalledApps(force = false): Promise<AppEntry[]> {
  if (process.platform !== 'win32') return []
  if (!force && cache && Date.now() - cache.at < 30_000) return cache.items

  const options = { timeout: 20_000, maxBuffer: 20 * 1024 * 1024, windowsHide: true }
  const [runningResult, installedResult] = await Promise.allSettled([
    run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', RUNNING_SCRIPT], options),
    run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', INSTALLED_SCRIPT], options)
  ])

  const running = runningResult.status === 'fulfilled' ? parseJson(runningResult.value.stdout) : []
  const installed = installedResult.status === 'fulfilled' ? parseJson(installedResult.value.stdout) : []

  const map = new Map<string, AppEntry>()

  for (const item of installed as RawInstalled[]) {
    if (!item.Name || !item.Path) continue
    if (BAD_NAMES.test(item.Name)) continue
    const exe = item.Path.split(/[\\/]/).pop() ?? ''
    if (!exe || BAD_EXES.test(exe)) continue
    const key = normalizeExe(exe)
    if (map.has(key)) continue
    map.set(key, {
      processName: exe,
      name: item.Name.trim(),
      path: item.Path,
      running: false,
      installed: true
    })
  }

  for (const item of running as RawRunning[]) {
    if (!item.Name) continue
    const exe = item.Name.toLowerCase().endsWith('.exe') ? item.Name : `${item.Name}.exe`
    if (BAD_EXES.test(exe)) continue
    if (/^(注解|zhujie)\.exe$/i.test(exe)) continue
    const key = normalizeExe(exe)
    const existing = map.get(key)
    if (existing) {
      existing.running = true
      existing.title = item.Title?.trim() || existing.title
      if (item.Path) existing.path = item.Path
    } else {
      map.set(key, {
        processName: exe,
        name: stripExe(item.Name),
        path: item.Path,
        running: true,
        installed: false,
        title: item.Title?.trim()
      })
    }
  }

  const items = Array.from(map.values()).sort((a, b) => {
    if (a.running !== b.running) return a.running ? -1 : 1
    return a.name.localeCompare(b.name, 'zh-CN')
  })

  cache = { at: Date.now(), items }
  return items
}
