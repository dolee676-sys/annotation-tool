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

type SelectionHookCtor = new () => SelectionHookInstance

export interface SelectionHookInstance {
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

export type SelectionHookFactory = () => SelectionHookInstance

export interface SelectionHandlers {
  onSelection: (data: RawSelection) => void
  onMouseDown: (point: MousePoint) => void
  onWheel: () => void
  onEscape: () => void
  onStatus: (status: HookStatus, error?: string) => void
}

function defaultFactory(): SelectionHookInstance {
  // selection-hook is a native N-API CommonJS module; keep the require so
  // electron-vite does not try to bundle the prebuilt binary.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const SelectionHook = require('selection-hook') as SelectionHookCtor
  return new SelectionHook()
}

export class SelectionService {
  private hook: SelectionHookInstance | null = null
  private readonly handlers: SelectionHandlers
  private readonly factory: SelectionHookFactory
  status: HookStatus = 'stopped'
  error?: string

  constructor(handlers: SelectionHandlers, factory: SelectionHookFactory = defaultFactory) {
    this.handlers = handlers
    this.factory = factory
  }

  start(): boolean {
    if (this.hook) return this.isRunning()
    this.error = undefined
    let hook: SelectionHookInstance | null = null
    let startFailure: string | null = null

    const dispose = (): void => {
      if (!hook) return
      try {
        hook.stop()
        hook.cleanup()
      } catch {
        /* native cleanup best effort */
      }
      hook = null
    }

    try {
      hook = this.factory()
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
        if (status === 'started') {
          if (!startFailure) this.setStatus('running')
        } else if (status === 'stopped') {
          if (this.hook === hook) this.hook = null
          this.setStatus('stopped')
        }
      })
      hook.on('error', (err) => {
        startFailure = err.message
        this.error = err.message
        this.setStatus('error', err.message)
      })

      const started = hook.start({ enableClipboard: true, debug: false })
      if (!started) {
        throw new Error(this.error ?? '取词服务启动失败（selection-hook 返回 false）')
      }
      if (startFailure) {
        dispose()
        this.hook = null
        this.error = startFailure
        this.setStatus('error', startFailure)
        return false
      }

      this.hook = hook
      if (this.status !== 'error') this.setStatus('running')
      return true
    } catch (error) {
      dispose()
      this.hook = null
      if (!this.error) {
        this.error = error instanceof Error ? error.message : String(error)
      }
      this.setStatus('error', this.error)
      return false
    }
  }

  private setStatus(status: HookStatus, error?: string): void {
    this.status = status
    if (error) this.error = error
    this.handlers.onStatus(status, error)
  }

  stop(): void {
    const hook = this.hook
    this.hook = null
    if (hook) {
      try {
        hook.stop()
        hook.cleanup()
      } catch {
        /* native cleanup best effort */
      }
    }
    this.setStatus('stopped')
  }

  restart(): boolean {
    this.stop()
    return this.start()
  }

  isRunning(): boolean {
    return this.status === 'running'
  }
}
