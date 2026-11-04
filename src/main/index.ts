import { BrowserWindow, app, clipboard, ipcMain, screen } from 'electron'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chat, isLocalBaseUrl, listModels } from './ai'
import { listInstalledApps } from './apps'
import { getSelectionContext } from './context'
import { HistoryStore } from './history'
import { buildSystemPrompt, buildUserMessage, markSelection } from './prompt'
import { estimateCostCny } from '../shared/pricing'
import { SelectionService, isUsablePoint, toDipPoint, type Point, type RawSelection } from './selection'
import { SettingsStore } from './settings'
import { startMockServer } from './selftestMock'
import { UsageStore } from './usage'
import { WindowManager } from './windows'
import type {
  AppEntry,
  AppState,
  PanelInit,
  PanelMode,
  PanelModelOption,
  ProviderPatch,
  SettingsPatch,
  TestProviderResult
} from '../shared/types'

const isSelftest = process.argv.includes('--selftest')

if (isSelftest) {
  const dir = join(app.getPath('temp'), 'zhujie-selftest')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  app.setPath('userData', dir)
}

const gotLock = isSelftest || app.requestSingleInstanceLock()
if (!gotLock) app.quit()

app.setAppUserModelId('local.zhujie.app')

let settings: SettingsStore
let usage: UsageStore
let history: HistoryStore
let windows: WindowManager
let selection: SelectionService | null = null

interface ActiveSelection {
  text: string
  programName: string
  truncated: boolean
  anchor: Point
  preferAbove: boolean
}

interface ActiveAnnotation {
  mode: PanelMode
  question?: string
  context?: string
  text: string
  programName: string
  truncated: boolean
  providerId: string
  model: string
  runId: number
  started: boolean
  pending: boolean
  pinned: boolean
  lastQuestion?: string
  controller: AbortController | null
}

const DEMO_APPS: AppEntry[] = [
  {
    processName: 'chrome.exe',
    name: 'Google Chrome',
    running: true,
    installed: true,
    title: '示例文章 - Google Chrome'
  },
  {
    processName: 'msedge.exe',
    name: 'Microsoft Edge',
    running: true,
    installed: true,
    title: '文档 - Microsoft Edge'
  },
  {
    processName: 'WINWORD.EXE',
    name: 'Microsoft Word',
    running: false,
    installed: true
  },
  { processName: 'notepad.exe', name: '记事本', running: false, installed: true },
  { processName: 'WeChat.exe', name: '微信', running: false, installed: true },
  { processName: 'Code.exe', name: 'Visual Studio Code', running: false, installed: true }
]

let activeSelection: ActiveSelection | null = null
let activeAnnotation: ActiveAnnotation | null = null
let pendingPanelInit: PanelInit | null = null
let chipTimer: NodeJS.Timeout | null = null
let selftestResolve: (() => void) | null = null
const contextFailures = new Map<string, number>()
const CONTEXT_RETRY_MS = 10 * 60 * 1000

function normalizeApp(name: string): string {
  return name.trim().toLowerCase().replace(/\.exe$/, '')
}

function appAllowed(programName: string): boolean {
  const s = settings.get()
  if (s.filterMode === 'all') return true
  const target = normalizeApp(programName)
  if (!target) return false
  return s.whitelist.some((entry) => {
    const item = normalizeApp(entry)
    return item.length > 0 && item === target
  })
}

function hideChip(): void {
  if (chipTimer) {
    clearTimeout(chipTimer)
    chipTimer = null
  }
  windows.hideChip()
}

function buildModelOptions(currentProviderId: string, currentModel: string): PanelModelOption[] {
  const options: PanelModelOption[] = []
  for (const provider of settings.getProvidersView()) {
    if (!isLocalBaseUrl(provider.baseUrl) && !provider.hasKey) continue
    for (const model of provider.models) {
      options.push({ providerId: provider.id, providerName: provider.name, model })
    }
  }
  if (!options.some((o) => o.providerId === currentProviderId && o.model === currentModel)) {
    const provider = settings.getProvider(currentProviderId)
    if (provider && currentModel) {
      options.unshift({
        providerId: provider.id,
        providerName: provider.name,
        model: currentModel
      })
    }
  }
  return options
}

function handleSelection(raw: RawSelection): void {
  const s = settings.get()
  if (!s.enabled) return
  if (BrowserWindow.getFocusedWindow()) return

  const rawText = (raw.text || '').trim()
  if (!rawText) {
    hideChip()
    return
  }
  if (rawText.length < 2) return

  const programName = (raw.programName || '未知应用').trim() || '未知应用'
  const before = settings.get().detectedApps.length
  settings.touchApp(programName)
  if (settings.get().detectedApps.length !== before) broadcastState()

  if (!appAllowed(programName)) {
    hideChip()
    return
  }

  const truncated = rawText.length > s.maxChars
  const text = truncated ? rawText.slice(0, s.maxChars) : rawText

  let source: Point | null = null
  if (isUsablePoint(raw.endBottom)) source = raw.endBottom
  else if (isUsablePoint(raw.mousePosEnd)) source = raw.mousePosEnd
  else if (isUsablePoint(raw.startTop)) source = raw.startTop

  let anchor: Point
  if (source) {
    anchor = toDipPoint(source)
  } else {
    const cursor = screen.getCursorScreenPoint()
    anchor = cursor
  }

  const display = screen.getDisplayNearestPoint(anchor)
  const preferAbove = anchor.y > display.workArea.y + display.workArea.height - 220

  activeSelection = { text, programName, truncated, anchor, preferAbove }
  windows.showChip(anchor.x + 10, anchor.y + 8)

  if (chipTimer) clearTimeout(chipTimer)
  chipTimer = setTimeout(() => {
    hideChip()
  }, 15000)
}

function sendPanelError(message: string): void {
  windows.sendPanel('panel:error', { message })
}

function panelResetPayload(
  a: ActiveAnnotation,
  providerName: string,
  followUp = false,
  question?: string
): Record<string, unknown> {
  return {
    mode: a.mode,
    followUp,
    question,
    providerId: a.providerId,
    providerName,
    model: a.model,
    localOnly: settings.get().localOnly
  }
}

async function runAnnotationRequest(
  a: ActiveAnnotation,
  options: {
    system: string
    user: string
    historyMode: PanelMode
    followUp: boolean
    question?: string
  }
): Promise<void> {
  if (activeAnnotation !== a || a.pending) return
  const runId = ++a.runId
  a.controller?.abort()
  const controller = new AbortController()
  a.controller = controller
  a.pending = true

  const s = settings.get()
  const provider = settings.getProvider(a.providerId)
  windows.sendPanel(
    'panel:reset',
    panelResetPayload(a, provider?.name ?? a.providerId, options.followUp, options.question)
  )

  if (!provider) {
    a.pending = false
    sendPanelError('这个模型服务已不存在，请到设置里重新选择。')
    return
  }
  if (!a.model) {
    a.pending = false
    sendPanelError('还没有选择 AI。请打开设置 → 模型服务，选一家 AI、选一个模型，然后填入 API Key。')
    return
  }
  if (s.localOnly && !isLocalBaseUrl(provider.baseUrl)) {
    a.pending = false
    sendPanelError(
      `已开启「仅本机」模式，但 ${provider.name} 指向非本机地址（${provider.baseUrl}），请求已被阻止。`
    )
    return
  }

  const startedAt = Date.now()
  const apiKey = settings.apiKey(provider.id)
  try {
    const result = await chat({
      provider,
      apiKey,
      model: a.model,
      system: options.system,
      user: options.user,
      signal: controller.signal,
      onDelta: (chunk) => {
        if (activeAnnotation === a && runId === a.runId) {
          windows.sendPanel('panel:delta', { chunk })
        }
      }
    })
    if (activeAnnotation !== a || runId !== a.runId) return
    a.pending = false
    const latencyMs = Date.now() - startedAt
    const cost = estimateCostCny({
      model: a.model,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      local: isLocalBaseUrl(provider.baseUrl),
      fallbackIn: provider.priceIn,
      fallbackOut: provider.priceOut
    })
    const ts = Date.now()
    usage.add({
      id: usage.newId(),
      ts,
      programName: a.programName,
      providerId: provider.id,
      providerName: provider.name,
      model: a.model,
      chars: a.text.length,
      contextChars: a.context?.length ?? 0,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      totalTokens: result.totalTokens,
      estimated: result.estimated,
      cost,
      latencyMs,
      ok: true
    })
    history.add({
      id: history.newId(),
      ts,
      mode: options.historyMode,
      programName: a.programName,
      providerName: provider.name,
      model: a.model,
      text: a.text,
      question: options.question,
      answer: result.text,
      contextChars: a.context?.length ?? 0,
      totalTokens: result.totalTokens,
      cost,
      ok: true
    })
    windows.settings?.webContents.send('history:changed')
    windows.sendPanel('panel:done', {
      usage: {
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        totalTokens: result.totalTokens,
        estimated: result.estimated
      },
      cost,
      latencyMs
    })
    if (isSelftest) console.log('[selftest] panel:done', result.totalTokens)
    windows.settings?.webContents.send('usage:changed')
    selftestResolve?.()
    selftestResolve = null
  } catch (error) {
    if (controller.signal.aborted || activeAnnotation !== a || runId !== a.runId) return
    a.pending = false
    const rawMessage = error instanceof Error ? error.message : String(error)
    if (isSelftest) console.log('[selftest] panel:error', rawMessage)
    const hint =
      provider.kind === 'ollama' && /fetch failed|ECONNREFUSED|Failed to fetch/i.test(rawMessage)
        ? `连不上 ${provider.name}。请确认本机模型服务已启动（例如运行 ollama serve）。`
        : /404/.test(rawMessage)
          ? `接口路径可能不对，请检查 Base URL：${provider.baseUrl}`
          : rawMessage
    sendPanelError(hint)
    usage.add({
      id: usage.newId(),
      ts: Date.now(),
      programName: a.programName,
      providerId: provider.id,
      providerName: provider.name,
      model: a.model,
      chars: a.text.length,
      contextChars: a.context?.length ?? 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      estimated: false,
      cost: 0,
      latencyMs: Date.now() - startedAt,
      ok: false,
      error: hint
    })
    windows.settings?.webContents.send('usage:changed')
  }
}

async function startAnnotation(): Promise<void> {
  const a = activeAnnotation
  if (!a || a.mode === 'ask') return
  const s = settings.get()
  await runAnnotationRequest(a, {
    system: buildSystemPrompt({
      mode: 'annotate',
      annotatePrompt: s.prompt,
      hasContext: Boolean(a.context)
    }),
    user: buildUserMessage({
      mode: 'annotate',
      text: a.text,
      context: a.context,
      contextChars: s.contextChars
    }),
    historyMode: 'annotate',
    followUp: false
  })
}

async function askPanelQuestion(question: string): Promise<boolean> {
  const a = activeAnnotation
  if (!a) return false
  const q = question.trim()
  if (!q || a.pending) return false
  const s = settings.get()
  a.lastQuestion = q
  await runAnnotationRequest(a, {
    system: buildSystemPrompt({
      mode: 'ask',
      annotatePrompt: s.prompt,
      hasContext: Boolean(a.context)
    }),
    user: buildUserMessage({
      mode: 'ask',
      text: a.text,
      question: q,
      context: a.context,
      contextChars: s.contextChars
    }),
    historyMode: 'ask',
    followUp: true,
    question: q
  })
  return true
}

function normalizeForMatch(value: string): string {
  return value.replace(/\s+/g, '').trim()
}

async function openAnnotationFromChip(mode: PanelMode): Promise<void> {
  const sel = activeSelection
  if (!sel) return
  const s = settings.get()
  const provider = settings.getProvider(s.defaultProviderId) ?? settings.getProvider('ollama')
  if (!provider) {
    sendPanelError('没有可用的模型服务，请先到设置里添加。')
    return
  }
  const fallbackModel = provider.models[0] || ''
  const model = s.defaultModel || fallbackModel

  let context: string | undefined
  const selectedForContext = normalizeForMatch(sel.text)
  const contextApp = sel.programName || '未知应用'
  const lastContextFailure = contextFailures.get(contextApp)
  const contextEligible = s.useContext && selectedForContext.length >= 4
  const shouldTryContext =
    contextEligible &&
    (!lastContextFailure || Date.now() - lastContextFailure > CONTEXT_RETRY_MS) &&
    !BrowserWindow.getFocusedWindow()
  if (shouldTryContext) {
    const result = await getSelectionContext(s.contextChars)
    if (activeSelection !== sel) return
    if (result.ok && result.text) {
      const got = normalizeForMatch(result.selected ?? '')
      const whole = normalizeForMatch(result.text)
      const matches = got
        ? got.includes(selectedForContext) || selectedForContext.includes(got)
        : selectedForContext.length >= 6 && whole.includes(selectedForContext)
      if (matches) {
        context = result.text
        contextFailures.delete(contextApp)
      } else {
        contextFailures.set(contextApp, Date.now())
      }
    } else {
      contextFailures.set(contextApp, Date.now())
    }
    if (isSelftest) {
      console.log(
        '[selftest] context result',
        JSON.stringify({ ok: result.ok, chars: context?.length ?? 0, error: result.error })
      )
    }
  }

  activeAnnotation = {
    mode,
    context,
    text: sel.text,
    programName: sel.programName,
    truncated: sel.truncated,
    providerId: provider.id,
    model,
    runId: 0,
    started: false,
    pending: false,
    pinned: false,
    controller: null
  }

  const init: PanelInit = {
    mode,
    text: sel.text,
    programName: sel.programName,
    providerId: provider.id,
    providerName: provider.name,
    model,
    options: buildModelOptions(provider.id, model),
    localOnly: s.localOnly,
    contextChars: context?.length ?? 0,
    contextEnabled: contextEligible
  }

  pendingPanelInit = init
  const annotation = activeAnnotation
  const panel = windows.openPanel({ x: sel.anchor.x, y: sel.anchor.y, preferAbove: sel.preferAbove })
  panel.on('closed', () => {
    if (activeAnnotation === annotation) {
      annotation.controller?.abort()
      activeAnnotation = null
    }
  })
  hideChip()
}

function switchPanelModel(providerId: string, model: string): boolean {
  const a = activeAnnotation
  if (!a) return false
  const provider = settings.getProvider(providerId)
  if (!provider || !model) return false
  a.providerId = provider.id
  a.model = model
  settings.update({ defaultProviderId: provider.id, defaultModel: model })
  broadcastState()
  a.controller?.abort()
  a.pending = false
  if (a.mode === 'annotate') {
    void startAnnotation()
    return true
  }
  windows.sendPanel('panel:reset', panelResetPayload(a, provider.name))
  return true
}

function state(): AppState {
  return {
    settings: settings.getView(),
    providers: settings.getProvidersView(),
    hookStatus: selection?.status ?? 'stopped',
    hookError: selection?.error,
    version: app.getVersion(),
    platform: process.platform,
    dataDir: app.getPath('userData')
  }
}

function broadcastState(): void {
  windows.broadcast('state:changed', state())
}

function applySideEffects(patch: SettingsPatch): void {
  if (patch.enabled === false) hideChip()
  if (typeof patch.launchAtLogin === 'boolean') {
    app.setLoginItemSettings({ openAtLogin: patch.launchAtLogin, path: process.execPath })
  }
}

function registerIpc(): void {
  ipcMain.handle('state:get', () => state())

  ipcMain.handle('apps:list', (_event, force?: boolean) => {
    if (isSelftest && process.env.ZHUJIE_DEMO_APPS === '1') return DEMO_APPS
    return listInstalledApps(Boolean(force))
  })

  ipcMain.handle('settings:update', (_event, patch: SettingsPatch) => {
    settings.update(patch ?? {})
    applySideEffects(patch ?? {})
    broadcastState()
    return state()
  })

  ipcMain.handle('provider:save', (_event, patch: ProviderPatch) => {
    if (!patch || !patch.baseUrl?.trim()) throw new Error('Base URL 不能为空')
    if (!/^https?:\/\//i.test(patch.baseUrl.trim())) {
      throw new Error('Base URL 必须以 http:// 或 https:// 开头')
    }
    if (patch.kind !== 'ollama' && patch.kind !== 'openai') {
      throw new Error('不支持的协议类型')
    }
    settings.saveProvider(patch)
    broadcastState()
    return state()
  })

  ipcMain.handle('provider:remove', (_event, id: string) => {
    settings.removeProvider(String(id))
    broadcastState()
    return state()
  })

  ipcMain.handle('provider:test', async (_event, id: string): Promise<TestProviderResult> => {
    const provider = settings.getProvider(String(id))
    if (!provider) return { ok: false, models: [], error: '模型服务不存在' }
    if (settings.get().localOnly && !isLocalBaseUrl(provider.baseUrl)) {
      return { ok: false, models: [], error: '已开启「仅本机」模式，已阻止非本机地址' }
    }
    try {
      const models = await listModels(provider, settings.apiKey(provider.id))
      settings.setModels(provider.id, models)
      if (models.length > 0 && !settings.get().defaultModel) {
        settings.update({ defaultProviderId: provider.id, defaultModel: models[0] })
      }
      broadcastState()
      return { ok: true, models }
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error)
      const message = /fetch failed|ECONNREFUSED|ENOTFOUND|Failed to fetch/i.test(raw)
        ? `连不上 ${provider.name}。请确认它已经启动，然后再试一次。`
        : /401|unauthorized|invalid.*key|api key/i.test(raw)
          ? 'API Key 不正确或没有权限（401）。请重新复制一次 Key。'
          : raw
      return { ok: false, models: [], error: message }
    }
  })

  ipcMain.handle('usage:get', () => usage.summary())
  ipcMain.handle('usage:clear', () => {
    usage.clear()
    return usage.summary()
  })

  ipcMain.handle('history:list', () => history.list())
  ipcMain.handle('history:delete', (_event, id: string) => {
    history.remove(String(id))
    return history.list()
  })
  ipcMain.handle('history:clear', () => {
    history.clear()
    return history.list()
  })

  ipcMain.handle('clipboard:write', (_event, text: string) => {
    clipboard.writeText(String(text ?? ''))
    return true
  })

  ipcMain.handle('chip:click', async (_event, action: string) => {
    await openAnnotationFromChip(action === 'ask' ? 'ask' : 'annotate')
    return true
  })
  ipcMain.handle('chip:hide', () => {
    hideChip()
    return true
  })

  ipcMain.handle('panel:ready', () => {
    if (isSelftest) console.log('[selftest] panel:ready', Boolean(activeAnnotation))
    if (!activeAnnotation || activeAnnotation.started) return false
    activeAnnotation.started = true
    if (pendingPanelInit) {
      windows.sendPanel('panel:init', pendingPanelInit)
      pendingPanelInit = null
    }
    if (activeAnnotation.mode === 'annotate') void startAnnotation()
    return true
  })

  ipcMain.handle('panel:close', () => {
    if (activeAnnotation) {
      activeAnnotation.controller?.abort()
      activeAnnotation.pending = false
    }
    windows.closePanel()
    return true
  })

  ipcMain.handle('panel:regenerate', () => {
    const a = activeAnnotation
    if (!a || a.mode === 'ask') return false
    a.controller?.abort()
    a.pending = false
    void startAnnotation()
    return true
  })

  ipcMain.handle('panel:ask', async (_event, question: string) =>
    askPanelQuestion(String(question ?? ''))
  )

  ipcMain.handle('panel:pin', (_event, pinned: boolean) => {
    if (activeAnnotation) activeAnnotation.pinned = Boolean(pinned)
    if (isSelftest) console.log('[selftest] pinned', Boolean(pinned))
    return true
  })

  ipcMain.handle('panel:switch-model', (_event, payload: { providerId: string; model: string }) =>
    switchPanelModel(String(payload?.providerId ?? ''), String(payload?.model ?? ''))
  )

  ipcMain.handle('window:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
    return true
  })

  ipcMain.handle('window:hide', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.hide()
    return true
  })

  ipcMain.handle('app:quit', () => {
    windows.markQuitting()
    app.quit()
    return true
  })
}

function startServices(): void {
  try {
    app.setAccessibilitySupportEnabled(true)
  } catch {
    /* not supported on this platform */
  }
  settings = new SettingsStore()
  usage = new UsageStore()
  history = new HistoryStore()
  if (app.isPackaged && settings.get().launchAtLogin) {
    app.setLoginItemSettings({ openAtLogin: true, path: process.execPath })
  }
  windows = new WindowManager(
    (enabled) => {
      settings.update({ enabled })
      broadcastState()
    },
    () => settings.get().enabled
  )
  windows.createChip()
  windows.createTray()

  selection = new SelectionService({
    onSelection: handleSelection,
    onMouseDown: (point) => {
      const dip = toDipPoint(point)
      const chipBounds = windows.chipBounds()
      if (chipBounds) {
        const inside =
          dip.x >= chipBounds.x - 2 &&
          dip.x <= chipBounds.x + chipBounds.width + 2 &&
          dip.y >= chipBounds.y - 2 &&
          dip.y <= chipBounds.y + chipBounds.height + 2
        if (!inside) hideChip()
      }

      const panel = windows.panel
      if (
        panel &&
        !panel.isDestroyed() &&
        panel.isVisible() &&
        activeAnnotation &&
        !activeAnnotation.pinned
      ) {
        const bounds = panel.getBounds()
        const inside =
          dip.x >= bounds.x &&
          dip.x <= bounds.x + bounds.width &&
          dip.y >= bounds.y &&
          dip.y <= bounds.y + bounds.height
        if (!inside) {
          setTimeout(() => {
            const current = windows.panel
            if (!current || current.isDestroyed() || !activeAnnotation || activeAnnotation.pinned) return
            if (BrowserWindow.getFocusedWindow() !== current) {
              activeAnnotation.controller?.abort()
              windows.closePanel()
            }
          }, 180)
        }
      }
    },
    onWheel: () => hideChip(),
    onEscape: () => {
      hideChip()
      activeAnnotation?.controller?.abort()
      windows.closePanel()
    },
    onStatus: () => broadcastState()
  })
  selection.start()

  registerIpc()
}

app.on('second-instance', () => {
  windows?.openSettings()
})

app.on('window-all-closed', () => {
  // Tray app: keep running until the user explicitly quits.
})

app.on('before-quit', () => {
  windows?.markQuitting()
  selection?.stop()
  settings?.flush()
})

app.whenReady().then(() => {
  if (!gotLock) return
  startServices()
  if (isSelftest) {
    void runSelfTest()
  } else {
    windows.openSettings()
    setTimeout(() => void refreshLocalModels(), 800)
  }
})

async function refreshLocalModels(): Promise<void> {
  let changed = false
  for (const provider of settings.get().providers) {
    if (provider.models.length > 0) continue
    if (!isLocalBaseUrl(provider.baseUrl)) continue
    try {
      const models = await listModels(provider, settings.apiKey(provider.id), 2500)
      if (models.length > 0) {
        settings.setModels(provider.id, models)
        if (!settings.get().defaultModel) {
          settings.update({ defaultProviderId: provider.id, defaultModel: models[0] })
        }
        changed = true
      }
    } catch {
      /* local service not running yet */
    }
  }
  if (changed) broadcastState()
}

async function runSelfTest(): Promise<void> {
  console.log('[selftest] start')
  const outDir = app.isPackaged
    ? join(app.getPath('userData'), 'selftest')
    : join(app.getAppPath(), 'selftest')
  mkdirSync(outDir, { recursive: true })
  const mock = await startMockServer()
  try {
    usage.clear()
    const installedApps = await listInstalledApps(true)
    const runningApps = installedApps.filter((app) => app.running).length
    console.log(
      'SELFTEST_APPS',
      JSON.stringify({
        count: installedApps.length,
        running: runningApps,
        sample: installedApps.slice(0, 6).map((app) => app.name)
      })
    )
    if (process.platform === 'win32' && installedApps.length === 0) {
      throw new Error('应用扫描结果为空')
    }
    process.env.ZHUJIE_DEMO_APPS = '1'
    const costCheck = estimateCostCny({
      model: 'deepseek-chat',
      promptTokens: 1_000_000,
      completionTokens: 1_000_000,
      local: false
    })
    if (Math.abs(costCheck - 10) > 0.000001) throw new Error('费用估算异常')

    const marker = '这是选中的关键句'
    const marked = markSelection(marker, `前文${marker}后文`)
    const syntheticContext = `前文${'甲'.repeat(80)}${marker}${'乙'.repeat(80)}`
    const promptWithContext = buildUserMessage({
      mode: 'annotate',
      text: marker,
      context: syntheticContext,
      contextChars: 300
    })
    const promptOk =
      marked.includes(`【选中】${marker}【/选中】`) &&
      promptWithContext.includes(`【选中】${marker}【/选中】`) &&
      buildSystemPrompt({ mode: 'annotate', annotatePrompt: 'x', hasContext: true }).includes(
        '文章片段'
      )
    const contextProbeResult = {
      promptOk,
      note: 'UIA 读取依赖目标应用，运行时自动回退'
    }
    console.log('SELFTEST_CONTEXT', JSON.stringify(contextProbeResult))
    if (!promptOk) throw new Error('上下文提示词构建失败')

    settings.saveProvider({
      id: 'custom',
      name: '自测 Mock 服务',
      kind: 'openai',
      baseUrl: `http://127.0.0.1:${mock.port}/v1`
    })
    settings.setModels('custom', ['mock-annotator', 'mock-annotator-2'])
    settings.update({
      enabled: true,
      localOnly: true,
      filterMode: 'all',
      useContext: false,
      defaultProviderId: 'custom',
      defaultModel: 'mock-annotator'
    })
    await new Promise((r) => setTimeout(r, 700))

    settings.update({ filterMode: 'whitelist', whitelist: ['其他应用'] })
    handleSelection({
      text: '这段文字来自一个不在白名单里的应用。',
      programName: '未授权应用',
      endBottom: { x: 600, y: 360 },
      posLevel: 3
    })
    await new Promise((r) => setTimeout(r, 200))
    if (windows.chipBounds()) throw new Error('应用白名单未生效')
    settings.update({ filterMode: 'all', whitelist: [] })

    handleSelection({
      text: '注意力机制让模型在处理每个词时，能够按相关性分配权重。',
      programName: '自测阅读器',
      startTop: { x: 300, y: 300 },
      startBottom: { x: 300, y: 330 },
      endTop: { x: 700, y: 300 },
      endBottom: { x: 700, y: 330 },
      mousePosEnd: { x: 700, y: 330 },
      posLevel: 3
    })
    await new Promise((r) => setTimeout(r, 800))
    await captureWindow(windows.chip, join(outDir, 'chip.png'))
    const firstDone = waitForPanelDone()
    const chip = windows.chip
    if (!chip) throw new Error('注解小框未创建')
    chip.webContents.sendInputEvent({ type: 'mouseDown', x: 44, y: 17, button: 'left', clickCount: 1 })
    chip.webContents.sendInputEvent({ type: 'mouseUp', x: 44, y: 17, button: 'left', clickCount: 1 })
    await firstDone
    await new Promise((r) => setTimeout(r, 400))
    await captureWindow(windows.panel, join(outDir, 'panel.png'))

    const secondDone = waitForPanelDone()
    if (!switchPanelModel('custom', 'mock-annotator-2')) throw new Error('切换模型失败')
    await secondDone
    await new Promise((r) => setTimeout(r, 400))
    await captureWindow(windows.panel, join(outDir, 'panel-switch.png'))

    windows.closePanel()
    await new Promise((r) => setTimeout(r, 300))
    handleSelection({
      text: '注意力机制让模型在处理每个词时，能够按相关性分配权重。',
      programName: '自测阅读器',
      startTop: { x: 300, y: 300 },
      startBottom: { x: 300, y: 330 },
      endTop: { x: 700, y: 300 },
      endBottom: { x: 700, y: 330 },
      mousePosEnd: { x: 700, y: 330 },
      posLevel: 3
    })
    await new Promise((r) => setTimeout(r, 500))
    const askChip = windows.chip
    if (!askChip) throw new Error('提问小框未创建')
    const askDone = waitForPanelDone()
    askChip.webContents.sendInputEvent({ type: 'mouseDown', x: 44, y: 55, button: 'left', clickCount: 1 })
    askChip.webContents.sendInputEvent({ type: 'mouseUp', x: 44, y: 55, button: 'left', clickCount: 1 })
    await new Promise((r) => setTimeout(r, 700))
    await captureWindow(windows.panel, join(outDir, 'panel-ask.png'))
    void askPanelQuestion('这段文字里的注意力权重是什么意思？')
    await askDone
    await new Promise((r) => setTimeout(r, 400))
    await captureWindow(windows.panel, join(outDir, 'panel-ask-answer.png'))
    const panelContents = windows.panel?.webContents
    if (panelContents) {
      await panelContents.executeJavaScript("document.querySelector('.icon-btn.pin')?.click()")
      await new Promise((r) => setTimeout(r, 250))
      await captureWindow(windows.panel, join(outDir, 'panel-pinned.png'))
      await panelContents.executeJavaScript("document.querySelector('.icon-btn.pin')?.click()")
      await new Promise((r) => setTimeout(r, 150))
    }
    windows.closePanel()
    await new Promise((r) => setTimeout(r, 200))

    if (!isLocalBaseUrl('http://127.0.0.1:11434') || isLocalBaseUrl('https://api.openai.com/v1')) {
      throw new Error('仅本机地址判断异常')
    }
    const summaryAfter = usage.summary()
    if (
      summaryAfter.total.requests !== 3 ||
      summaryAfter.total.tokens !== 1200 ||
      summaryAfter.byModel.length !== 2
    ) {
      throw new Error('用量记录不符合预期')
    }
    const historyCount = history.list().length
    if (historyCount !== 3) throw new Error('历史记录数量不符合预期')
    console.log('SELFTEST_HISTORY', JSON.stringify({ count: historyCount, costCheck }))

    usage.add({
      id: usage.newId(),
      ts: Date.now(),
      programName: '自测阅读器',
      providerId: 'deepseek',
      providerName: 'DeepSeek（计费样例）',
      model: 'deepseek-chat',
      chars: 20,
      promptTokens: 800,
      completionTokens: 500,
      totalTokens: 1300,
      estimated: false,
      cost: 0.0042,
      latencyMs: 1800,
      ok: true
    })
    console.log('SELFTEST_COST_SAMPLE', 0.0042)

    settings.update({ useContext: true, contextChars: 300 })
    settings.clearDetectedApps()
    windows.openSettings()
    await new Promise((r) => setTimeout(r, 2200))
    await captureWindow(windows.settings, join(outDir, 'settings.png'))

    const settingsContents = windows.settings?.webContents
    if (settingsContents) {
      await settingsContents.executeJavaScript(`(() => {
        const input = document.querySelector('.app-search input');
        if (!input) return false;
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, 'Edge');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()`)
      await new Promise((r) => setTimeout(r, 400))
      await captureWindow(windows.settings, join(outDir, 'settings-search.png'))
    }

    await clickNav(1)
    await captureWindow(windows.settings, join(outDir, 'models.png'))
    if (settingsContents) {
      await settingsContents.executeJavaScript("document.querySelectorAll('.mode')[1]?.click()")
      await new Promise((r) => setTimeout(r, 2500))
      await captureWindow(windows.settings, join(outDir, 'models-cloud.png'))
    }
    await clickNav(2)
    await captureWindow(windows.settings, join(outDir, 'prompt.png'))
    await clickNav(3)
    await captureWindow(windows.settings, join(outDir, 'history.png'))
    await clickNav(4)
    await captureWindow(windows.settings, join(outDir, 'usage.png'))
    await clickNav(5)
    await captureWindow(windows.settings, join(outDir, 'about.png'))

    const ollamaProvider = {
      id: 'mock-ollama',
      name: 'Mock Ollama',
      kind: 'ollama' as const,
      baseUrl: `http://127.0.0.1:${mock.port}`,
      models: ['mock-ollama'],
      builtin: false,
      priceIn: 0,
      priceOut: 0
    }
    let ollamaStream = ''
    const ollamaResult = await chat({
      provider: ollamaProvider,
      apiKey: '',
      model: 'mock-ollama',
      system: 'test',
      user: 'test',
      signal: new AbortController().signal,
      onDelta: (chunk) => {
        ollamaStream += chunk
      }
    })
    const ollamaModels = await listModels(ollamaProvider, '')
    console.log(
      'SELFTEST_OLLAMA',
      JSON.stringify({
        tokens: ollamaResult.totalTokens,
        estimated: ollamaResult.estimated,
        streamed: ollamaStream.length,
        models: ollamaModels
      })
    )

    const summary = usage.summary()
    writeFileSync(
      join(outDir, 'result.json'),
      JSON.stringify(
        {
          state: state(),
          usage: summary,
          ollama: {
            tokens: ollamaResult.totalTokens,
            estimated: ollamaResult.estimated,
            models: ollamaModels
          },
          apps: {
            count: installedApps.length,
            running: runningApps,
            sample: installedApps.slice(0, 10).map((app) => app.name)
          },
          history: {
            count: history.list().length,
            costCheck
          },
          context: contextProbeResult
        },
        null,
        2
      ),
      'utf8'
    )
    console.log(
      'SELFTEST_OK',
      JSON.stringify({
        requests: summary.total.requests,
        tokens: summary.total.tokens,
        models: summary.byModel.map((m) => m.key),
        hook: selection?.status ?? 'stopped',
        screenshot: join(outDir, 'panel.png')
      })
    )
    mock.close()
    windows.markQuitting()
    app.exit(0)
  } catch (error) {
    console.error('SELFTEST_FAIL', error)
    mock.close()
    windows.markQuitting()
    app.exit(1)
  }
}

function waitForPanelDone(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    selftestResolve = resolve
    setTimeout(() => reject(new Error('等待面板结果超时')), 15000)
  })
}

async function clickNav(index: number): Promise<void> {
  const contents = windows.settings?.webContents
  if (!contents) return
  await contents.executeJavaScript(`document.querySelectorAll('.nav-item')[${index}]?.click()`)
  await new Promise((r) => setTimeout(r, 400))
}

async function captureWindow(win: BrowserWindow | null, file: string): Promise<void> {
  if (!win || win.isDestroyed()) return
  const image = await win.webContents.capturePage()
  writeFileSync(file, image.toPNG())
}
