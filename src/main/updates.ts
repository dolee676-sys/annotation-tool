import { app, net } from 'electron'
import { execFile, spawn } from 'node:child_process'
import {
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
import { isNewerVersion, parseReleaseVersion } from '../shared/version'
import { APPLY_SCRIPT } from './applyUpdateScript'
import { parseApplyResult, parseChecksum, verifyDownloadedFile } from './updateSafety'

const run = promisify(execFile)
const REPO = 'dolee676-sys/annotation-tool'
const LATEST_URL = `https://github.com/${REPO}/releases/latest`
const ASSET_NAME = 'zhujie-win-x64.zip'
const CHECKSUM_NAME = `${ASSET_NAME}.sha256`
const USER_AGENT = 'zhujie-updater'
const MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024


function psQuote(value: string): string {
  return value.replace(/'/g, "''")
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function httpFetch(url: string, init: RequestInit): Promise<Response> {
  if (!app.isReady()) return fetch(url, init)
  try {
    // Electron 的网络栈会跟随 Windows 系统代理；Node 的 fetch 不走系统代理。
    return await net.fetch(url, init)
  } catch (error) {
    return fetch(url, init)
  }
}

function friendlyCheckError(error: unknown): string {
  const raw = messageOf(error)
  if (
    /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|network|socket|terminated|aborted/i.test(
      raw
    )
  ) {
    return '检查更新失败：连不上 GitHub。请检查网络或代理，然后点「检查更新」重试。'
  }
  return raw
}

export interface UpdateManagerOptions {
  currentVersion: string
  onStatus: (status: UpdateStatus) => void
  onProgress: (progress: number, message: string) => void
  onBeforeInstall: () => void
  shouldAutoDownload: () => boolean
  onAvailable: (latest: string, releaseUrl: string) => void
}

export class UpdateManager {
  private readonly currentVersion: string
  private readonly onStatus: (status: UpdateStatus) => void
  private readonly onProgress: (progress: number, message: string) => void
  private readonly onBeforeInstall: () => void
  private readonly shouldAutoDownload: () => boolean
  private readonly onAvailable: (latest: string, releaseUrl: string) => void
  private status: UpdateStatus
  private busy = false
  private downloading = false

  constructor(options: UpdateManagerOptions) {
    this.currentVersion = options.currentVersion
    this.onStatus = options.onStatus
    this.onProgress = options.onProgress
    this.onBeforeInstall = options.onBeforeInstall
    this.shouldAutoDownload = options.shouldAutoDownload
    this.onAvailable = options.onAvailable
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
      const latest = await this.fetchLatestVersionWithRetry()
      if (!isNewerVersion(latest, this.currentVersion)) {
        const localAhead = isNewerVersion(this.currentVersion, latest)
        this.setStatus({
          phase: 'latest',
          currentVersion: this.currentVersion,
          latestVersion: latest,
          message: localAhead
            ? `线上最新 v${latest}；当前本地 v${this.currentVersion}（本地构建较新）`
            : `已是最新版本 v${latest}`
        })
        return this.status
      }

      const releaseUrl = `https://github.com/${REPO}/releases/tag/v${latest}`
      this.setStatus({
        phase: 'available',
        currentVersion: this.currentVersion,
        latestVersion: latest,
        releaseUrl,
        message: `发现新版本 v${latest}`
      })
      if (this.shouldAutoDownload()) {
        await this.downloadRelease(latest, releaseUrl)
      } else {
        try {
          this.onAvailable(latest, releaseUrl)
        } catch {
          /* 提示失败不影响状态，用户仍可在设置里下载 */
        }
      }
      return this.status
    } catch (error) {
      rmSync(this.updateDir(), { recursive: true, force: true })
      this.setStatus({
        phase: 'error',
        currentVersion: this.currentVersion,
        latestVersion: this.status.latestVersion,
        message: friendlyCheckError(error)
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
      const raw = readFileSync(file, 'utf8')
      rmSync(file, { force: true })
      return parseApplyResult(raw)
    } catch {
      /* result is best effort */
    }
    return null
  }

  private async fetchLatestVersionWithRetry(): Promise<string> {
    let lastError: unknown
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.fetchLatestVersion()
      } catch (error) {
        lastError = error
        if (attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, 1200))
        }
      }
    }
    throw lastError
  }

  private async fetchLatestVersion(): Promise<string> {
    const res = await httpFetch(LATEST_URL, {
      redirect: 'follow',
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(15000)
    })
    if (!res.ok) throw new Error(`检查更新失败：GitHub 返回 ${res.status}`)
    const fromUrl = parseReleaseVersion(res.url)
    if (fromUrl) return fromUrl
    const version = parseReleaseVersion(res.url, await res.text())
    if (!version) {
      throw new Error('检查更新失败：无法识别最新版本号，请稍后重试或打开下载页。')
    }
    return version
  }

  private updateDir(): string {
    return join(app.getPath('temp'), 'zhujie-update')
  }

  private assetUrl(latest: string, name: string): string {
    return `https://github.com/${REPO}/releases/download/v${latest}/${name}`
  }

  private async fetchChecksum(latest: string): Promise<string> {
    const res = await httpFetch(this.assetUrl(latest, CHECKSUM_NAME), {
      redirect: 'follow',
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(15000)
    })
    if (!res.ok) {
      throw new Error('新版本没有提供 SHA-256 校验文件，已停止自动安装。请到发布页手动下载。')
    }
    const text = await res.text()
    const checksum = parseChecksum(text)
    if (!checksum) throw new Error('更新包校验文件格式不正确，已停止安装。')
    return checksum
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
    const res = await httpFetch(this.assetUrl(latest, ASSET_NAME), {
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
    if (!(await verifyDownloadedFile(zipPath, checksum))) {
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
