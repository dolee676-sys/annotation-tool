import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AppEntry,
  AppState,
  FavoriteRecord,
  HistoryRecord,
  HistorySummary,
  ProviderKind,
  ProviderPatch,
  ProviderView,
  SettingsPatch,
  UpdateProgress,
  UsageSummary
} from '../../shared/types'
import { DEFAULT_PROMPT, HISTORY_KEEP_RECENT, HISTORY_LIMIT } from '../../shared/types'
import { PROVIDER_PRESETS, isLocalAddress, presetById } from '../../shared/presets'
import { formatCny, formatUsageMultiplier, usageMultiplier } from '../../shared/pricing'

marked.setOptions({ gfm: true, breaks: true })

type Tab = 'apps' | 'models' | 'prompt' | 'history' | 'favorites' | 'usage' | 'about'

interface TestState {
  loading?: boolean
  ok?: boolean
  error?: string
  models?: number
}

interface CompressState {
  busy: boolean
  done: number
  total: number
  message: string
  error?: string
}

interface EditorState {
  id?: string
  name: string
  kind: ProviderKind
  baseUrl: string
  apiKey: string
  priceIn: number
  priceOut: number
}

interface AppRow {
  key: string
  processName: string
  label: string
  running: boolean
  installed: boolean
  count: number
  lastSeen: number
  title?: string
}

interface HistoryThread {
  key: string
  items: HistoryRecord[]
  latest: HistoryRecord
}

const NAV: Array<{ id: Tab; label: string; icon: string }> = [
  { id: 'apps', label: '应用范围', icon: 'apps' },
  { id: 'models', label: '模型服务', icon: 'chip' },
  { id: 'prompt', label: '注解提示词', icon: 'text' },
  { id: 'history', label: '历史记录', icon: 'clock' },
  { id: 'favorites', label: '收藏', icon: 'star' },
  { id: 'usage', label: '用量统计', icon: 'bars' },
  { id: 'about', label: '关于', icon: 'info' }
]

function Icon({ name }: { name: string }): JSX.Element {
  const paths: Record<string, JSX.Element> = {
    apps: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1.6" />
        <rect x="14" y="3" width="7" height="7" rx="1.6" />
        <rect x="3" y="14" width="7" height="7" rx="1.6" />
        <rect x="14" y="14" width="7" height="7" rx="1.6" />
      </>
    ),
    chip: (
      <>
        <rect x="5" y="5" width="14" height="14" rx="3" />
        <path d="M9 9h6M9 12h6M9 15h3" />
      </>
    ),
    text: (
      <>
        <path d="M4 6h16M4 11h12M4 16h15M4 21h8" />
      </>
    ),
    bars: (
      <>
        <path d="M4 20V10M10 20V4M16 20v-7M22 20v-4" />
      </>
    ),
    info: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 10v6M12 7.2v.2" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3.5 2" />
      </>
    ),
    star: (
      <path d="M12 3.2l2.7 5.5 6 .9-4.3 4.2 1 6-5.4-2.8-5.4 2.8 1-6-4.3-4.2 6-.9L12 3.2z" />
    )
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
      {paths[name] ?? paths.info}
    </svg>
  )
}

const fmtNum = (n: number): string => n.toLocaleString('zh-CN')

const fmtTime = (ts: number): string =>
  new Date(ts).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })

const readableError = (error: unknown): string => {
  const raw = error instanceof Error ? error.message : String(error)
  return raw.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

function MultiplierBadge({ value }: { value: number | null }): JSX.Element | null {
  if (value === null) {
    return (
      <span className="multiplier unknown" title="未收录该模型价格，暂不比较">
        —
      </span>
    )
  }
  const tone = value === 0 ? 'free' : value < 0.5 ? 'low' : value <= 2 ? 'mid' : 'high'
  return (
    <span
      className={`multiplier ${tone}`}
      title="相对 deepseek-flash 的 token 价格；按每百万 tokens 输入+输出估算，实际以用量页为准"
    >
      {formatUsageMultiplier(value)}
    </span>
  )
}

const multiplierSuffix = (value: number | null): string => {
  if (value === null) return ''
  if (value === 0) return '（免费）'
  return `（${formatUsageMultiplier(value)}）`
}

const normalizeAppName = (value: string): string =>
  value.trim().toLowerCase().replace(/\.exe$/i, '')

function historyThreadKey(record: HistoryRecord): string {
  return record.conversationId ?? `${record.programName}\u0000${record.text}`
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.floor(hours / 24)} 天前`
}

export function App(): JSX.Element {
  const [state, setState] = useState<AppState | null>(null)
  const [usage, setUsage] = useState<UsageSummary | null>(null)
  const [tab, setTab] = useState<Tab>('apps')
  const [tabInitialized, setTabInitialized] = useState(false)
  const [toast, setToast] = useState('')
  const [appInput, setAppInput] = useState('')
  const [promptDraft, setPromptDraft] = useState('')
  const [promptDirty, setPromptDirty] = useState(false)
  const [tests, setTests] = useState<Record<string, TestState>>({})
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [savingProvider, setSavingProvider] = useState(false)
  const [selectedPresetId, setSelectedPresetId] = useState('')
  const [presetInitialized, setPresetInitialized] = useState(false)
  const [keyDraft, setKeyDraft] = useState('')
  const [modelDraft, setModelDraft] = useState('')
  const [presetBusy, setPresetBusy] = useState(false)
  const [presetNotice, setPresetNotice] = useState<{ ok: boolean; message: string } | null>(null)
  const [apps, setApps] = useState<AppEntry[] | null>(null)
  const [appsLoading, setAppsLoading] = useState(false)
  const [appsError, setAppsError] = useState('')
  const [appQuery, setAppQuery] = useState('')
  const [historyItems, setHistoryItems] = useState<HistoryRecord[] | null>(null)
  const [historyQuery, setHistoryQuery] = useState('')
  const [selectedHistoryId, setSelectedHistoryId] = useState('')
  const [summaries, setSummaries] = useState<HistorySummary[]>([])
  const [compressState, setCompressState] = useState<CompressState | null>(null)
  const [favorites, setFavorites] = useState<FavoriteRecord[] | null>(null)
  const [updateProgress, setUpdateProgress] = useState<UpdateProgress | null>(null)
  const [hookBusy, setHookBusy] = useState(false)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tabRef = useRef(tab)
  const historyDirty = useRef(false)
  const favoritesDirty = useRef(false)
  const usageDirty = useRef(false)

  useEffect(() => {
    tabRef.current = tab
  }, [tab])

  const flash = useCallback((message: string) => {
    setToast(message)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => {
      setToast('')
      toastTimer.current = null
    }, 2200)
  }, [])

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current)
    },
    []
  )

  const refreshUsage = useCallback(async () => {
    setUsage(await window.zhujie.getUsage())
  }, [])

  const loadApps = useCallback(async (force = false) => {
    setAppsLoading(true)
    setAppsError('')
    try {
      setApps(await window.zhujie.listApps(force))
    } catch (error) {
      setAppsError(error instanceof Error ? error.message : '扫描应用失败')
    } finally {
      setAppsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (tab === 'apps' && apps === null) void loadApps()
  }, [tab, apps, loadApps])

  const loadHistory = useCallback(async () => {
    const [items, nextSummaries] = await Promise.all([
      window.zhujie.listHistory(),
      window.zhujie.listHistorySummaries()
    ])
    setHistoryItems(items)
    setSummaries(nextSummaries)
    setSelectedHistoryId((prev) => (items.some((item) => item.id === prev) ? prev : items[0]?.id ?? ''))
  }, [])

  useEffect(() => {
    if (tab === 'history' && historyItems === null) void loadHistory()
  }, [tab, historyItems, loadHistory])

  useEffect(
    () =>
      window.zhujie.on('history:changed', () => {
        if (tabRef.current === 'history' && !document.hidden) void loadHistory()
        else historyDirty.current = true
      }),
    [loadHistory]
  )

  const loadFavorites = useCallback(async () => {
    setFavorites(await window.zhujie.listFavorites())
  }, [])

  useEffect(() => {
    if (tab === 'favorites' && favorites === null) void loadFavorites()
  }, [tab, favorites, loadFavorites])

  useEffect(() => {
    if (tab === 'history' && favorites === null) void loadFavorites()
  }, [tab, favorites, loadFavorites])

  useEffect(
    () =>
      window.zhujie.on('favorites:changed', () => {
        if (
          (tabRef.current === 'favorites' || tabRef.current === 'history') &&
          !document.hidden
        ) {
          void loadFavorites()
        } else {
          favoritesDirty.current = true
        }
      }),
    [loadFavorites]
  )

  useEffect(() => {
    if (tab === 'history' && historyDirty.current) {
      historyDirty.current = false
      void loadHistory()
    }
    if (tab === 'favorites' && favoritesDirty.current) {
      favoritesDirty.current = false
      void loadFavorites()
    }
    if (tab === 'history' && favoritesDirty.current) {
      favoritesDirty.current = false
      void loadFavorites()
    }
    if (tab === 'usage' && usageDirty.current) {
      usageDirty.current = false
      void refreshUsage()
    }
  }, [tab, loadHistory, loadFavorites, refreshUsage])

  useEffect(
    () => window.zhujie.on('update:progress', (payload) => setUpdateProgress(payload)),
    []
  )

  useEffect(
    () =>
      window.zhujie.on('history:compress-progress', (progress) => {
        setCompressState({
          busy: true,
          done: progress.done,
          total: progress.total,
          message: progress.message
        })
      }),
    []
  )

  useEffect(() => {
    let alive = true
    void (async () => {
      const [next, nextUsage] = await Promise.all([window.zhujie.getState(), window.zhujie.getUsage()])
      if (!alive) return
      setState(next)
      setUsage(nextUsage)
      setPromptDraft(next.settings.prompt)
    })()
    const offState = window.zhujie.on('state:changed', (next: AppState) => setState(next))
    const offUsage = window.zhujie.on('usage:changed', () => {
      if (tabRef.current === 'usage' && !document.hidden) void refreshUsage()
      else usageDirty.current = true
    })
    return () => {
      alive = false
      offState()
      offUsage()
    }
  }, [refreshUsage])

  useEffect(() => {
    if (state && !promptDirty) setPromptDraft(state.settings.prompt)
  }, [state, promptDirty])

  useEffect(() => {
    if (!state || tabInitialized) return
    if (!state.settings.defaultModel) setTab('models')
    setTabInitialized(true)
  }, [state, tabInitialized])

  const patch = async (next: SettingsPatch, note?: string): Promise<void> => {
    try {
      const updated = await window.zhujie.updateSettings(next)
      setState(updated)
      if (note) flash(note)
    } catch (error) {
      flash(readableError(error))
    }
  }

  const addApp = (): void => {
    if (!state) return
    const name = appInput.trim()
    if (!name) return
    if (state.settings.whitelist.includes(name)) {
      flash('已在列表中')
      return
    }
    void patch({ whitelist: [...state.settings.whitelist, name] }, `已加入：${name}`)
    setAppInput('')
  }

  const savePrompt = async (): Promise<void> => {
    if (!promptDraft.trim()) {
      flash('提示词不能为空')
      return
    }
    await patch({ prompt: promptDraft }, '提示词已保存')
    setPromptDirty(false)
  }

  const saveProvider = async (): Promise<void> => {
    if (!editor) return
    if (!editor.baseUrl.trim()) {
      flash('请填写 Base URL')
      return
    }
    setSavingProvider(true)
    try {
      const payload: ProviderPatch = {
        id: editor.id,
        name: editor.name || '自定义服务',
        kind: editor.kind,
        baseUrl: editor.baseUrl,
        apiKey: editor.apiKey.trim() ? editor.apiKey.trim() : undefined,
        priceIn: editor.priceIn,
        priceOut: editor.priceOut
      }
      const updated = await window.zhujie.saveProvider(payload)
      setState(updated)
      setEditor(null)
      flash('模型服务已保存')
    } catch (error) {
      flash(readableError(error))
    } finally {
      setSavingProvider(false)
    }
  }

  const testProvider = async (id: string): Promise<void> => {
    setTests((prev) => ({ ...prev, [id]: { loading: true } }))
    try {
      const result = await window.zhujie.testProvider(id)
      setTests((prev) => ({
        ...prev,
        [id]: { ok: result.ok, error: result.error, models: result.models.length }
      }))
      if (result.ok) {
        setState(await window.zhujie.getState())
        flash(`连接成功，发现 ${result.models.length} 个模型`)
      }
    } catch (error) {
      const message = readableError(error)
      setTests((prev) => ({ ...prev, [id]: { ok: false, error: message } }))
      flash(message)
    }
  }

  const clearUsage = async (): Promise<void> => {
    if (!window.confirm('确定清空本机用量记录？此操作不可恢复。')) return
    try {
      setUsage(await window.zhujie.clearUsage())
      flash('用量记录已清空')
    } catch (error) {
      flash(readableError(error))
    }
  }

  const removeHistory = async (id: string): Promise<void> => {
    try {
      const items = await window.zhujie.deleteHistory(id)
      setHistoryItems(items)
      setSelectedHistoryId(items[0]?.id ?? '')
      flash('历史记录已删除')
    } catch (error) {
      flash(readableError(error))
    }
  }

  const clearHistory = async (): Promise<void> => {
    if (!window.confirm('清空全部历史记录和综合摘要？此操作不可恢复。')) return
    try {
      await window.zhujie.clearHistory()
      await loadHistory()
      setSelectedHistoryId('')
      flash('历史记录已清空')
    } catch (error) {
      flash(readableError(error))
    }
  }

  const removeFavorite = async (id: string): Promise<void> => {
    try {
      setFavorites(await window.zhujie.deleteFavorite(id))
      flash('收藏已删除')
    } catch (error) {
      flash(readableError(error))
    }
  }

  const clearFavorites = async (): Promise<void> => {
    if (!window.confirm('清空全部收藏？此操作不可恢复。')) return
    try {
      setFavorites(await window.zhujie.clearFavorites())
      flash('收藏已清空')
    } catch (error) {
      flash(readableError(error))
    }
  }

  const copyHistoryThread = async (thread: HistoryThread): Promise<void> => {
    const parts = thread.items.map((record) =>
      record.question ? `问：${record.question}\n答：${record.answer}` : record.answer
    )
    await window.zhujie.writeClipboard(parts.join('\n\n---\n\n'))
    flash('已复制完整对话')
  }

  const toggleHistoryFavorite = async (record: HistoryRecord): Promise<void> => {
    try {
      const result = await window.zhujie.toggleHistoryFavorite(record.id)
      if (!result.ok) {
        flash(result.error ?? '收藏失败')
        return
      }
      await loadFavorites()
      flash(result.favorited ? '已收藏这条问答' : '已取消收藏')
    } catch (error) {
      flash(readableError(error))
    }
  }

  const restartHook = async (): Promise<void> => {
    setHookBusy(true)
    try {
      setState(await window.zhujie.restartHook())
      flash('取词服务已重启')
    } catch (error) {
      flash(readableError(error))
    } finally {
      setHookBusy(false)
    }
  }

  const downloadUpdate = async (): Promise<void> => {
    try {
      const status = await window.zhujie.downloadUpdate()
      if (status.phase === 'error') flash(status.message ?? '下载更新失败')
    } catch (error) {
      flash(readableError(error))
    }
  }

  const compressHistory = async (): Promise<void> => {
    const count = historyItems?.length ?? 0
    if (count < HISTORY_LIMIT) return
    const compressible = count - HISTORY_KEEP_RECENT
    const confirmed = window.confirm(
      `历史记录已有 ${count} 条。\n\n将把最早的 ${compressible} 条压缩成一份综合摘要，保留最近 ${HISTORY_KEEP_RECENT} 条原文。\n\n旧记录会被删除且不可恢复，建议先备份 history.jsonl。压缩会调用 AI，可能产生费用并需要一点时间。继续吗？`
    )
    if (!confirmed) return
    setCompressState({
      busy: true,
      done: 0,
      total: compressible,
      message: '正在准备历史记录…'
    })
    try {
      const result = await window.zhujie.compressHistory()
      if (!result.ok) {
        setCompressState({
          busy: false,
          done: 0,
          total: compressible,
          message: '',
          error: result.error ?? '压缩失败'
        })
        return
      }
      setCompressState(null)
      await loadHistory()
      await refreshUsage()
      flash(`已压缩 ${result.compressed} 条，保留最近 ${result.kept} 条`)
    } catch (error) {
      setCompressState({
        busy: false,
        done: 0,
        total: compressible,
        message: '',
        error: readableError(error)
      })
    }
  }

  const modelOptions = useMemo(() => {
    const list: Array<{ providerId: string; providerName: string; model: string }> = []
    for (const provider of state?.providers ?? []) {
      if (!isLocalAddress(provider.baseUrl) && !provider.hasKey) continue
      for (const model of provider.models) {
        list.push({ providerId: provider.id, providerName: provider.name, model })
      }
    }
    return list
  }, [state])

  const selectPreset = useCallback((presetId: string, source: AppState) => {
    const preset = presetById(presetId)
    const provider = source.providers.find((item) => (item.presetId ?? item.id) === presetId)
    setSelectedPresetId(presetId)
    setKeyDraft('')
    setPresetNotice(null)
    const preferred =
      provider && provider.id === source.settings.defaultProviderId && source.settings.defaultModel
        ? source.settings.defaultModel
        : provider?.models[0] ?? preset?.models[0] ?? ''
    setModelDraft(preferred)
  }, [])

  useEffect(() => {
    if (!state || presetInitialized) return
    const current = state.providers.find((provider) => provider.id === state.settings.defaultProviderId)
    const currentPresetId = current?.presetId ?? current?.id ?? ''
    const fallback = PROVIDER_PRESETS.find((preset) => preset.local === state.settings.localOnly)
    const pick = PROVIDER_PRESETS.some((preset) => preset.id === currentPresetId)
      ? currentPresetId
      : fallback?.id
    if (pick) selectPreset(pick, state)
    setPresetInitialized(true)
  }, [state, presetInitialized, selectPreset])

  const appRows = useMemo(() => {
    const map = new Map<string, AppRow>()
    for (const entry of apps ?? []) {
      const key = normalizeAppName(entry.processName)
      map.set(key, {
        key,
        processName: entry.processName,
        label: entry.name,
        running: entry.running,
        installed: entry.installed,
        count: 0,
        lastSeen: 0,
        title: entry.title
      })
    }
    for (const detected of state?.settings.detectedApps ?? []) {
      const key = normalizeAppName(detected.name)
      const existing = map.get(key)
      if (existing) {
        existing.count = detected.count
        existing.lastSeen = detected.lastSeen
      } else {
        map.set(key, {
          key,
          processName: detected.name.endsWith('.exe') ? detected.name : `${detected.name}.exe`,
          label: detected.name.replace(/\.exe$/i, ''),
          running: false,
          installed: false,
          count: detected.count,
          lastSeen: detected.lastSeen
        })
      }
    }
    for (const name of state?.settings.whitelist ?? []) {
      const key = normalizeAppName(name)
      if (!map.has(key)) {
        map.set(key, {
          key,
          processName: name,
          label: name.replace(/\.exe$/i, ''),
          running: false,
          installed: false,
          count: 0,
          lastSeen: 0
        })
      }
    }
    return Array.from(map.values()).sort((a, b) => {
      if (a.running !== b.running) return a.running ? -1 : 1
      if (a.count !== b.count) return b.count - a.count
      return a.label.localeCompare(b.label, 'zh-CN')
    })
  }, [apps, state?.settings.detectedApps, state?.settings.whitelist])

  const visibleAppRows = useMemo(() => {
    const query = appQuery.trim().toLowerCase()
    if (!query) return appRows
    return appRows.filter(
      (row) =>
        row.label.toLowerCase().includes(query) ||
        row.processName.toLowerCase().includes(query) ||
        (row.title ?? '').toLowerCase().includes(query)
    )
  }, [appRows, appQuery])

  const historyThreads = useMemo<HistoryThread[]>(() => {
    const map = new Map<string, HistoryRecord[]>()
    for (const record of historyItems ?? []) {
      const key = historyThreadKey(record)
      const list = map.get(key)
      if (list) list.push(record)
      else map.set(key, [record])
    }
    return Array.from(map.entries())
      .map(([key, items]) => {
        const sorted = [...items].sort((a, b) => a.ts - b.ts)
        return { key, items: sorted, latest: sorted[sorted.length - 1] }
      })
      .sort((a, b) => b.latest.ts - a.latest.ts)
  }, [historyItems])

  const filteredThreads = useMemo(() => {
    const query = historyQuery.trim().toLowerCase()
    if (!query) return historyThreads
    return historyThreads.filter((thread) =>
      thread.items.some(
        (record) =>
          record.text.toLowerCase().includes(query) ||
          (record.question ?? '').toLowerCase().includes(query) ||
          record.answer.toLowerCase().includes(query) ||
          record.programName.toLowerCase().includes(query) ||
          record.model.toLowerCase().includes(query)
      )
    )
  }, [historyThreads, historyQuery])

  const selectedThread = useMemo(
    () =>
      filteredThreads.find((thread) => thread.items.some((record) => record.id === selectedHistoryId)) ??
      filteredThreads[0] ??
      null,
    [filteredThreads, selectedHistoryId]
  )

  if (!state) {
    return <div className="boot">正在读取本机配置…</div>
  }

  const settings = state.settings
  const runningCount = apps?.filter((app) => app.running).length ?? 0
  const isRowWhitelisted = (key: string): boolean =>
    settings.whitelist.some((item) => normalizeAppName(item) === key)
  const toggleAppRow = (row: AppRow): void => {
    const exists = isRowWhitelisted(row.key)
    const next = exists
      ? settings.whitelist.filter((item) => normalizeAppName(item) !== row.key)
      : [...settings.whitelist, row.processName]
    void patch({ whitelist: next }, exists ? `已移出：${row.label}` : `已加入：${row.label}`)
  }
  const visiblePresets = PROVIDER_PRESETS.filter((preset) => preset.local === settings.localOnly)
  const activePreset = presetById(selectedPresetId)
  const activeProvider =
    state.providers.find((provider) => (provider.presetId ?? provider.id) === selectedPresetId) ?? null
  const activeChoices = Array.from(
    new Set([...(activeProvider?.models ?? []), ...(activePreset?.models ?? [])])
  )
  const activeProviderInfo = state.providers.find(
    (provider) => provider.id === settings.defaultProviderId
  )
  const activePresetInfo = activeProviderInfo
    ? presetById(activeProviderInfo.presetId ?? '')
    : undefined
  const activeLabel = activePresetInfo?.name ?? activeProviderInfo?.name ?? '还没有配置 AI'
  const activeIsLocal = activeProviderInfo
    ? isLocalAddress(activeProviderInfo.baseUrl)
    : settings.localOnly
  const modeMismatch = Boolean(activeProviderInfo) && activeIsLocal !== settings.localOnly
  const activeMultiplier = activeProviderInfo
    ? usageMultiplier({
        model: settings.defaultModel,
        local: activeIsLocal,
        fallbackIn: activeProviderInfo.priceIn,
        fallbackOut: activeProviderInfo.priceOut,
        useFallback: !activeProviderInfo.builtin
      })
    : null

  async function changeMode(local: boolean): Promise<void> {
    if (local === settings.localOnly) return
    let updated: AppState
    try {
      updated = await window.zhujie.updateSettings({ localOnly: local })
    } catch (error) {
      flash(readableError(error))
      return
    }
    setState(updated)
    const current = updated.providers.find(
      (provider) => provider.id === updated.settings.defaultProviderId
    )
    const currentPreset = presetById(current?.presetId ?? '')
    const pick =
      currentPreset && currentPreset.local === local
        ? currentPreset
        : PROVIDER_PRESETS.find((preset) => preset.local === local)
    if (pick) selectPreset(pick.id, updated)
    flash(local ? '已切换：只用本机模型，不联网' : '已切换：允许云端 AI，选中的文字会发出去')
  }

  async function detectLocalModels(): Promise<void> {
    if (!activeProvider) return
    setPresetBusy(true)
    setPresetNotice(null)
    try {
      const result = await window.zhujie.testProvider(activeProvider.id)
      setState(await window.zhujie.getState())
      if (result.ok && result.models.length > 0) {
        setModelDraft(result.models[0])
        await savePresetSettings(result.models[0])
      } else {
        setPresetNotice({
          ok: false,
          message:
            result.error ?? '没有检测到模型。请先启动 Ollama / LM Studio，并下载一个模型。'
        })
      }
    } finally {
      setPresetBusy(false)
    }
  }

  async function savePresetSettings(modelOverride?: string): Promise<void> {
    if (!activePreset || !activeProvider) return
    const model = (modelOverride ?? modelDraft).trim()
    if (!activePreset.local && !keyDraft.trim() && !activeProvider.hasKey) {
      setPresetNotice({ ok: false, message: '请先填入 API Key。' })
      return
    }
    if (!model) {
      if (activePreset.local) {
        await detectLocalModels()
        return
      }
      setPresetNotice({ ok: false, message: '请选择一个模型。' })
      return
    }
    setPresetBusy(true)
    setPresetNotice(null)
    try {
      await window.zhujie.saveProvider({
        id: activeProvider.id,
        name: activePreset.name,
        kind: activePreset.kind,
        baseUrl: activePreset.baseUrl,
        apiKey: keyDraft.trim() ? keyDraft.trim() : undefined,
        model
      })
      let updated = await window.zhujie.updateSettings({
        defaultProviderId: activeProvider.id,
        defaultModel: model,
        localOnly: activePreset.local
      })
      setState(updated)
      setKeyDraft('')
      const result = await window.zhujie.testProvider(activeProvider.id)
      updated = await window.zhujie.getState()
      setState(updated)
      if (result.ok) {
        setPresetNotice({
          ok: true,
          message: `已启用 ${activePreset.name} · ${model}。连接正常，发现 ${result.models.length} 个模型。`
        })
      } else {
        setPresetNotice({
          ok: false,
          message: `已保存，但连接测试失败：${result.error ?? '未知错误'}`
        })
      }
    } catch (error) {
      setPresetNotice({
        ok: false,
        message: readableError(error)
      })
    } finally {
      setPresetBusy(false)
    }
  }

  return (
    <div className="shell">
      <div className="titlebar">
        <div className="brand">
          <span className="brand-mark">注</span>
          <div>
            <strong>注解</strong>
            <span>划词 AI 助手</span>
          </div>
        </div>
        <div className="titlebar-spacer" />
        <span className={`hook-pill ${state.hookStatus}`}>
          <span className="dot" />
          {state.hookStatus === 'running' ? '取词服务运行中' : state.hookStatus === 'error' ? '取词服务异常' : '取词服务未运行'}
        </span>
        <div className="win-actions">
          <button title="最小化" onClick={() => void window.zhujie.minimizeWindow()}>
            ─
          </button>
          <button title="隐藏到托盘" onClick={() => void window.zhujie.hideWindow()}>
            ×
          </button>
        </div>
      </div>

      <div className="body">
        <aside className="sidebar">
          <nav>
            {NAV.map((item) => (
              <button
                key={item.id}
                className={tab === item.id ? 'nav-item active' : 'nav-item'}
                onClick={() => setTab(item.id)}
              >
                <Icon name={item.icon} />
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
          <div className="side-card">
            <div className="side-card-title">
              <span className={`live-dot ${settings.enabled ? 'on' : ''}`} />
              {settings.enabled ? '划词注解已开启' : '划词注解已暂停'}
            </div>
            <p>选中任意文字，旁边会出现「注解」。</p>
            <label className="switch-row">
              <span>总开关</span>
              <input
                type="checkbox"
                className="switch"
                checked={settings.enabled}
                onChange={(event) => void patch({ enabled: event.target.checked })}
              />
            </label>
          </div>
        </aside>

        <main className="content">
          {tab === 'apps' && (
            <section className="section">
              <header className="section-head">
                <div>
                  <h1>应用范围</h1>
                  <p>决定哪些应用里选中文字时会出现「注解」小框。</p>
                </div>
              </header>

              {modelOptions.length === 0 && (
                <div className="notice-card">
                  <div>
                    <strong>还没有可用模型</strong>
                    <p>先启动 Ollama 或 LM Studio，再点「测试 / 拉取模型」。也可以添加任意 OpenAI 兼容接口。</p>
                  </div>
                  <button className="primary" onClick={() => setTab('models')}>
                    去配置
                  </button>
                </div>
              )}

              <div className="choice-grid">
                <button
                  className={settings.filterMode === 'all' ? 'choice active' : 'choice'}
                  onClick={() => void patch({ filterMode: 'all' })}
                >
                  <strong>全部应用</strong>
                  <span>浏览器、PDF、Office、编辑器里都能用</span>
                </button>
                <button
                  className={settings.filterMode === 'whitelist' ? 'choice active' : 'choice'}
                  onClick={() => void patch({ filterMode: 'whitelist' })}
                >
                  <strong>仅指定应用</strong>
                  <span>只在下面勾选的应用中出现</span>
                </button>
              </div>

              <div className="panel-card">
                <div className="card-head">
                  <h2>应用列表</h2>
                  <div className="app-tools">
                    <span className="muted">
                      {apps ? `${appRows.length} 个应用` : '扫描中…'}
                      {runningCount > 0 ? ` · ${runningCount} 个运行中` : ''}
                    </span>
                    <button className="link" onClick={() => void loadApps(true)} disabled={appsLoading}>
                      {appsLoading ? '扫描中…' : '刷新'}
                    </button>
                  </div>
                </div>

                <div className="app-search">
                  <input
                    value={appQuery}
                    placeholder="搜索应用，例如 Chrome、微信、VS Code"
                    onChange={(event) => setAppQuery(event.target.value)}
                  />
                  {appQuery && (
                    <button className="link" onClick={() => setAppQuery('')}>
                      清除
                    </button>
                  )}
                </div>

                {appsError && (
                  <div className="test-error">
                    扫描应用失败：{appsError}
                    <button className="link" onClick={() => void loadApps(true)}>
                      重试
                    </button>
                  </div>
                )}

                {appsLoading && !apps && <p className="hint">正在扫描电脑上的应用…</p>}

                {visibleAppRows.length === 0 ? (
                  <div className="empty">
                    {appQuery
                      ? '没有找到匹配的应用，换个关键词试试。'
                      : '没有扫描到应用，可以在下面手动输入进程名。'}
                  </div>
                ) : (
                  <ul className="app-list tall">
                    {visibleAppRows.map((row) => (
                      <li key={row.key}>
                        <label className="app-row">
                          <input
                            type="checkbox"
                            checked={isRowWhitelisted(row.key)}
                            disabled={settings.filterMode !== 'whitelist'}
                            onChange={() => toggleAppRow(row)}
                          />
                          <span className="app-avatar">{row.label.slice(0, 1).toUpperCase()}</span>
                          <span className="app-info">
                            <span className="app-name">
                              {row.label}
                              {row.running && <span className="badge-running">运行中</span>}
                              {row.count > 0 && (
                                <span className="badge-detected">划过 {row.count} 次</span>
                              )}
                            </span>
                            <span className="app-exe">
                              {row.processName}
                              {row.title ? ` · ${row.title}` : ''}
                            </span>
                          </span>
                          <span className="app-meta">
                            {row.lastSeen ? relativeTime(row.lastSeen) : row.installed ? '已安装' : ''}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="inline-form">
                  <input
                    value={appInput}
                    placeholder="手动输入应用名或进程名，例如 chrome 或 WeChat"
                    onChange={(event) => setAppInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') addApp()
                    }}
                  />
                  <button onClick={addApp} disabled={!appInput.trim()}>
                    添加
                  </button>
                </div>
                <p className="hint">
                  {settings.filterMode === 'all'
                    ? '当前是「全部应用」；切换到「仅指定应用」后，才能勾选下面的应用。'
                    : '勾选后，只有这些应用里划词才会出现小框。'}
                  勾选保存的是真实进程名（如 msedge.exe）；手动输入按进程名精确匹配，可省略 .exe。
                  应用列表会自动扫描电脑上已安装和正在运行的程序；在注解面板和设置窗口内不会触发。
                </p>
              </div>

              {state.hookStatus === 'error' && (
                <div className="warn-card">
                  <strong>取词服务启动失败</strong>
                  <p>{state.hookError}</p>
                  <p className="muted">可尝试以管理员身份运行，或检查是否有安全软件拦截全局钩子。</p>
                  <button className="ghost" disabled={hookBusy} onClick={() => void restartHook()}>
                    {hookBusy ? '正在重启…' : '重启取词服务'}
                  </button>
                </div>
              )}
            </section>
          )}

          {tab === 'models' && (
            <section className="section">
              <header className="section-head">
                <div>
                  <h1>用哪家 AI</h1>
                  <p>先选本机还是云端，再选服务商、选模型、填 API Key。接口地址不用管。</p>
                </div>
              </header>

              <div className="active-card">
                <div className="active-main">
                  <span className="muted">当前使用</span>
                  <strong>{activeLabel}</strong>
                  <span className="active-model-name">
                    {settings.defaultModel || '还没有选择模型'}
                    {settings.defaultModel && <MultiplierBadge value={activeMultiplier} />}
                  </span>
                  {modeMismatch && (
                    <span className="active-warn">
                      {activeIsLocal
                        ? '已切到云端模式，但当前仍用本机模型；选一家云端服务并保存后生效。'
                        : '已切到本机模式，云端模型会被拦截；请选择一个本机模型。'}
                    </span>
                  )}
                </div>
                <span className={activeIsLocal ? 'pill' : 'pill warn'}>
                  {activeIsLocal ? '仅本机' : '云端'}
                </span>
              </div>

              <div className="mode-switch">
                <button
                  className={settings.localOnly ? 'mode active' : 'mode'}
                  onClick={() => void changeMode(true)}
                >
                  <strong>本机模型</strong>
                  <span>Ollama / LM Studio · 文字不离开电脑</span>
                </button>
                <button
                  className={!settings.localOnly ? 'mode active' : 'mode'}
                  onClick={() => void changeMode(false)}
                >
                  <strong>云端 AI</strong>
                  <span>DeepSeek / 通义 / Kimi 等 · 需要 API Key</span>
                </button>
              </div>

              <div className="panel-card">
                <div className="card-head">
                  <h2>选择服务商</h2>
                  <span className="muted">{settings.localOnly ? '本机' : '云端'}</span>
                </div>
                <div className="preset-grid">
                  {visiblePresets.map((preset) => {
                    const provider = state.providers.find(
                      (item) => (item.presetId ?? item.id) === preset.id
                    )
                    const configured = preset.local
                      ? (provider?.models.length ?? 0) > 0
                      : Boolean(provider?.hasKey)
                    return (
                      <button
                        key={preset.id}
                        className={
                          selectedPresetId === preset.id ? 'preset-card selected' : 'preset-card'
                        }
                        onClick={() => selectPreset(preset.id, state)}
                      >
                        <span className="preset-name">
                          {preset.name}
                          {(preset.free || (preset.freeModels?.length ?? 0) > 0) && (
                            <span className="free-badge">免费</span>
                          )}
                        </span>
                        <span className="preset-tagline">{preset.tagline}</span>
                        <span className={configured ? 'preset-state ok' : 'preset-state'}>
                          {configured ? '已配置' : '未配置'}
                        </span>
                      </button>
                    )
                  })}
                </div>
                <p className="hint">
                  标有「免费」的服务商或模型由服务商提供免费额度，具体额度和有效期以服务商页面为准。
                </p>
              </div>

              {activePreset && activeProvider && (
                <div className="panel-card setup-card">
                  <div className="card-head">
                    <h2>{activePreset.name} 设置</h2>
                    <span className="muted">
                      {activePreset.local ? '不用填 Key' : '需要 API Key'}
                    </span>
                  </div>

                  {!activePreset.local && (
                    <label className="field">
                      <span>API Key</span>
                      <input
                        type="password"
                        value={keyDraft}
                        placeholder={
                          activeProvider.hasKey
                            ? '已保存，留空表示不修改'
                            : activePreset.keyHint ?? '粘贴 API Key'
                        }
                        onChange={(event) => setKeyDraft(event.target.value)}
                      />
                      {activePreset.keyUrl && (
                        <a
                          className="field-link"
                          href={activePreset.keyUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          没有 Key？去 {activePreset.name} 获取
                        </a>
                      )}
                    </label>
                  )}

                  <label className="field">
                    <span>模型</span>
                    {activeChoices.length > 0 ? (
                      <select
                        value={modelDraft}
                        onChange={(event) => setModelDraft(event.target.value)}
                      >
                        {modelDraft && !activeChoices.includes(modelDraft) && (
                          <option value={modelDraft}>{modelDraft}（当前）</option>
                        )}
                        {!modelDraft && <option value="">请选择模型</option>}
                        {activeChoices.map((model) => (
                          <option key={model} value={model}>
                            {model}
                            {multiplierSuffix(
                              usageMultiplier({
                                model,
                                local: activePreset.local,
                                fallbackIn: activeProvider.priceIn,
                                fallbackOut: activeProvider.priceOut,
                                useFallback: !activeProvider.builtin
                              })
                            )}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div className="model-empty">
                        {activePreset.local
                          ? '还没检测到本机模型。点下面的按钮，会读取你已经下载的模型。'
                          : '这个服务商没有预置模型，请手动填写模型名。'}
                      </div>
                    )}
                  </label>
                  <p className="hint">
                    模型旁的倍率以 deepseek-flash 为 1.00×，精确到 0.01×；按每百万 tokens 输入+输出价格估算，数字越小越省，仅用于横向比较，实际费用以用量页为准。
                  </p>
                  <p className="hint">
                    免费或轻量模型响应快，适合简单注解；复杂提问和连续追问建议选能力更强的模型。
                  </p>

                  {!activePreset.local && (
                    <details className="mini-advanced">
                      <summary>列表里没有我要的模型？手动填写</summary>
                      <input
                        value={modelDraft}
                        placeholder="直接输入模型名，例如 deepseek-flash"
                        onChange={(event) => setModelDraft(event.target.value)}
                      />
                    </details>
                  )}

                  <div className="setup-actions">
                    <button
                      className="primary"
                      disabled={presetBusy}
                      onClick={() => void savePresetSettings()}
                    >
                      {presetBusy
                        ? '处理中…'
                        : activePreset.local
                          ? modelDraft
                            ? '保存并使用'
                            : '检测本机模型并启用'
                          : '保存并测试'}
                    </button>
                    {activePreset.local && (
                      <button
                        className="ghost"
                        disabled={presetBusy}
                        onClick={() => void detectLocalModels()}
                      >
                        重新检测模型
                      </button>
                    )}
                    <span className="muted">
                      {activePreset.local
                        ? '只访问本机端口，文字不离开电脑。'
                        : `选中的文字会发送给 ${activePreset.name}，请勿用于敏感内容。`}
                    </span>
                  </div>

                  {presetNotice && (
                    <p className={presetNotice.ok ? 'test-ok' : 'test-error'}>
                      {presetNotice.message}
                    </p>
                  )}

                  <details className="mini-advanced provider-guide">
                    <summary>
                      怎么配置 {activePreset.name}
                      {activePreset.local ? '' : '、怎么购买 tokens'}
                    </summary>
                    <ol className="guide-steps">
                      {activePreset.guide.steps.map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ol>
                    <div className="guide-links">
                      {activePreset.keyUrl && (
                        <a href={activePreset.keyUrl} target="_blank" rel="noreferrer">
                          获取 API Key
                        </a>
                      )}
                      {activePreset.guide.billingUrl && (
                        <a
                          href={activePreset.guide.billingUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {activePreset.guide.billingLabel ?? '充值 / 购买 tokens'}
                        </a>
                      )}
                    </div>
                    {activePreset.guide.note && (
                      <p className="hint">{activePreset.guide.note}</p>
                    )}
                  </details>
                </div>
              )}

              <details className="advanced-block">
                <summary>高级：手动填写接口地址（一般不用）</summary>
                <p className="hint">
                  只有在使用公司内网、自建代理，或上面的服务商里没有你要的接口时，才需要改这里。
                </p>

                <details className="mini-advanced provider-guide">
                  <summary>怎么配置自定义接口、怎么购买 tokens</summary>
                  <ol className="guide-steps">
                    <li>向服务商获取三样东西：Base URL、API Key、模型名。</li>
                    <li>
                      Base URL 一般以 <code>/v1</code> 结尾；不确定时看服务商文档。
                    </li>
                    <li>在服务商控制台充值或购买 tokens 后，把 Key 和模型名填到上面的表单。</li>
                    <li>保存后点「测试」，能拉到模型列表就说明配置成功。</li>
                  </ol>
                  <p className="hint">
                    如果是中转或聚合服务，确认它兼容 OpenAI 协议；不要购买来源不明的低价 Key。
                  </p>
                </details>

                {editor && (
                  <div className="panel-card editor">
                    <div className="card-head">
                      <h2>{editor.id ? '编辑服务' : '添加服务'}</h2>
                      <button className="link" onClick={() => setEditor(null)}>
                        取消
                      </button>
                    </div>
                    <div className="form-grid">
                      <label>
                        <span>名称</span>
                        <input
                          value={editor.name}
                          placeholder="例如 公司内网模型"
                          onChange={(event) => setEditor({ ...editor, name: event.target.value })}
                        />
                      </label>
                      <label>
                        <span>协议</span>
                        <select
                          value={editor.kind}
                          onChange={(event) =>
                            setEditor({ ...editor, kind: event.target.value as ProviderKind })
                          }
                        >
                          <option value="openai">OpenAI 兼容</option>
                          <option value="ollama">Ollama 原生</option>
                        </select>
                      </label>
                      <label className="full">
                        <span>Base URL</span>
                        <input
                          value={editor.baseUrl}
                          placeholder="http://127.0.0.1:11434 或 http://127.0.0.1:1234/v1"
                          onChange={(event) => setEditor({ ...editor, baseUrl: event.target.value })}
                        />
                      </label>
                      <label className="full">
                        <span>API Key（可选，保存在本机密钥存储）</span>
                        <input
                          type="password"
                          value={editor.apiKey}
                          placeholder="留空表示不修改已保存的密钥"
                          onChange={(event) => setEditor({ ...editor, apiKey: event.target.value })}
                        />
                      </label>
                      <label>
                        <span>输入价格（元 / 百万 tokens）</span>
                        <input
                          type="number"
                          min="0"
                          step="0.1"
                          value={editor.priceIn}
                          onChange={(event) =>
                            setEditor({ ...editor, priceIn: Math.max(0, Number(event.target.value) || 0) })
                          }
                        />
                      </label>
                      <label>
                        <span>输出价格（元 / 百万 tokens）</span>
                        <input
                          type="number"
                          min="0"
                          step="0.1"
                          value={editor.priceOut}
                          onChange={(event) =>
                            setEditor({ ...editor, priceOut: Math.max(0, Number(event.target.value) || 0) })
                          }
                        />
                      </label>
                    </div>
                    <p className="hint">费用按这里的价格估算；内置服务商已带默认价目，本机模型为 0。</p>
                    <div className="form-actions">
                      <button
                        className="primary"
                        disabled={savingProvider}
                        onClick={() => void saveProvider()}
                      >
                        {savingProvider ? '保存中…' : '保存'}
                      </button>
                      {editor.id && (
                        <button
                          className="ghost danger"
                          onClick={async () => {
                            await window.zhujie.saveProvider({
                              id: editor.id,
                              name: editor.name,
                              kind: editor.kind,
                              baseUrl: editor.baseUrl,
                              apiKey: null
                            })
                            flash('已清除密钥')
                          }}
                        >
                          清除密钥
                        </button>
                      )}
                    </div>
                  </div>
                )}

                <div className="provider-list">
                  {state.providers
                    .filter((provider) => !provider.presetId)
                    .map((provider) => (
                      <ProviderCard
                        key={provider.id}
                        provider={provider}
                        test={tests[provider.id]}
                        isDefault={provider.id === settings.defaultProviderId}
                        onTest={() => void testProvider(provider.id)}
                        onEdit={() =>
                          setEditor({
                            id: provider.id,
                            name: provider.name,
                            kind: provider.kind,
                            baseUrl: provider.baseUrl,
                            apiKey: '',
                            priceIn: provider.priceIn,
                            priceOut: provider.priceOut
                          })
                        }
                        onRemove={async () => {
                          if (!window.confirm(`删除「${provider.name}」？`)) return
                          try {
                            setState(await window.zhujie.removeProvider(provider.id))
                            flash('已删除')
                          } catch (error) {
                            flash(readableError(error))
                          }
                        }}
                        onUseModel={(model) => {
                          void patch(
                            { defaultProviderId: provider.id, defaultModel: model },
                            `默认模型：${model}`
                          )
                        }}
                        currentModel={
                          provider.id === settings.defaultProviderId ? settings.defaultModel : ''
                        }
                      />
                    ))}
                </div>

                <button
                  className="ghost"
                  onClick={() =>
                    setEditor({ name: '', kind: 'openai', baseUrl: '', apiKey: '', priceIn: 0, priceOut: 0 })
                  }
                >
                  添加自定义服务
                </button>
              </details>
            </section>
          )}

          {tab === 'prompt' && (
            <section className="section">
              <header className="section-head">
                <div>
                  <h1>注解提示词</h1>
                  <p>作为系统提示词发送给模型；选中的文字会作为用户消息附在后面。</p>
                </div>
                <div className="head-actions">
                  <button
                    className="ghost"
                    onClick={() => {
                      setPromptDraft(DEFAULT_PROMPT)
                      setPromptDirty(true)
                    }}
                  >
                    恢复默认
                  </button>
                  <button className="primary" disabled={!promptDirty} onClick={() => void savePrompt()}>
                    保存
                  </button>
                </div>
              </header>

              <div className="notice-card">
                <div>
                  <strong>回答顺序（应用强制执行）</strong>
                  <p>
                    选中的词优先：词义 → 在当前语境 → 作用。旧提示词不会改变这个顺序；
                    点「恢复默认」可套用新的三段式模板。
                  </p>
                </div>
                <button
                  className="ghost"
                  onClick={() => {
                    setPromptDraft(DEFAULT_PROMPT)
                    setPromptDirty(true)
                  }}
                >
                  套用模板
                </button>
              </div>

              <div className="panel-card">
                <div className="card-head">
                  <h2>结合上下文</h2>
                  <input
                    type="checkbox"
                    className="switch"
                    checked={settings.useContext}
                    onChange={(event) => void patch({ useContext: event.target.checked })}
                  />
                </div>
                <p className="muted">
                  开启后，点「注解 / 提问」时会读取选中位置前后各 {settings.contextChars} 字，把
                  【选中】部分标出来后一起发给模型。只读取当前应用的无障碍文本，不截屏；取不到时自动只发选中文字。
                </p>
                <div className="context-length">
                  <span>前后各</span>
                  <input
                    key={settings.contextChars}
                    type="number"
                    min="100"
                    max="1000"
                    step="50"
                    defaultValue={settings.contextChars}
                    disabled={!settings.useContext}
                    onBlur={(event) => {
                      const value = Number(event.target.value)
                      void patch({
                        contextChars:
                          Number.isFinite(value) && value > 0
                            ? Math.min(1000, Math.max(100, value))
                            : 100
                      })
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur()
                    }}
                  />
                  <span>字</span>
                  <span className="muted">
                    会多发送约 2 倍上下文，费用通常为原来的 1.5–2 倍。
                  </span>
                </div>
              </div>

              <div className="panel-card">
                <div className="card-head">
                  <h2>单次发送上限</h2>
                  <span className="muted">当前 {settings.maxChars} 字</span>
                </div>
                <p className="muted">
                  选中文字超过上限时只发送前面的部分，注解面板会明确提示「已截断」，不会让你误以为整段都发送了。
                </p>
                <div className="context-length">
                  <span>最多</span>
                  <input
                    key={settings.maxChars}
                    type="number"
                    min="100"
                    max="20000"
                    step="100"
                    defaultValue={settings.maxChars}
                    onBlur={(event) => {
                      const value = Number(event.target.value)
                      void patch({
                        maxChars:
                          Number.isFinite(value) && value > 0
                            ? Math.min(20000, Math.max(100, value))
                            : 100
                      })
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur()
                    }}
                  />
                  <span>字</span>
                </div>
              </div>

              <div className="panel-card">
                <textarea
                  className="prompt-box"
                  value={promptDraft}
                  onChange={(event) => {
                    setPromptDraft(event.target.value)
                    setPromptDirty(true)
                  }}
                  spellCheck={false}
                />
                <div className="prompt-foot">
                  <span className="muted">{promptDraft.length} 字</span>
                  <span className="muted">建议保留“Markdown / 300 字以内”之类的约束，面板显示更稳定。</span>
                </div>
              </div>
            </section>
          )}

          {tab === 'history' && (
            <section className="section">
              <header className="section-head">
                <div>
                  <h1>历史记录</h1>
                  <p>
                    注解和提问都会保存在本机，最多保留 {HISTORY_LIMIT} 条；满了可以压缩成综合摘要。
                  </p>
                </div>
                <button
                  className="ghost danger"
                  disabled={!historyItems?.length}
                  onClick={() => void clearHistory()}
                >
                  清空记录
                </button>
              </header>

              {historyItems && historyItems.length >= HISTORY_LIMIT && (
                <div className="notice-card">
                  <div>
                    <strong>历史已满 {HISTORY_LIMIT} 条</strong>
                    <p>
                      可以把最早的 {HISTORY_LIMIT - HISTORY_KEEP_RECENT} 条压缩成一份综合摘要，保留最近{' '}
                      {HISTORY_KEEP_RECENT} 条。压缩会调用当前模型，可能需要一点时间并产生费用。
                    </p>
                  </div>
                  <button
                    className="primary"
                    disabled={compressState?.busy}
                    onClick={() => void compressHistory()}
                  >
                    {compressState?.busy ? '压缩中…' : '压缩旧记录'}
                  </button>
                </div>
              )}

              {compressState?.busy && (
                <div className="compress-status">
                  <div className="compress-bar">
                    <span
                      style={{
                        width: `${Math.min(
                          100,
                          Math.round(
                            (compressState.done / Math.max(1, compressState.total)) * 100
                          )
                        )}%`
                      }}
                    />
                  </div>
                  <span>{compressState.message}</span>
                </div>
              )}
              {compressState?.error && <p className="test-error">{compressState.error}</p>}

              {summaries.length > 0 && (
                <div className="summary-list">
                  <div className="summary-list-head">
                    <strong>综合摘要</strong>
                    <span className="muted">旧记录压缩后会保留在这里</span>
                  </div>
                  {summaries.map((summary) => (
                    <SummaryCard key={summary.id} summary={summary} />
                  ))}
                </div>
              )}

              <div className="history-toolbar">
                <input
                  value={historyQuery}
                  placeholder="搜索选中的文字、问题、回答或应用"
                  onChange={(event) => setHistoryQuery(event.target.value)}
                />
                <span className="muted">共 {historyItems?.length ?? 0} 条</span>
                <label
                  className="history-toggle"
                  title="关闭后新的注解/提问不再写入历史，已有记录保留"
                >
                  <input
                    type="checkbox"
                    checked={settings.historyEnabled}
                    onChange={(event) => void patch({ historyEnabled: event.target.checked })}
                  />
                  记录新历史
                </label>
              </div>

              {!historyItems || historyItems.length === 0 ? (
                <div className="panel-card empty tall">
                  还没有历史记录。选中文字做一次注解或提问后，这里会出现记录。
                </div>
              ) : filteredThreads.length === 0 ? (
                <div className="panel-card empty tall">没有匹配的记录，换个关键词试试。</div>
              ) : (
                <div className="history-layout">
                  <div className="history-list">
                    {filteredThreads.map((thread) => (
                      <button
                        key={thread.key}
                        className={
                          selectedThread?.key === thread.key ? 'history-item active' : 'history-item'
                        }
                        onClick={() => setSelectedHistoryId(thread.latest.id)}
                      >
                        <div className="history-item-top">
                          <span
                            className={
                              thread.latest.mode === 'ask' ? 'history-mode ask' : 'history-mode'
                            }
                          >
                            {thread.latest.mode === 'ask' ? '提问' : '注解'}
                          </span>
                          <span className="muted">{fmtTime(thread.latest.ts)}</span>
                        </div>
                        <div className="history-snippet">
                          {thread.latest.question || thread.latest.text}
                        </div>
                        <div className="history-meta">
                          {thread.latest.programName} · {thread.latest.model}
                          {thread.items.length > 1 ? ` · ${thread.items.length} 轮问答` : ''}
                        </div>
                      </button>
                    ))}
                  </div>

                  {selectedThread && (
                    <div className="history-detail">
                      <div className="history-detail-head">
                        <div>
                          <strong>连续对话 · {selectedThread.items.length} 轮</strong>
                          <span className="muted">
                            {fmtTime(selectedThread.latest.ts)} ·{' '}
                            {selectedThread.latest.programName} · {selectedThread.latest.model}
                          </span>
                        </div>
                        <div className="history-actions">
                          <button
                            className="link"
                            onClick={() => void copyHistoryThread(selectedThread)}
                          >
                            复制完整对话
                          </button>
                        </div>
                      </div>

                      {!selectedThread.items.some((record) => record.mode === 'annotate') && (
                        <div className="history-quote">{selectedThread.latest.text}</div>
                      )}

                      {selectedThread.items.map((record) => {
                        const favorited = Boolean(
                          favorites?.some((item) => item.turnId === record.id)
                        )
                        return (
                          <div className="history-thread-turn" key={record.id}>
                            <div className="history-thread-head">
                              <span
                                className={
                                  record.mode === 'ask' ? 'history-mode ask' : 'history-mode'
                                }
                              >
                                {record.mode === 'ask' ? '追问' : '注解'}
                              </span>
                              <span className="muted">{fmtTime(record.ts)}</span>
                              <span className="foot-spacer" />
                              <div className="history-actions">
                                <button
                                  className="link"
                                  onClick={() => void toggleHistoryFavorite(record)}
                                >
                                  {favorited ? '已收藏' : '收藏'}
                                </button>
                                <button
                                  className="link danger"
                                  onClick={() => void removeHistory(record.id)}
                                >
                                  删除
                                </button>
                              </div>
                            </div>
                            {record.mode === 'annotate' && (
                              <div className="history-quote">{record.text}</div>
                            )}
                            {record.mode === 'ask' && (
                              <div className="asked-question">
                                <span>你的问题</span>
                                <p>{record.question}</p>
                              </div>
                            )}
                            <div
                              className="history-answer markdown"
                              dangerouslySetInnerHTML={{
                                __html: DOMPurify.sanitize(marked.parse(record.answer) as string)
                              }}
                            />
                            <div className="history-foot">
                              {record.totalTokens.toLocaleString()} tokens ·{' '}
                              {formatCny(record.cost)}
                              {record.contextChars
                                ? ` · 结合上下文 ${record.contextChars} 字`
                                : ''}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          {tab === 'favorites' && (
            <section className="section">
              <header className="section-head">
                <div>
                  <h1>收藏</h1>
                  <p>在注解面板点右上角星星，收藏当前的问答；只保存在本机。</p>
                </div>
                <button
                  className="ghost danger"
                  disabled={!favorites?.length}
                  onClick={() => void clearFavorites()}
                >
                  清空收藏
                </button>
              </header>

              {!favorites || favorites.length === 0 ? (
                <div className="panel-card empty tall">
                  还没有收藏。打开一条注解或提问，点右上角的星星即可收藏当前问答。
                </div>
              ) : (
                <div className="favorite-list">
                  {favorites.map((favorite) => (
                    <FavoriteCard
                      key={favorite.id}
                      favorite={favorite}
                      onDelete={() => void removeFavorite(favorite.id)}
                    />
                  ))}
                </div>
              )}
            </section>
          )}

          {tab === 'usage' && (
            <section className="section">
              <header className="section-head">
                <div>
                  <h1>用量统计</h1>
                  <p>记录每次注解/提问的模型、token、费用与耗时，数据只写在本机。</p>
                </div>
                <div className="head-actions">
                  <button
                    className="ghost"
                    onClick={() => void refreshUsage().then(() => flash('用量已刷新'))}
                  >
                    刷新
                  </button>
                  <button className="ghost danger" onClick={() => void clearUsage()}>
                    清空记录
                  </button>
                </div>
              </header>

              {!usage || usage.total.requests === 0 ? (
                <div className="panel-card empty tall">
                  还没有用量。选中一段文字、点开「注解」后，这里会按模型和应用记录 token。
                </div>
              ) : (
                <>
                  <div className="stat-grid">
                    <div className="stat">
                      <span>今日 tokens</span>
                      <strong>{fmtNum(usage.today.tokens)}</strong>
                      <small>{usage.today.requests} 次 · {formatCny(usage.today.cost)}</small>
                    </div>
                    <div className="stat">
                      <span>累计 tokens</span>
                      <strong>{fmtNum(usage.total.tokens)}</strong>
                      <small>{usage.total.requests} 次 · {formatCny(usage.total.cost)}</small>
                    </div>
                    <div className="stat">
                      <span>累计花费</span>
                      <strong>{formatCny(usage.total.cost)}</strong>
                      <small>人民币估算</small>
                    </div>
                    <div className="stat">
                      <span>平均耗时</span>
                      <strong>{(usage.avgLatencyMs / 1000).toFixed(1)}s</strong>
                      <small>仅统计成功请求</small>
                    </div>
                    <div className="stat">
                      <span>使用模型</span>
                      <strong>{usage.byModel.length}</strong>
                      <small>{usage.byApp.length} 个应用</small>
                    </div>
                  </div>

                  <div className="panel-card">
                    <div className="card-head">
                      <h2>近 14 天</h2>
                      <span className="muted">tokens / 天</span>
                    </div>
                    <div className="chart">
                      {(() => {
                        const max = Math.max(1, ...usage.byDay.map((d) => d.tokens))
                        return usage.byDay.map((day) => (
                          <div
                            className="chart-col"
                            key={day.date}
                            title={`${day.date} · ${fmtNum(day.tokens)} tokens · ${formatCny(day.cost)}`}
                          >
                            <div className="chart-bar-wrap">
                              <div
                                className="chart-bar"
                                style={{ height: `${Math.max(day.tokens > 0 ? 6 : 1, (day.tokens / max) * 100)}%` }}
                              />
                            </div>
                            <span>{day.date.slice(5)}</span>
                          </div>
                        ))
                      })()}
                    </div>
                  </div>

                  <div className="two-col">
                    <div className="panel-card">
                      <div className="card-head">
                        <h2>按模型</h2>
                      </div>
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>模型</th>
                            <th>次数</th>
                            <th>tokens</th>
                            <th>花费</th>
                          </tr>
                        </thead>
                        <tbody>
                          {usage.byModel.map((bucket) => (
                            <tr key={bucket.key}>
                              <td className="mono">{bucket.key}</td>
                              <td>{bucket.requests}</td>
                              <td>{fmtNum(bucket.tokens)}</td>
                              <td>{formatCny(bucket.cost)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="panel-card">
                      <div className="card-head">
                        <h2>按应用</h2>
                      </div>
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>应用</th>
                            <th>次数</th>
                            <th>tokens</th>
                            <th>花费</th>
                          </tr>
                        </thead>
                        <tbody>
                          {usage.byApp.slice(0, 8).map((bucket) => (
                            <tr key={bucket.key}>
                              <td>{bucket.key}</td>
                              <td>{bucket.requests}</td>
                              <td>{fmtNum(bucket.tokens)}</td>
                              <td>{formatCny(bucket.cost)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="panel-card">
                    <div className="card-head">
                      <h2>最近记录</h2>
                      <span className="muted">最多显示 50 条</span>
                    </div>
                    <table className="data-table recent-table">
                      <thead>
                        <tr>
                          <th>时间</th>
                          <th>应用</th>
                          <th>模型</th>
                          <th>tokens</th>
                          <th>花费</th>
                          <th>耗时</th>
                          <th>状态</th>
                        </tr>
                      </thead>
                      <tbody>
                        {usage.recent.map((record) => (
                          <tr key={record.id} title={record.error ?? ''}>
                            <td>{fmtTime(record.ts)}</td>
                            <td>{record.programName}</td>
                            <td className="mono">{record.model}</td>
                            <td>
                              {record.estimated ? '≈' : ''}
                              {fmtNum(record.totalTokens)}
                            </td>
                            <td>{formatCny(record.cost ?? 0)}</td>
                            <td>{Math.round(record.latencyMs)}ms</td>
                            <td>
                              <span className={record.ok ? 'status ok' : 'status bad'}>
                                {record.ok ? '成功' : '失败'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="hint">
                      费用按内置价目估算（人民币），本机模型为 0；自定义接口可在「高级」里填写输入/输出价格。
                    </p>
                  </div>
                </>
              )}
            </section>
          )}

          {tab === 'about' && (
            <section className="section">
              <header className="section-head">
                <div>
                  <h1>关于</h1>
                  <p>划词注解 · 本地优先的阅读辅助工具。</p>
                </div>
              </header>

              <div className="panel-card about-grid">
                <div>
                  <span className="muted">版本</span>
                  <strong>{state.version}</strong>
                </div>
                <div>
                  <span className="muted">制作人</span>
                  <strong>piona</strong>
                </div>
                <div>
                  <span className="muted">平台</span>
                  <strong>{state.platform}</strong>
                </div>
                <div>
                  <span className="muted">取词服务</span>
                  <div className="copy-line">
                    <strong>{state.hookStatus === 'running' ? '运行中' : state.hookStatus}</strong>
                    <button className="link" disabled={hookBusy} onClick={() => void restartHook()}>
                      {hookBusy ? '重启中…' : '重启'}
                    </button>
                  </div>
                </div>
                <div>
                  <span className="muted">数据目录</span>
                  <div className="copy-line">
                    <code title={state.dataDir}>{state.dataDir}</code>
                    <button
                      className="link"
                      onClick={() => {
                        void window.zhujie.writeClipboard(state.dataDir)
                        flash('路径已复制')
                      }}
                    >
                      复制
                    </button>
                  </div>
                </div>
              </div>

              <div className="panel-card update-card">
                <div className="card-head">
                  <h2>版本更新</h2>
                  <span className="muted">当前 v{state.version}</span>
                </div>
                <p className="muted">
                  {state.update.phase === 'idle' && '应用会在启动后自动检查 GitHub Releases。'}
                  {state.update.phase === 'checking' && '正在检查更新…'}
                  {state.update.phase === 'latest' &&
                    `已是最新版本${state.update.latestVersion ? ` v${state.update.latestVersion}` : ''}。`}
                  {state.update.phase === 'available' &&
                    `发现新版本 v${state.update.latestVersion ?? ''}。${
                      settings.autoDownloadUpdates ? '正在自动下载…' : '点击「下载更新」后再下载。'
                    }`}
                  {state.update.phase === 'downloading' &&
                    `正在下载 v${state.update.latestVersion ?? ''}（${updateProgress?.progress ?? state.update.progress ?? 0}%）。`}
                  {state.update.phase === 'ready' &&
                    `v${state.update.latestVersion ?? ''} 已下载并通过 SHA-256 校验；重启后替换程序文件，配置和历史会保留。`}
                  {state.update.phase === 'error' && '更新未完成。'}
                </p>
                {state.update.phase === 'downloading' && (
                  <div className="update-progress">
                    <span
                      style={{
                        width: `${Math.min(
                          100,
                          updateProgress?.progress ?? state.update.progress ?? 0
                        )}%`
                      }}
                    />
                  </div>
                )}
                {state.update.phase === 'error' && (
                  <p className="test-error">{state.update.message}</p>
                )}
                <div className="update-actions">
                  <button
                    className="ghost"
                    disabled={['checking', 'downloading', 'ready'].includes(state.update.phase)}
                    onClick={() => void window.zhujie.checkUpdates()}
                  >
                    {state.update.phase === 'checking' ? '检查中…' : '检查更新'}
                  </button>
                  {state.update.phase === 'available' && (
                    <button className="primary" onClick={() => void downloadUpdate()}>
                      下载更新
                    </button>
                  )}
                  {state.update.phase === 'error' && state.update.latestVersion && (
                    <button className="primary" onClick={() => void downloadUpdate()}>
                      重试下载
                    </button>
                  )}
                  {state.update.phase === 'ready' && (
                    <button
                      className="primary"
                      onClick={async () => {
                        const result = await window.zhujie.installUpdate()
                        if (!result.ok) flash(result.error ?? '更新失败')
                      }}
                    >
                      重启并更新
                    </button>
                  )}
                  <button className="link" onClick={() => void window.zhujie.openReleasePage()}>
                    打开发布页
                  </button>
                </div>
                <label className="switch-row update-auto">
                  <span>发现新版本后自动下载</span>
                  <input
                    type="checkbox"
                    className="switch"
                    checked={settings.autoDownloadUpdates}
                    onChange={(event) => void patch({ autoDownloadUpdates: event.target.checked })}
                  />
                </label>
                <p className="hint">
                  关闭时只弹出提示，点「下载更新」后才下载；无论开关如何，都需要你点「重启并更新」才会替换程序。
                </p>
              </div>

              <div className="panel-card">
                <div className="card-head">
                  <h2>启动</h2>
                  <input
                    type="checkbox"
                    className="switch"
                    checked={settings.launchAtLogin}
                    onChange={(event) => void patch({ launchAtLogin: event.target.checked })}
                  />
                </div>
                <p className="muted">开机后自动在托盘运行，不弹窗；需要时点托盘图标打开设置。</p>
              </div>

              <div className="panel-card">
                <div className="card-head">
                  <h2>隐私</h2>
                </div>
                <p className="prose">
                  配置、用量记录、历史对话和综合摘要都只保存在本机数据目录。历史和摘要是明文文件，
                  未做额外加密。默认开启「仅本机」，请求只会发往 localhost。关闭后才会使用你自行配置的
                  云端接口；本应用没有内置遥测、账号或云同步。
                </p>
              </div>

              <div className="panel-card">
                <div className="card-head">
                  <h2>参考项目与许可</h2>
                  <span className="muted">MIT · 制作人 piona</span>
                </div>
                <ul className="ref-list">
                  <li>
                    <a href="https://github.com/0xfullex/selection-hook" target="_blank" rel="noreferrer">
                      selection-hook
                    </a>
                    <span className="license">MIT</span>
                    <span>全局划词取词与鼠标/键盘钩子，返回文本、坐标与应用名。</span>
                  </li>
                  <li>
                    <a href="https://github.com/zcx960/AIA-selection-assistan" target="_blank" rel="noreferrer">
                      AIA-selection-assistan
                    </a>
                    <span className="license">MIT</span>
                    <span>Electron 划词助手的交互与窗口定位思路参考。</span>
                  </li>
                  <li>
                    <a href="https://github.com/CherryHQ/cherry-studio" target="_blank" rel="noreferrer">
                      Cherry Studio
                    </a>
                    <span className="license warn">AGPL-3.0</span>
                    <span>划词助手产品形态调研；未复用其代码。</span>
                  </li>
                  <li>
                    <a href="https://github.com/pot-app/pot-desktop" target="_blank" rel="noreferrer">
                      pot-desktop
                    </a>
                    <span className="license warn">GPL-3.0</span>
                    <span>划词翻译交互调研；仓库已归档，未复用其代码。</span>
                  </li>
                  <li>
                    <a href="https://github.com/nextai-translator/nextai-translator" target="_blank" rel="noreferrer">
                      nextai-translator
                    </a>
                    <span className="license warn">AGPL-3.0</span>
                    <span>桌面划词产品调研；未复用其代码。</span>
                  </li>
                </ul>
              </div>
            </section>
          )}
        </main>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

interface ProviderCardProps {
  provider: ProviderView
  test?: TestState
  isDefault: boolean
  currentModel: string
  onTest: () => void
  onEdit: () => void
  onRemove: () => void
  onUseModel: (model: string) => void
}

function FavoriteCard({
  favorite,
  onDelete
}: {
  favorite: FavoriteRecord
  onDelete: () => void
}): JSX.Element {
  const html = useMemo(
    () => DOMPurify.sanitize(marked.parse(favorite.answer) as string),
    [favorite.answer]
  )
  const [copied, setCopied] = useState(false)

  const copy = async (): Promise<void> => {
    await window.zhujie.writeClipboard(favorite.answer)
    setCopied(true)
    setTimeout(() => setCopied(false), 1400)
  }

  return (
    <article className="favorite-card">
      <div className="favorite-head">
        <div className="favorite-meta">
          <span className={favorite.mode === 'ask' ? 'history-mode ask' : 'history-mode'}>
            {favorite.mode === 'ask' ? '提问' : '注解'}
          </span>
          <span className="muted">
            {fmtTime(favorite.ts)} · {favorite.programName} · {favorite.model}
          </span>
        </div>
        <div className="favorite-actions">
          <button className="link" onClick={() => void copy()}>
            {copied ? '已复制' : '复制回答'}
          </button>
          <button className="link danger" onClick={onDelete}>
            删除
          </button>
        </div>
      </div>
      <div className="favorite-question">
        <span>{favorite.question ? '你的问题' : '选中的文字'}</span>
        <p>{favorite.question || favorite.text}</p>
      </div>
      <div className="favorite-answer markdown" dangerouslySetInnerHTML={{ __html: html }} />
      <div className="favorite-foot">
        {favorite.totalTokens.toLocaleString()} tokens · {formatCny(favorite.cost)}
        {favorite.contextChars ? ` · 结合上下文 ${favorite.contextChars} 字` : ''}
      </div>
    </article>
  )
}

function SummaryCard({ summary }: { summary: HistorySummary }): JSX.Element {
  const html = useMemo(
    () => DOMPurify.sanitize(marked.parse(summary.summary) as string),
    [summary.summary]
  )
  const [copied, setCopied] = useState(false)

  const copy = async (): Promise<void> => {
    await window.zhujie.writeClipboard(summary.summary)
    setCopied(true)
    setTimeout(() => setCopied(false), 1400)
  }

  return (
    <details className="summary-card" open>
      <summary>
        <span className="history-mode summary">综合</span>
        <span className="summary-title">{summary.sourceCount} 条记录</span>
        <span className="summary-meta">
          {fmtTime(summary.fromTs)} – {fmtTime(summary.toTs)} · {summary.model}
        </span>
      </summary>
      <div className="summary-body markdown" dangerouslySetInnerHTML={{ __html: html }} />
      <div className="summary-foot">
        <span>
          {summary.providerName} · {summary.totalTokens.toLocaleString()} tokens ·{' '}
          {formatCny(summary.cost)}
        </span>
        <button className="link" onClick={() => void copy()}>
          {copied ? '已复制' : '复制摘要'}
        </button>
      </div>
    </details>
  )
}

function ProviderCard({
  provider,
  test,
  isDefault,
  currentModel,
  onTest,
  onEdit,
  onRemove,
  onUseModel
}: ProviderCardProps): JSX.Element {
  const local = /^(http:\/\/)?(localhost|127\.0\.0\.1|\[::1\])/i.test(provider.baseUrl)
  const preset = presetById(provider.presetId ?? '')
  const hasFree = local || Boolean(preset?.free) || (preset?.freeModels?.length ?? 0) > 0
  return (
    <div className={isDefault ? 'provider-card default' : 'provider-card'}>
      <div className="provider-head">
        <div>
          <h3>
            {provider.name}
            {isDefault && <span className="pill accent">默认</span>}
            <span className={local ? 'pill' : 'pill warn'}>{local ? '本机' : '外部'}</span>
            {hasFree && <span className="free-badge">免费</span>}
          </h3>
          <code className="provider-url">{provider.baseUrl}</code>
        </div>
        <div className="provider-actions">
          <button className="ghost" onClick={onTest} disabled={test?.loading}>
            {test?.loading ? '测试中…' : '测试 / 拉取模型'}
          </button>
          <button className="ghost" onClick={onEdit}>
            编辑
          </button>
          {!provider.builtin && (
            <button className="ghost danger" onClick={onRemove}>
              删除
            </button>
          )}
        </div>
      </div>

      <div className="model-chips">
        {provider.models.length === 0 ? (
          <span className="muted">尚未获取模型列表</span>
        ) : (
          provider.models.map((model) => (
            <button
              key={model}
              className={model === currentModel ? 'chip-model active' : 'chip-model'}
              onClick={() => onUseModel(model)}
              title="设为默认模型"
            >
              {model}
              <MultiplierBadge
                value={usageMultiplier({
                  model,
                  local,
                  fallbackIn: provider.priceIn,
                  fallbackOut: provider.priceOut,
                  useFallback: !provider.builtin
                })}
              />
            </button>
          ))
        )}
      </div>

      {test?.error && <p className="test-error">{test.error}</p>}
      {test?.ok && <p className="test-ok">连接正常，发现 {test.models} 个模型。</p>}
      {provider.hasKey && <span className="key-flag">已保存 API Key</span>}
    </div>
  )
}
