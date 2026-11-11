import { BrowserWindow, Menu, Tray, app, nativeImage, screen, shell } from 'electron'
import { translate, type Locale } from '../shared/i18n'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { isTrustedRendererUrl, rendererFileUrl } from './security'

const preloadPath = (name: 'index' | 'panel' | 'chip'): string =>
  join(__dirname, '../preload', `${name}.js`)

const CHIP_WIDTH = 120
const CHIP_HEIGHT = 48

const rendererIndex = (): string => join(__dirname, '../renderer/index.html')

function isTrustedUrl(url: string): boolean {
  return isTrustedRendererUrl(
    url,
    rendererFileUrl(rendererIndex()),
    process.env['ELECTRON_RENDERER_URL']
  )
}

function hardenWindow(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  const guard = (event: Electron.Event, url: string): void => {
    if (isTrustedUrl(url)) return
    event.preventDefault()
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
  }
  win.webContents.on('will-navigate', guard)
  win.webContents.on('will-redirect', guard)
  win.webContents.on('will-frame-navigate', (details) => {
    if (details.isMainFrame || isTrustedUrl(details.url)) return
    details.preventDefault()
  })
}

function debugWindow(win: BrowserWindow): void {
  if (!process.argv.includes('--selftest')) return
  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.log('[renderer]', level, message, `${sourceId}:${line}`)
  })
  win.webContents.on('did-fail-load', (_event, code, desc, url) => {
    console.log('[load-fail]', code, desc, url)
  })
  win.webContents.on('preload-error', (_event, path, error) => {
    console.log('[preload-error]', path, error.message)
  })
  win.webContents.on('render-process-gone', (_event, details) => {
    console.log('[render-gone]', details.reason)
  })
  win.webContents.on('did-finish-load', () => {
    console.log('[did-finish-load]', win.webContents.getURL())
  })
  win.webContents.on('dom-ready', () => {
    console.log('[dom-ready]', win.webContents.getURL())
  })
}

function loadPage(win: BrowserWindow, hash = ''): void {
  debugWindow(win)
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    const url = `${devUrl}/index.html${hash ? `#${hash}` : ''}`
    void win.loadURL(url)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { hash: hash || undefined })
  }
}

function assetPath(name: string): string {
  const dev = join(__dirname, '../../resources', name)
  if (existsSync(dev)) return dev
  return join(app.getAppPath(), 'resources', name)
}

export class WindowManager {
  chip: BrowserWindow | null = null
  panel: BrowserWindow | null = null
  settings: BrowserWindow | null = null
  private tray: Tray | null = null
  private quitting = false

  constructor(
    private readonly onEnableToggle: (enabled: boolean) => void,
    private readonly isEnabled: () => boolean,
    private readonly getLocale: () => Locale
  ) {}

  createChip(): void {
    if (this.chip && !this.chip.isDestroyed()) return
    this.chip = new BrowserWindow({
      width: CHIP_WIDTH,
      height: CHIP_HEIGHT,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      focusable: false,
      hasShadow: false,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: preloadPath('chip'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    this.chip.setAlwaysOnTop(true, 'screen-saver')
    this.chip.setHasShadow(false)
    this.chip.setMenu(null)
    hardenWindow(this.chip)
    loadPage(this.chip, 'chip')
    this.chip.on('closed', () => {
      this.chip = null
    })
  }

  showChip(x: number, y: number): void {
    if (!this.chip || this.chip.isDestroyed()) this.createChip()
    const chip = this.chip
    if (!chip) return
    const display = screen.getDisplayNearestPoint({ x, y })
    const area = display.workArea
    const width = CHIP_WIDTH
    const height = CHIP_HEIGHT
    const left = Math.min(Math.max(x, area.x + 4), area.x + area.width - width - 4)
    const top = Math.min(Math.max(y, area.y + 4), area.y + area.height - height - 4)
    chip.setBounds({ x: Math.round(left), y: Math.round(top), width, height })
    chip.setAlwaysOnTop(true, 'screen-saver')
    chip.showInactive()
    chip.moveTop()
    chip.webContents.send('chip:appear')
  }

  hideChip(): void {
    if (this.chip && !this.chip.isDestroyed() && this.chip.isVisible()) this.chip.hide()
  }

  chipBounds(): Electron.Rectangle | null {
    if (!this.chip || this.chip.isDestroyed() || !this.chip.isVisible()) return null
    return this.chip.getBounds()
  }

  openPanel(
    anchor: { x: number; y: number; preferAbove: boolean },
    options: { deferFocus?: boolean } = {}
  ): BrowserWindow {
    this.hideChip()
    if (this.panel && !this.panel.isDestroyed()) {
      this.panel.destroy()
      this.panel = null
    }
    const display = screen.getDisplayNearestPoint({ x: anchor.x, y: anchor.y })
    const area = display.workArea
    const width = Math.min(600, area.width - 16)
    const height = Math.min(640, area.height - 24)
    let left = anchor.x + 18
    if (left + width > area.x + area.width - 8) left = anchor.x - width - 18
    left = Math.min(Math.max(left, area.x + 8), area.x + area.width - width - 8)
    let top = anchor.preferAbove ? anchor.y - height - 10 : anchor.y + 12
    if (top + height > area.y + area.height - 8) top = anchor.y - height - 10
    top = Math.min(Math.max(top, area.y + 8), area.y + area.height - height - 8)

    const panel = new BrowserWindow({
      x: Math.round(left),
      y: Math.round(top),
      width,
      height,
      minWidth: 420,
      minHeight: 360,
      show: false,
      frame: false,
      transparent: true,
      resizable: true,
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: preloadPath('panel'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    // 全屏应用（如 OneNote 全屏）会盖住 floating 级窗口，这里必须用
    // screen-saver 级，和划词小框保持一致，面板才能出现在全屏内容之上。
    panel.setAlwaysOnTop(true, 'screen-saver')
    panel.setMenu(null)
    this.panel = panel

    panel.on('closed', () => {
      if (this.panel === panel) this.panel = null
    })
    hardenWindow(panel)
    loadPage(panel, 'panel')
    panel.once('ready-to-show', () => {
      panel.setAlwaysOnTop(true, 'screen-saver')
      if (options.deferFocus) panel.showInactive()
      else {
        panel.show()
        panel.focus()
      }
      panel.moveTop()
    })
    return panel
  }

  bringPanelToFront(): void {
    const panel = this.panel
    if (!panel || panel.isDestroyed()) return
    panel.setAlwaysOnTop(true, 'screen-saver')
    panel.moveTop()
  }

  focusPanel(): void {
    const panel = this.panel
    if (!panel || panel.isDestroyed() || !panel.isVisible()) return
    panel.setAlwaysOnTop(true, 'screen-saver')
    panel.show()
    panel.focus()
    panel.moveTop()
  }

  sendPanel(channel: string, payload?: unknown): void {
    if (this.panel && !this.panel.isDestroyed()) this.panel.webContents.send(channel, payload)
  }

  closePanel(): void {
    if (this.panel && !this.panel.isDestroyed()) this.panel.destroy()
    this.panel = null
  }

  openSettings(): void {
    if (this.settings && !this.settings.isDestroyed()) {
      this.settings.show()
      this.settings.focus()
      return
    }
    this.settings = new BrowserWindow({
      width: 1000,
      height: 740,
      minWidth: 880,
      minHeight: 620,
      show: false,
      frame: false,
      backgroundColor: '#f7f4ed',
      autoHideMenuBar: true,
      webPreferences: {
        preload: preloadPath('index'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    this.settings.setMenu(null)
    hardenWindow(this.settings)
    this.settings.once('ready-to-show', () => {
      this.settings?.show()
      this.settings?.focus()
    })
    this.settings.on('close', () => {
      if (!this.quitting) {
        this.quitting = true
        app.quit()
      }
    })
    this.settings.on('closed', () => {
      this.settings = null
    })
    loadPage(this.settings)
  }

  broadcast(channel: string, payload?: unknown): void {
    for (const win of [this.chip, this.panel, this.settings]) {
      if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
    }
  }

  createTray(): void {
    if (this.tray) return
    const iconFile = assetPath('tray.png')
    let image = nativeImage.createFromPath(iconFile)
    if (image.isEmpty()) image = nativeImage.createEmpty()
    this.tray = new Tray(image.resize({ width: 16, height: 16 }))
    this.tray.setToolTip(translate(this.getLocale(), '注解 · 划词 AI 助手'))
    const rebuild = (): void => {
      if (!this.tray) return
      const t = (key: string): string => translate(this.getLocale(), key)
      this.tray.setContextMenu(
        Menu.buildFromTemplate([
          { label: t('打开设置'), click: () => this.openSettings() },
          {
            label: t('启用划词注解'),
            type: 'checkbox',
            checked: this.isEnabled(),
            click: (item) => this.onEnableToggle(item.checked)
          },
          { type: 'separator' },
          {
            label: t('退出'),
            click: () => {
              this.quitting = true
              app.quit()
            }
          }
        ])
      )
    }
    rebuild()
    this.tray.on('click', () => this.openSettings())
    this.tray.on('right-click', rebuild)
  }

  markQuitting(): void {
    this.quitting = true
  }

  isQuitting(): boolean {
    return this.quitting
  }
}
