import { app } from 'electron'
import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { promisify } from 'node:util'
import type { UpdateStatus } from '../shared/types'
import { isNewerVersion } from '../shared/version'

const run = promisify(execFile)
const REPO = 'dolee676-sys/annotation-tool'
const LATEST_URL = `https://github.com/${REPO}/releases/latest`
const ASSET_NAME = 'zhujie-win-x64.zip'
const CHECKSUM_NAME = `${ASSET_NAME}.sha256`
const USER_AGENT = 'zhujie-updater'
const MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024

const APPLY_SCRIPT = `param(
  [int]$ProcessId,
  [string]$Source,
  [string]$Target,
  [string]$ExeName,
  [string]$Backup,
  [string]$LogPath
)
Wait-Process -Id $ProcessId -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 900
$success = $false
try {
  if (Test-Path -LiteralPath $Backup) {
    Remove-Item -LiteralPath $Backup -Recurse -Force -ErrorAction SilentlyContinue
  }
  New-Item -ItemType Directory -Path $Backup -Force | Out-Null
  Copy-Item -Path (Join-Path $Target '*') -Destination $Backup -Recurse -Force -ErrorAction Stop
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
try {
  Start-Process -FilePath (Join-Path $Target $ExeName)
} catch {
  Add-Content -LiteralPath $LogPath -Value ('restart-failed: ' + $_.Exception.Message) -Encoding UTF8
}
if ($success) {
  Start-Sleep -Milliseconds 800
  Remove-Item -LiteralPath $Backup -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $Source -Recurse -Force -ErrorAction SilentlyContinue
}
`

function psQuote(value: string): string {
  return value.replace(/'/g, "''")
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export interface UpdateManagerOptions {
  currentVersion: string
  onStatus: (status: UpdateStatus) => void
  onProgress: (progress: number, message: string) => void
  onBeforeInstall: () => void
}

export class UpdateManager {
  private readonly currentVersion: string
  private readonly onStatus: (status: UpdateStatus) => void
  private readonly onProgress: (progress: number, message: string) => void
  private readonly onBeforeInstall: () => void
  private status: UpdateStatus
  private busy = false
  private downloading = false

  constructor(options: UpdateManagerOptions) {
    this.currentVersion = options.currentVersion
    this.onStatus = options.onStatus
    this.onProgress = options.onProgress
    this.onBeforeInstall = options.onBeforeInstall
    this.status = { phase: 'idle', currentVersion: this.currentVersion }
  }

  getStatus(): UpdateStatus {
    return this.status
  }

  private setStatus(status: UpdateStatus): void {
    this.status = status
    this.onStatus(status)
  }

  async check(): Promise<UpdateStatus> {
    if (this.busy || this.downloading || this.status.phase === 'downloading') return this.status
    if (this.status.phase === 'ready') return this.status
    this.busy = true
    this.setStatus({ phase: 'checking', currentVersion: this.currentVersion })

    try {
      const latest = await this.fetchLatestVersion()
      if (!isNewerVersion(latest, this.currentVersion)) {
        this.setStatus({
          phase: 'latest',
          currentVersion: this.currentVersion,
          latestVersion: latest,
          message: '已是最新版本'
        })
        return this.status
      }

      const releaseUrl = `https://github.com/${REPO}/releases/tag/v${latest}`
      this.setStatus({
        phase: 'available',
        currentVersion: this.currentVersion,
        latestVersion: latest,
        releaseUrl,
        message: `发现新版本 v${latest}，开始下载`
      })
      // 用户明确要求「检测到更新就自动更新」：这里自动下载并校验，
      // 但安装仍由用户点「重启并更新」触发，避免应用在运行中被替换。
      await this.downloadRelease(latest, releaseUrl)
      return this.status
    } catch (error) {
      rmSync(this.updateDir(), { recursive: true, force: true })
      this.setStatus({
        phase: 'error',
        currentVersion: this.currentVersion,
        latestVersion: this.status.latestVersion,
        message: messageOf(error)
      })
      return this.status
    } finally {
      this.busy = false
    }
  }

  async download(): Promise<UpdateStatus> {
    if (this.downloading || this.busy) return this.status
    const latest = this.status.latestVersion
    const releaseUrl = this.status.releaseUrl
    if (!latest || !['available', 'error'].includes(this.status.phase)) return this.status

    this.downloading = true
    try {
      await this.downloadRelease(latest, releaseUrl)
    } catch (error) {
      rmSync(this.updateDir(), { recursive: true, force: true })
      this.setStatus({
        phase: 'error',
        currentVersion: this.currentVersion,
        latestVersion: latest,
        releaseUrl,
        message: messageOf(error)
      })
    } finally {
      this.downloading = false
    }
    return this.status
  }

  async install(): Promise<{ ok: boolean; error?: string }> {
    if (this.status.phase !== 'ready') {
      return { ok: false, error: '更新包还没有准备好' }
    }
    if (!app.isPackaged) {
      return { ok: false, error: '开发模式不支持自动更新，请使用打包版' }
    }
    const source = join(this.updateDir(), 'extract', 'win-unpacked')
    const exeName = basename(process.execPath)
    const target = dirname(process.execPath)
    if (!existsSync(join(source, exeName))) {
      return { ok: false, error: '更新包文件不完整，请重新下载' }
    }
    const probe = join(target, `.zhujie-write-test-${process.pid}`)
    try {
      writeFileSync(probe, 'test', 'utf8')
      rmSync(probe, { force: true })
    } catch {
      return {
        ok: false,
        error: `安装目录不可写（${target}）。请用管理员身份运行，或到发布页手动下载。`
      }
    }

    const updateDir = this.updateDir()
    const scriptPath = join(updateDir, 'apply-update.ps1')
    const backupPath = join(updateDir, 'backup')
    const logPath = join(updateDir, 'apply-result.txt')
    try {
      writeFileSync(scriptPath, `\uFEFF${APPLY_SCRIPT}`, 'utf8')
      rmSync(logPath, { force: true })
      const child = spawn(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-WindowStyle',
          'Hidden',
          '-File',
          scriptPath,
          String(process.pid),
          source,
          target,
          exeName,
          backupPath,
          logPath
        ],
        { detached: true, stdio: 'ignore', windowsHide: true }
      )
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          child.removeAllListeners('error')
          resolve()
        }, 4000)
        child.once('spawn', () => {
          clearTimeout(timer)
          resolve()
        })
        child.once('error', (error) => {
          clearTimeout(timer)
          reject(error)
        })
      })
      child.unref()
      this.onBeforeInstall()
      return { ok: true }
    } catch (error) {
      return { ok: false, error: `无法启动更新程序：${messageOf(error)}` }
    }
  }

  reportApplyResult(result: { ok: boolean; message?: string }): void {
    if (result.ok) return
    this.setStatus({
      phase: 'error',
      currentVersion: this.currentVersion,
      message: `上次更新安装失败，已回滚到当前版本：${result.message ?? '未知错误'}`
    })
  }

  readApplyResult(): { ok: boolean; message?: string } | null {
    const file = join(this.updateDir(), 'apply-result.txt')
    if (!existsSync(file)) return null
    try {
      const raw = readFileSync(file, 'utf8').replace(/^\uFEFF/, '').trim()
      rmSync(file, { force: true })
      if (raw === 'ok') return { ok: true }
      if (raw.startsWith('fail:')) {
        const index = raw.indexOf('rollback-failed:')
        const message = index >= 0 ? raw.slice(0, index) : raw
        return { ok: false, message: message.replace(/^fail:\s*/, '').trim() || '未知错误' }
      }
    } catch {
      /* result is best effort */
    }
    return null
  }

  private async fetchLatestVersion(): Promise<string> {
    const res = await fetch(LATEST_URL, {
      redirect: 'follow',
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(15000)
    })
    if (!res.ok) throw new Error(`检查更新失败：GitHub 返回 ${res.status}`)
    const match = res.url.match(/\/tag\/v?([0-9]+\.[0-9]+\.[0-9]+)(?:$|[?#])/)
    if (!match) throw new Error('检查更新失败：无法识别最新版本号')
    return match[1]
  }

  private updateDir(): string {
    return join(app.getPath('temp'), 'zhujie-update')
  }

  private assetUrl(latest: string, name: string): string {
    return `https://github.com/${REPO}/releases/download/v${latest}/${name}`
  }

  private async fetchChecksum(latest: string): Promise<string> {
    const res = await fetch(this.assetUrl(latest, CHECKSUM_NAME), {
      redirect: 'follow',
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(15000)
    })
    if (!res.ok) {
      throw new Error('新版本没有提供 SHA-256 校验文件，已停止自动安装。请到发布页手动下载。')
    }
    const text = await res.text()
    const match = text.match(/\b([a-f0-9]{64})\b/i)
    if (!match) throw new Error('更新包校验文件格式不正确，已停止安装。')
    return match[1].toLowerCase()
  }

  private async downloadRelease(latest: string, releaseUrl?: string): Promise<void> {
    const dir = this.updateDir()
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    const zipPath = join(dir, 'update.zip')
    const extractDir = join(dir, 'extract')

    this.setStatus({
      phase: 'downloading',
      currentVersion: this.currentVersion,
      latestVersion: latest,
      progress: 0,
      releaseUrl: releaseUrl ?? `https://github.com/${REPO}/releases/tag/v${latest}`,
      message: '正在下载更新'
    })
    this.onProgress(0, '正在校验发布信息')

    const checksum = await this.fetchChecksum(latest)
    const res = await fetch(this.assetUrl(latest, ASSET_NAME), {
      redirect: 'follow',
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(10 * 60 * 1000)
    })
    if (!res.ok || !res.body) throw new Error(`下载更新失败：GitHub 返回 ${res.status}`)

    const total = Number(res.headers.get('content-length') ?? 0)
    if (total > MAX_DOWNLOAD_BYTES) throw new Error('更新包体积异常，已停止下载。')
    const writer = createWriteStream(zipPath)
    const reader = res.body.getReader()
    let received = 0
    let lastPercent = -1
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = Buffer.from(value)
      received += chunk.length
      if (received > MAX_DOWNLOAD_BYTES) throw new Error('更新包体积异常，已停止下载。')
      await new Promise<void>((resolve, reject) => {
        writer.write(chunk, (error) => (error ? reject(error) : resolve()))
      })
      if (total > 0) {
        const percent = Math.min(99, Math.floor((received / total) * 100))
        if (percent !== lastPercent) {
          lastPercent = percent
          this.onProgress(percent, `正在下载更新 ${percent}%`)
        }
      }
    }
    await new Promise<void>((resolve, reject) => {
      writer.end((error?: Error | null) => (error ? reject(error) : resolve()))
    })

    this.onProgress(100, '正在校验更新包')
    const actual = await sha256File(zipPath)
    if (actual !== checksum) {
      throw new Error('更新包 SHA-256 校验失败，已删除下载内容。')
    }

    this.onProgress(100, '正在解压更新包')
    mkdirSync(extractDir, { recursive: true })
    const command = `Expand-Archive -LiteralPath '${psQuote(zipPath)}' -DestinationPath '${psQuote(extractDir)}' -Force`
    await run(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
      { windowsHide: true, timeout: 180000 }
    )
    rmSync(zipPath, { force: true })

    const source = join(extractDir, 'win-unpacked')
    if (!existsSync(source)) throw new Error('更新包结构不完整')
    this.setStatus({
      phase: 'ready',
      currentVersion: this.currentVersion,
      latestVersion: latest,
      progress: 100,
      releaseUrl: releaseUrl ?? `https://github.com/${REPO}/releases/tag/v${latest}`,
      message: '更新已下载并校验，重启后完成安装'
    })
  }
}

function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(file)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}
