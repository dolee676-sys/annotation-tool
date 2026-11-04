import { screen } from 'electron'

type SelectionHookCtor = new () => SelectionHookInstance

interface SelectionHookInstance {
  on(event: 'text-selection', cb: (data: RawSelection) => void): void
  on(event: 'mouse-down', cb: (data: MousePoint & { button?: number }) => void): void
  on(event: 'mouse-wheel', cb: (data: MousePoint & { flag?: number }) => void): void
  on(event: 'key-down', cb: (data: { uniKey?: string; vkCode?: number }) => void): void
  on(event: 'status', cb: (status: string) => void): void
  on(event: 'error', cb: (err: Error) => void): void
  start(config?: Record<string, unknown>): boolean
  stop(): void
  cleanup(): void
  getCurrentSelection(): RawSelection | null
  isRunning?(): boolean
  isAccessibilityTrusted?(): boolean
}

export interface Point {
  x: number
  y: number
}

export interface MousePoint {
  x: number
  y: number
}

export interface RawSelection {
  text: string
  programName?: string
  startTop?: Point
  startBottom?: Point
  endTop?: Point
  endBottom?: Point
  mousePosStart?: Point
  mousePosEnd?: Point
  method?: number
  posLevel?: number
  isFullscreen?: boolean
}

export type HookStatus = 'starting' | 'running' | 'stopped' | 'error'

interface SelectionHandlers {
  onSelection: (data: RawSelection) => void
  onMouseDown: (point: MousePoint) => void
  onWheel: () => void
  onEscape: () => void
  onStatus: (status: HookStatus, error?: string) => void
}

const INVALID_COORDINATE = -99999

export class SelectionService {
  private hook: SelectionHookInstance | null = null
  private handlers: SelectionHandlers
  status: HookStatus = 'stopped'
  error?: string

  constructor(handlers: SelectionHandlers) {
    this.handlers = handlers
  }

  start(): void {
    if (this.hook) return
    this.status = 'starting'
    try {
      // selection-hook is a native N-API CommonJS module; keep the require so
      // electron-vite does not try to bundle the prebuilt binary.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const SelectionHook = require('selection-hook') as SelectionHookCtor
      const hook = new SelectionHook()
      hook.on('text-selection', (data) => {
        this.handlers.onSelection(data)
      })
      hook.on('mouse-down', (data) => {
        this.handlers.onMouseDown({ x: data.x, y: data.y })
      })
      hook.on('mouse-wheel', () => this.handlers.onWheel())
      hook.on('key-down', (data) => {
        if (data.uniKey === 'Escape') this.handlers.onEscape()
      })
      hook.on('status', (status) => {
        if (status === 'started') this.setStatus('running')
        else if (status === 'stopped') this.setStatus('stopped')
      })
      hook.on('error', (err) => {
        this.error = err.message
        this.setStatus('error', err.message)
      })
      hook.start({ enableClipboard: true, debug: false })
      this.hook = hook
      this.setStatus('running')
    } catch (error) {
      this.hook = null
      this.error = error instanceof Error ? error.message : String(error)
      this.setStatus('error', this.error)
    }
  }

  private setStatus(status: HookStatus, error?: string): void {
    this.status = status
    if (error) this.error = error
    this.handlers.onStatus(status, error)
  }

  stop(): void {
    if (!this.hook) return
    try {
      this.hook.stop()
      this.hook.cleanup()
    } catch {
      /* native cleanup best effort */
    }
    this.hook = null
    this.setStatus('stopped')
  }

  isRunning(): boolean {
    return this.status === 'running'
  }
}

export function isUsablePoint(point?: Point | null): point is Point {
  return Boolean(
    point &&
      Number.isFinite(point.x) &&
      Number.isFinite(point.y) &&
      point.x > INVALID_COORDINATE + 1 &&
      point.y > INVALID_COORDINATE + 1
  )
}

export function toDipPoint(point: Point): Point {
  if (process.platform !== 'win32' && process.platform !== 'linux') return point
  const anyScreen = screen as unknown as {
    screenToDipPoint?: (p: Point) => Point
  }
  if (typeof anyScreen.screenToDipPoint === 'function') {
    try {
      return anyScreen.screenToDipPoint(point)
    } catch {
      /* fall through to manual conversion */
    }
  }
  const display = screen.getPrimaryDisplay()
  const scale = display.scaleFactor || 1
  return { x: point.x / scale, y: point.y / scale }
}
