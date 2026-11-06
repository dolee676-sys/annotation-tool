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
import { DEFAULT_PROMPT, DEFAULT_PROMPT_EN, HISTORY_KEEP_RECENT, HISTORY_LIMIT } from '../../shared/types'
import {
  PROVIDER_PRESETS,
  isLocalAddress,
  presetById,
  presetDisplayName,
  presetGuide,
  presetName,
  presetTagline
} from '../../shared/presets'
import { formatCny, formatUsageMultiplier, usageMultiplier } from '../../shared/pricing'
import { groupQwenModels, modelDisplayName, type ModelGroup } from '../../shared/modelCatalog'
import { getI18nLocale, setI18nLocale, t } from './i18n'
import appIcon from './assets/app-icon.png'

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

const MODEL_GROUP_LABELS: Record<ModelGroup, string> = {
  recommended: '推荐（按注解/问答效果排序）',
  text: '其他对话模型',
  other: '图片 / 语音 / 向量等（不用于文字注解）'
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

const fmtNum = (n: number): string => n.toLocaleString(getI18nLocale())

const fmtTime = (ts: number): string =>
  new Date(ts).toLocaleString(getI18nLocale(), {
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
      <span className="multiplier unknown" title={t('未收录该模型价格，暂不比较')}>
        —
      </span>
    )
  }
  const tone = value === 0 ? 'free' : value < 0.5 ? 'low' : value <= 2 ? 'mid' : 'high'
  return (
    <span
      className={`multiplier ${tone}`}
      title={t('相对 deepseek-flash 的 token 价格；按每百万 tokens 输入+输出估算，实际以用量页为准')}
    >
      {formatUsageMultiplier(value)}
    </span>
  )
}

const multiplierSuffix = (value: number | null): string => {
  if (value === null) return ''
  if (value === 0) return t('（免费）')
  return `（${formatUsageMultiplier(value)}）`
}

const promptForLocale = (prompt: string, locale: string): string => {
  const value = prompt.trim()
  if (locale === 'en-US' && value === DEFAULT_PROMPT.trim()) return DEFAULT_PROMPT_EN
  if (locale === 'zh-CN' && value === DEFAULT_PROMPT_EN.trim()) return DEFAULT_PROMPT
  return prompt
}

const normalizeAppName = (value: string): string =>
  value.trim().toLowerCase().replace(/\.exe$/i, '')

function historyThreadKey(record: HistoryRecord): string {
  return record.conversationId ?? `${record.programName}\u0000${record.text}`
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return t('刚刚')
  if (minutes < 60) return t('{count} 分钟前', { count: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('{count} 小时前', { count: hours })
  return t('{count} 天前', { count: Math.floor(hours / 24) })
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
      setAppsError(error instanceof Error ? error.message : t('扫描应用失败'))
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
      setPromptDraft(promptForLocale(next.settings.prompt, next.locale))
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
    if (state && !promptDirty) setPromptDraft(promptForLocale(state.settings.prompt, state.locale))
  }, [state, promptDirty])

  useEffect(() => {
    if (!state || tabInitialized) return
    const hasUsableModel = state.providers.some(
      (provider) =>
        provider.models.length > 0 && (provider.hasKey || isLocalAddress(provider.baseUrl))
    )
    if (!state.settings.defaultModel || !hasUsableModel) setTab('models')
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
      flash(t('已在列表中'))
      return
    }
    void patch(
      { whitelist: [...state.settings.whitelist, name] },
      t('已加入：{name}', { name })
    )
    setAppInput('')
  }

  const savePrompt = async (): Promise<void> => {
    if (!promptDraft.trim()) {
      flash(t('提示词不能为空'))
      return
    }
    await patch({ prompt: promptDraft }, t('提示词已保存'))
    setPromptDirty(false)
  }

  const saveProvider = async (): Promise<void> => {
    if (!editor) return
    if (!editor.baseUrl.trim()) {
      flash(t('请填写 Base URL'))
      return
    }
    setSavingProvider(true)
    try {
      const payload: ProviderPatch = {
        id: editor.id,
        name: editor.name || t('自定义服务'),
        kind: editor.kind,
        baseUrl: editor.baseUrl,
        apiKey: editor.apiKey.trim() ? editor.apiKey.trim() : undefined,
        priceIn: editor.priceIn,
        priceOut: editor.priceOut
      }
      const updated = await window.zhujie.saveProvider(payload)
      setState(updated)
      setEditor(null)
      flash(t('模型服务已保存'))
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
        flash(t('连接成功，发现 {count} 个模型', { count: result.models.length }))
      }
    } catch (error) {
      const message = readableError(error)
      setTests((prev) => ({ ...prev, [id]: { ok: false, error: message } }))
      flash(message)
    }
  }

  const clearUsage = async (): Promise<void> => {
    if (!window.confirm(t('确定清空本机用量记录？此操作不可恢复。'))) return
    try {
      setUsage(await window.zhujie.clearUsage())
      flash(t('用量记录已清空'))
    } catch (error) {
      flash(readableError(error))
    }
  }

  const removeHistory = async (id: string): Promise<void> => {
    try {
      const items = await window.zhujie.deleteHistory(id)
      setHistoryItems(items)
      setSelectedHistoryId(items[0]?.id ?? '')
      flash(t('历史记录已删除'))
    } catch (error) {
      flash(readableError(error))
    }
  }

  const clearHistory = async (): Promise<void> => {
    if (!window.confirm(t('清空全部历史记录和综合摘要？此操作不可恢复。'))) return
    try {
      await window.zhujie.clearHistory()
      await loadHistory()
      setSelectedHistoryId('')
      flash(t('历史记录已清空'))
    } catch (error) {
      flash(readableError(error))
    }
  }

  const removeFavorite = async (id: string): Promise<void> => {
    try {
      setFavorites(await window.zhujie.deleteFavorite(id))
      flash(t('收藏已删除'))
    } catch (error) {
      flash(readableError(error))
    }
  }

  const clearFavorites = async (): Promise<void> => {
    if (!window.confirm(t('清空全部收藏？此操作不可恢复。'))) return
    try {
      setFavorites(await window.zhujie.clearFavorites())
      flash(t('收藏已清空'))
    } catch (error) {
      flash(readableError(error))
    }
  }

  const copyHistoryThread = async (thread: HistoryThread): Promise<void> => {
    const parts = thread.items.map((record) =>
      record.question
        ? t('问：{question}\n答：{answer}', {
            question: record.question,
            answer: record.answer
          })
        : record.answer
    )
    await window.zhujie.writeClipboard(parts.join('\n\n---\n\n'))
    flash(t('已复制完整对话'))
  }

  const toggleHistoryFavorite = async (record: HistoryRecord): Promise<void> => {
    try {
      const result = await window.zhujie.toggleHistoryFavorite(record.id)
      if (!result.ok) {
        flash(result.error ?? t('收藏失败'))
        return
      }
      await loadFavorites()
      flash(result.favorited ? t('已收藏这条问答') : t('已取消收藏'))
    } catch (error) {
      flash(readableError(error))
    }
  }

  const restartHook = async (): Promise<void> => {
    setHookBusy(true)
    try {
      setState(await window.zhujie.restartHook())
      flash(t('取词服务已重启'))
    } catch (error) {
      flash(readableError(error))
    } finally {
      setHookBusy(false)
    }
  }

  const downloadUpdate = async (): Promise<void> => {
    try {
      const status = await window.zhujie.downloadUpdate()
      if (status.phase === 'error') flash(status.message ?? t('下载更新失败'))
    } catch (error) {
      flash(readableError(error))
    }
  }

  const compressHistory = async (): Promise<void> => {
    const count = historyItems?.length ?? 0
    if (count < HISTORY_LIMIT) return
    const compressible = count - HISTORY_KEEP_RECENT
    const confirmed = window.confirm(
      t('历史记录已有 {count} 条。\n\n将把最早的 {old} 条压缩成一份综合摘要，保留最近 {keep} 条原文。\n\n旧记录会被删除且不可恢复，建议先备份 history.jsonl。压缩会调用 AI，可能产生费用并需要一点时间。继续吗？', {
        count,
        old: compressible,
        keep: HISTORY_KEEP_RECENT
      })
    )
    if (!confirmed) return
    setCompressState({
      busy: true,
      done: 0,
      total: compressible,
      message: t('正在准备历史记录…')
    })
    try {
      const result = await window.zhujie.compressHistory()
      if (!result.ok) {
        setCompressState({
          busy: false,
          done: 0,
          total: compressible,
          message: '',
          error: result.error ?? t('压缩失败')
        })
        return
      }
      setCompressState(null)
      await loadHistory()
      await refreshUsage()
      flash(
        t('已压缩 {compressed} 条，保留最近 {kept} 条', {
          compressed: result.compressed,
          kept: result.kept
        })
      )
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

  const defaultModelKey = state
    ? `${state.settings.defaultProviderId}::${state.settings.defaultModel}`
    : ''

  // 面板里切换模型会写回默认设置；这里只跟随默认模型变化，避免覆盖尚未保存的选择。
  useEffect(() => {
    if (!state || !selectedPresetId) return
    const provider = state.providers.find((item) => item.id === state.settings.defaultProviderId)
    const presetId = provider?.presetId ?? provider?.id
    if (!presetId || !presetById(presetId)) return
    if (presetId !== selectedPresetId) {
      selectPreset(presetId, state)
      return
    }
    const next = state.settings.defaultModel
    if (next) setModelDraft((current) => (current === next ? current : next))
  }, [defaultModelKey, selectPreset])

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
    return <div className="boot">{t('正在读取本机配置…')}</div>
  }

  setI18nLocale(state.locale)
  const settings = state.settings
  const runningCount = apps?.filter((app) => app.running).length ?? 0
  const isRowWhitelisted = (key: string): boolean =>
    settings.whitelist.some((item) => normalizeAppName(item) === key)
  const toggleAppRow = (row: AppRow): void => {
    const exists = isRowWhitelisted(row.key)
    const next = exists
      ? settings.whitelist.filter((item) => normalizeAppName(item) !== row.key)
      : [...settings.whitelist, row.processName]
    void patch(
      { whitelist: next },
      exists ? t('已移出：{name}', { name: row.label }) : t('已加入：{name}', { name: row.label })
    )
  }
  const visiblePresets = PROVIDER_PRESETS.filter((preset) => preset.local === settings.localOnly)
  const activePreset = presetById(selectedPresetId)
  const activeProvider =
    state.providers.find((provider) => (provider.presetId ?? provider.id) === selectedPresetId) ?? null
  const activeChoices = Array.from(
    new Set([...(activeProvider?.models ?? []), ...(activePreset?.models ?? [])])
  )
  const activeModelGroups =
    selectedPresetId === 'qwen' ? groupQwenModels(activeChoices) : null
  const activeProviderInfo = state.providers.find(
    (provider) => provider.id === settings.defaultProviderId
  )
  const activePresetInfo = activeProviderInfo
    ? presetById(activeProviderInfo.presetId ?? '')
    : undefined
  const activeLabel = activeProviderInfo
    ? presetDisplayName(
        activePresetInfo?.id ?? activeProviderInfo.presetId ?? activeProviderInfo.id,
        activeProviderInfo.name,
        state.locale
      )
    : t('还没有配置 AI')
  const activeGuide = activePreset ? presetGuide(activePreset, state.locale) : null
  const activePresetName = activePreset ? presetName(activePreset, state.locale) : ''
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
    flash(
      local
        ? t('已切换：只用本机模型，不联网')
        : t('已切换：允许云端 AI，选中的文字会发出去')
    )
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
            result.error ?? t('没有检测到模型。请先启动 Ollama / LM Studio，并下载一个模型。')
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
      setPresetNotice({ ok: false, message: t('请先填入 API Key。') })
      return
    }
    if (!model) {
      if (activePreset.local) {
        await detectLocalModels()
        return
      }
      setPresetNotice({ ok: false, message: t('请选择一个模型。') })
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
          message: t('已启用 {name} · {model}。连接正常，发现 {count} 个模型。', {
            name: activePresetName,
            model: modelDisplayName(activePreset.id, model),
            count: result.models.length
          })
        })
      } else {
        setPresetNotice({
          ok: false,
          message: t('已保存，但连接测试失败：{error}', {
            error: result.error ?? t('未知错误')
          })
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
          <img className="brand-mark" src={appIcon} alt="" />
          <div>
            <strong>{t('注解')}</strong>
            <span>{t('划词 AI 助手')}</span>
          </div>
        </div>
        <div className="titlebar-spacer" />
        <span className={`hook-pill ${state.hookStatus}`}>
          <span className="dot" />
          {state.hookStatus === 'running'
            ? t('取词服务运行中')
            : state.hookStatus === 'error'
              ? t('取词服务异常')
              : t('取词服务未运行')}
        </span>
        <div className="win-actions">
          <button title={t('最小化')} onClick={() => void window.zhujie.minimizeWindow()}>
            ─
          </button>
          <button title={t('隐藏到托盘')} onClick={() => void window.zhujie.hideWindow()}>
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
                <span>{t(item.label)}</span>
              </button>
            ))}
          </nav>
          <div className="side-card">
            <div className="side-card-title">
              <span className={`live-dot ${settings.enabled ? 'on' : ''}`} />
              {settings.enabled ? t('划词注解已开启') : t('划词注解已暂停')}
            </div>
            <p>{t('选中任意文字，旁边会出现「注解」。')}</p>
            <label className="switch-row">
              <span>{t('总开关')}</span>
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
                  <h1>{t('应用范围')}</h1>
                  <p>{t('决定哪些应用里选中文字时会出现「注解」小框。')}</p>
                </div>
              </header>

              {modelOptions.length === 0 && (
                <div className="notice-card">
                  <div>
                    <strong>{t('还没有可用模型')}</strong>
                    <p>{t('先启动 Ollama 或 LM Studio，再点「测试 / 拉取模型」。也可以添加任意 OpenAI 兼容接口。')}</p>
                  </div>
                  <button className="primary" onClick={() => setTab('models')}>
                    {t('去配置')}
                  </button>
                </div>
              )}

              <div className="choice-grid">
                <button
                  className={settings.filterMode === 'all' ? 'choice active' : 'choice'}
                  onClick={() => void patch({ filterMode: 'all' })}
                >
                  <strong>{t('全部应用')}</strong>
                  <span>{t('浏览器、PDF、Office、编辑器里都能用')}</span>
                </button>
                <button
                  className={settings.filterMode === 'whitelist' ? 'choice active' : 'choice'}
                  onClick={() => void patch({ filterMode: 'whitelist' })}
                >
                  <strong>{t('仅指定应用')}</strong>
                  <span>{t('只在下面勾选的应用中出现')}</span>
                </button>
              </div>

              <div className="panel-card">
                <div className="card-head">
                  <h2>{t('应用列表')}</h2>
                  <div className="app-tools">
                    <span className="muted">
                      {apps ? t('{count} 个应用', { count: appRows.length }) : t('扫描中…')}
                      {runningCount > 0
                        ? ` · ${t('{count} 个运行中', { count: runningCount })}`
                        : ''}
                    </span>
                    <button className="link" onClick={() => void loadApps(true)} disabled={appsLoading}>
                      {appsLoading ? t('扫描中…') : t('刷新')}
                    </button>
                  </div>
                </div>

                <div className="app-search">
                  <input
                    value={appQuery}
                    placeholder={t('搜索应用，例如 Chrome、微信、VS Code')}
                    onChange={(event) => setAppQuery(event.target.value)}
                  />
                  {appQuery && (
                    <button className="link" onClick={() => setAppQuery('')}>
                      {t('清除')}
                    </button>
                  )}
                </div>

                {appsError && (
                  <div className="test-error">
                    {t('扫描应用失败：{error}', { error: appsError })}
                    <button className="link" onClick={() => void loadApps(true)}>
                      {t('重试')}
                    </button>
                  </div>
                )}

                {appsLoading && !apps && <p className="hint">{t('正在扫描电脑上的应用…')}</p>}

                {visibleAppRows.length === 0 ? (
                  <div className="empty">
                    {appQuery
                      ? t('没有找到匹配的应用，换个关键词试试。')
                      : t('没有扫描到应用，可以在下面手动输入进程名。')}
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
                              {row.running && <span className="badge-running">{t('运行中')}</span>}
                              {row.count > 0 && (
                                <span className="badge-detected">
                                  {t('用过 {count} 次', { count: row.count })}
                                </span>
                              )}
                            </span>
                            <span className="app-exe">
                              {row.processName}
                              {row.title ? ` · ${row.title}` : ''}
                            </span>
                          </span>
                          <span className="app-meta">
                            {row.lastSeen
                              ? t('上次使用：{time}', { time: relativeTime(row.lastSeen) })
                              : row.installed
                                ? t('已安装')
                                : ''}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="inline-form">
                  <input
                    value={appInput}
                    placeholder={t('手动输入应用名或进程名，例如 chrome 或 WeChat')}
                    onChange={(event) => setAppInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') addApp()
                    }}
                  />
                  <button onClick={addApp} disabled={!appInput.trim()}>
                    {t('添加')}
                  </button>
                </div>
                <p className="hint">
                  {settings.filterMode === 'all'
                    ? t('当前是「全部应用」；切换到「仅指定应用」后，才能勾选下面的应用。')
                    : t('勾选后，只有这些应用里划词才会出现小框。')}
                  {t('勾选保存的是真实进程名（如 msedge.exe）；手动输入按进程名精确匹配，可省略 .exe。')}
                  {t('应用列表会自动扫描电脑上已安装和正在运行的程序；在注解面板和设置窗口内不会触发。')}
                </p>
              </div>

              {state.hookStatus === 'error' && (
                <div className="warn-card">
                  <strong>{t('取词服务启动失败')}</strong>
                  <p>{state.hookError}</p>
                  <p className="muted">
                    {t('可尝试以管理员身份运行，或检查是否有安全软件拦截全局钩子。')}
                  </p>
                  <button className="ghost" disabled={hookBusy} onClick={() => void restartHook()}>
                    {hookBusy ? t('正在重启…') : t('重启取词服务')}
                  </button>
                </div>
              )}
            </section>
          )}

          {tab === 'models' && (
            <section className="section">
              <header className="section-head">
                <div>
                  <h1>{t('用哪家 AI')}</h1>
                  <p>{t('先选本机还是云端，再选服务商、选模型、填 API Key。接口地址不用管。')}</p>
                </div>
              </header>

              <div className="panel-card">
                <div className="card-head">
                  <h2>{t('语言')}</h2>
                  <span className="muted">
                    {state.locale === 'en-US' ? 'Chinese / English' : '中文 / English'}
                  </span>
                </div>
                <label className="field">
                  <span>{t('界面语言')}</span>
                  <select
                    value={settings.language}
                    onChange={(event) =>
                      void patch({
                        language: event.target.value as 'system' | 'zh-CN' | 'en-US'
                      })
                    }
                  >
                    <option value="system">{t('跟随系统')}</option>
                    <option value="zh-CN">{t('中文')}</option>
                    <option value="en-US">English</option>
                  </select>
                </label>
                <label className="field">
                  <span>{t('回答语言')}</span>
                  <select
                    value={settings.answerLanguage}
                    onChange={(event) =>
                      void patch({
                        answerLanguage: event.target.value as 'auto' | 'zh-CN' | 'en-US'
                      })
                    }
                  >
                    <option value="auto">{t('跟随界面')}</option>
                    <option value="zh-CN">{t('中文')}</option>
                    <option value="en-US">English</option>
                  </select>
                </label>
                {state.locale === 'en-US' && <p className="hint">{t('语言说明')}</p>}
              </div>

              <div className="active-card">
                <div className="active-main">
                  <span className="muted">{t('当前使用')}</span>
                  <strong>{activeLabel}</strong>
                  <span className="active-model-name">
                    {settings.defaultModel
                      ? modelDisplayName(
                          activeProviderInfo?.presetId ?? activeProviderInfo?.id,
                          settings.defaultModel
                        )
                      : t('还没有选择模型')}
                    {settings.defaultModel && <MultiplierBadge value={activeMultiplier} />}
                  </span>
                  {modeMismatch && (
                    <span className="active-warn">
                      {activeIsLocal
                        ? t('已切到云端模式，但当前仍用本机模型；选一家云端服务并保存后生效。')
                        : t('已切到本机模式，云端模型会被拦截；请选择一个本机模型。')}
                    </span>
                  )}
                </div>
                <span className={activeIsLocal ? 'pill' : 'pill warn'}>
                  {activeIsLocal ? t('仅本机') : t('云端')}
                </span>
              </div>

              <div className="mode-switch">
                <button
                  className={settings.localOnly ? 'mode active' : 'mode'}
                  onClick={() => void changeMode(true)}
                >
                  <strong>{t('本机模型')}</strong>
                  <span>{t('Ollama / LM Studio · 文字不离开电脑')}</span>
                </button>
                <button
                  className={!settings.localOnly ? 'mode active' : 'mode'}
                  onClick={() => void changeMode(false)}
                >
                  <strong>{t('云端 AI')}</strong>
                  <span>{t('DeepSeek / 通义 / Kimi 等 · 需要 API Key')}</span>
                </button>
              </div>

              <div className="panel-card">
                <div className="card-head">
                  <h2>{t('选择服务商')}</h2>
                  <span className="muted">{settings.localOnly ? t('本机') : t('云端')}</span>
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
                          {presetName(preset, state.locale)}
                          {(preset.free || (preset.freeModels?.length ?? 0) > 0) && (
                            <span className="free-badge">{t('免费')}</span>
                          )}
                        </span>
                        <span className="preset-tagline">{presetTagline(preset, state.locale)}</span>
                        <span className={configured ? 'preset-state ok' : 'preset-state'}>
                          {configured ? t('已配置') : t('未配置')}
                        </span>
                      </button>
                    )
                  })}
                </div>
                <p className="hint">
                  {t('标有「免费」的服务商或模型由服务商提供免费额度，具体额度和有效期以服务商页面为准。')}
                </p>
              </div>

              {activePreset && activeProvider && (
                <div className="panel-card setup-card">
                  <div className="card-head">
                    <h2>{activePresetName} {t('设置')}</h2>
                    <span className="muted">
                      {activePreset.local ? t('不用填 Key') : t('需要 API Key')}
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
                            ? t('已保存，留空表示不修改')
                            : activePreset.keyHint ?? t('粘贴 API Key')
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
                          {t('没有 Key？去 {name} 获取', { name: activePresetName })}
                        </a>
                      )}
                    </label>
                  )}

                  <label className="field">
                    <span>{t('模型')}</span>
                    {activeChoices.length > 0 ? (
                      <select
                        value={modelDraft}
                        onChange={(event) => setModelDraft(event.target.value)}
                      >
                        {modelDraft && !activeChoices.includes(modelDraft) && (
                          <option value={modelDraft}>{modelDraft}{t('（当前）')}</option>
                        )}
                        {!modelDraft && <option value="">{t('请选择模型')}</option>}
                        {(() => {
                          const renderOption = (model: string): JSX.Element => (
                            <option key={model} value={model}>
                              {modelDisplayName(selectedPresetId, model)}
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
                          )
                          if (!activeModelGroups) return activeChoices.map(renderOption)
                          return activeModelGroups.map((entry) =>
                            entry.models.length > 0 ? (
                              <optgroup key={entry.group} label={t(MODEL_GROUP_LABELS[entry.group])}>
                                {entry.models.map(renderOption)}
                              </optgroup>
                            ) : null
                          )
                        })()}
                      </select>
                    ) : (
                      <div className="model-empty">
                        {activePreset.local
                          ? t('还没检测到本机模型。点下面的按钮，会读取你已经下载的模型。')
                          : t('这个服务商没有预置模型，请手动填写模型名。')}
                      </div>
                    )}
                  </label>
                  <p className="hint">
                    {t('模型旁的倍率以 deepseek-flash 为 1.00×，精确到 0.01×；按每百万 tokens 输入+输出价格估算，数字越小越省，仅用于横向比较，实际费用以用量页为准。')}
                  </p>
                  {selectedPresetId === 'qwen' && (
                    <p className="hint">
                      {t('百炼返回的图片、语音、向量等不能用于文字对话的模型已自动过滤，列表只保留文字对话模型。')}
                    </p>
                  )}
                  <p className="hint">
                    {t('免费或轻量模型响应快，适合简单注解；复杂提问和连续追问建议选能力更强的模型。')}
                  </p>

                  {!activePreset.local && (
                    <details className="mini-advanced">
                      <summary>{t('列表里没有我要的模型？手动填写')}</summary>
                      <input
                        value={modelDraft}
                        placeholder={t('直接输入模型名，例如 deepseek-flash')}
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
                        ? t('处理中…')
                        : activePreset.local
                          ? modelDraft
                            ? t('保存并使用')
                            : t('检测本机模型并启用')
                          : t('保存并测试')}
                    </button>
                    {activePreset.local && (
                      <button
                        className="ghost"
                        disabled={presetBusy}
                        onClick={() => void detectLocalModels()}
                      >
                        {t('重新检测模型')}
                      </button>
                    )}
                    <span className="muted">
                      {activePreset.local
                        ? t('只访问本机端口，文字不离开电脑。')
                        : t('选中的文字会发送给 {name}，请勿用于敏感内容。', {
                            name: activePresetName
                          })}
                    </span>
                  </div>

                  {presetNotice && (
                    <p className={presetNotice.ok ? 'test-ok' : 'test-error'}>
                      {presetNotice.message}
                    </p>
                  )}

                  <details className="mini-advanced provider-guide">
                    <summary>
                      {t('怎么配置 {name}', { name: activePresetName })}
                      {activePreset.local ? '' : t('、怎么购买 tokens')}
                    </summary>
                    <ol className="guide-steps">
                      {(activeGuide?.steps ?? []).map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ol>
                    <div className="guide-links">
                      {activePreset.keyUrl && (
                        <a href={activePreset.keyUrl} target="_blank" rel="noreferrer">
                          {t('获取 API Key')}
                        </a>
                      )}
                      {activeGuide?.billingUrl && (
                        <a
                          href={activeGuide.billingUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {activeGuide.billingLabel ?? t('充值 / 购买 tokens')}
                        </a>
                      )}
                    </div>
                    {activeGuide?.note && (
                      <p className="hint">{activeGuide.note}</p>
                    )}
                  </details>
                </div>
              )}

              <details className="advanced-block">
                <summary>{t('高级：手动填写接口地址（一般不用）')}</summary>
                <p className="hint">
                  {t('只有在使用公司内网、自建代理，或上面的服务商里没有你要的接口时，才需要改这里。')}
                </p>

                <details className="mini-advanced provider-guide">
                  <summary>{t('怎么配置自定义接口、怎么购买 tokens')}</summary>
                  <ol className="guide-steps">
                    <li>{t('向服务商获取三样东西：Base URL、API Key、模型名。')}</li>
                    <li>
                      {t('Base URL 一般以')} <code>/v1</code> {t('结尾；不确定时看服务商文档。')}
                    </li>
                    <li>{t('在服务商控制台充值或购买 tokens 后，把 Key 和模型名填到上面的表单。')}</li>
                    <li>{t('保存后点「测试」，能拉到模型列表就说明配置成功。')}</li>
                  </ol>
                  <p className="hint">
                    {t('如果是中转或聚合服务，确认它兼容 OpenAI 协议；不要购买来源不明的低价 Key。')}
                  </p>
                </details>

                {editor && (
                  <div className="panel-card editor">
                    <div className="card-head">
                      <h2>{editor.id ? t('编辑服务') : t('添加服务')}</h2>
                      <button className="link" onClick={() => setEditor(null)}>
                        {t('取消')}
                      </button>
                    </div>
                    <div className="form-grid">
                      <label>
                        <span>{t('名称')}</span>
                        <input
                          value={editor.name}
                          placeholder={t('例如 公司内网模型')}
                          onChange={(event) => setEditor({ ...editor, name: event.target.value })}
                        />
                      </label>
                      <label>
                        <span>{t('协议')}</span>
                        <select
                          value={editor.kind}
                          onChange={(event) =>
                            setEditor({ ...editor, kind: event.target.value as ProviderKind })
                          }
                        >
                          <option value="openai">{t('OpenAI 兼容')}</option>
                          <option value="ollama">{t('Ollama 原生')}</option>
                        </select>
                      </label>
                      <label className="full">
                        <span>Base URL</span>
                        <input
                          value={editor.baseUrl}
                          placeholder="http://127.0.0.1:11434 or http://127.0.0.1:1234/v1"
                          onChange={(event) => setEditor({ ...editor, baseUrl: event.target.value })}
                        />
                      </label>
                      <label className="full">
                        <span>{t('API Key（可选，保存在本机密钥存储）')}</span>
                        <input
                          type="password"
                          value={editor.apiKey}
                          placeholder={t('留空表示不修改已保存的密钥')}
                          onChange={(event) => setEditor({ ...editor, apiKey: event.target.value })}
                        />
                      </label>
                      <label>
                        <span>{t('输入价格（元 / 百万 tokens）')}</span>
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
                        <span>{t('输出价格（元 / 百万 tokens）')}</span>
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
                    <p className="hint">{t('费用按这里的价格估算；内置服务商已带默认价目，本机模型为 0。')}</p>
                    <div className="form-actions">
                      <button
                        className="primary"
                        disabled={savingProvider}
                        onClick={() => void saveProvider()}
                      >
                        {savingProvider ? t('保存中…') : t('保存')}
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
                            flash(t('已清除密钥'))
                          }}
                        >
                          {t('清除密钥')}
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
                          if (!window.confirm(t('删除「{name}」？', { name: provider.name }))) return
                          try {
                            setState(await window.zhujie.removeProvider(provider.id))
                            flash(t('已删除'))
                          } catch (error) {
                            flash(readableError(error))
                          }
                        }}
                        onUseModel={(model) => {
                          void patch(
                            { defaultProviderId: provider.id, defaultModel: model },
                            t('默认模型：{model}', { model })
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
                  {t('添加自定义服务')}
                </button>
              </details>
            </section>
          )}

          {tab === 'prompt' && (
            <section className="section">
              <header className="section-head">
                <div>
                  <h1>{t('注解提示词')}</h1>
                  <p>{t('作为系统提示词发送给模型；选中的文字会作为用户消息附在后面。')}</p>
                </div>
              </header>

              <div className="notice-card">
                <div>
                  <strong>{t('回答顺序（应用强制执行）')}</strong>
                  <p>{t('回答顺序由应用按「词 / 问题 / 段落」自动决定，旧提示词不会改变这个顺序；点「恢复默认」可换成简洁模板，模板只保留你的风格偏好。')}</p>
                </div>
                <button
                  className="ghost"
                  onClick={() => {
                    setPromptDraft(state.locale === 'en-US' ? DEFAULT_PROMPT_EN : DEFAULT_PROMPT)
                    setPromptDirty(true)
                  }}
                >
                  {t('套用模板')}
                </button>
              </div>

              <div className="panel-card">
                <div className="card-head">
                  <h2>{t('系统提示词')}</h2>
                  <span className="muted">{t('{count} 字', { count: promptDraft.length })}</span>
                </div>
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
                  <span className="muted">
                    {t('建议保留“Markdown / 300 字以内”之类的约束，面板显示更稳定。')}
                  </span>
                  <div className="head-actions">
                    <button
                      className="ghost"
                      onClick={() => {
                        setPromptDraft(state.locale === 'en-US' ? DEFAULT_PROMPT_EN : DEFAULT_PROMPT)
                        setPromptDirty(true)
                      }}
                    >
                      {t('恢复默认')}
                    </button>
                    <button
                      className="primary"
                      disabled={!promptDirty}
                      onClick={() => void savePrompt()}
                    >
                      {t('保存')}
                    </button>
                  </div>
                </div>
              </div>

              <div className="panel-card">
                <div className="card-head">
                  <h2>{t('结合上下文')}</h2>
                  <input
                    type="checkbox"
                    className="switch"
                    checked={settings.useContext}
                    onChange={(event) => void patch({ useContext: event.target.checked })}
                  />
                </div>
                <p className="muted">
                  {t('开启后，点「注解 / 提问」时会读取选中位置前后各 {count} 字，把【选中】部分标出来后一起发给模型。只读取当前应用的无障碍文本，不截屏；取不到时自动只发选中文字。', {
                    count: settings.contextChars
                  })}
                </p>
                <div className="context-length">
                  <span>{t('前后各')}</span>
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
                  <span>{t('字')}</span>
                  <span className="muted">
                    {t('会多发送约 2 倍上下文，费用通常为原来的 1.5–2 倍。')}
                  </span>
                </div>
              </div>

              <div className="panel-card">
                <div className="card-head">
                  <h2>{t('单次发送上限')}</h2>
                  <span className="muted">
                    {t('当前 {count} 字', { count: settings.maxChars })}
                  </span>
                </div>
                <p className="muted">
                  {t('选中文字超过上限时只发送前面的部分，注解面板会明确提示「已截断」，不会让你误以为整段都发送了。')}
                </p>
                <div className="context-length">
                  <span>{t('最多')}</span>
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
                  <span>{t('字')}</span>
                </div>
              </div>

            </section>
          )}

          {tab === 'history' && (
            <section className="section">
              <header className="section-head">
                <div>
                  <h1>{t('历史记录')}</h1>
                  <p>
                    {t('注解和提问都会保存在本机，最多保留 {count} 条；满了可以压缩成综合摘要。', {
                      count: HISTORY_LIMIT
                    })}
                  </p>
                </div>
                <button
                  className="ghost danger"
                  disabled={!historyItems?.length}
                  onClick={() => void clearHistory()}
                >
                  {t('清空记录')}
                </button>
              </header>

              {historyItems && historyItems.length >= HISTORY_LIMIT && (
                <div className="notice-card">
                  <div>
                    <strong>
                      {t('历史已满 {count} 条', { count: HISTORY_LIMIT })}
                    </strong>
                    <p>
                      {t('可以把最早的 {old} 条压缩成一份综合摘要，保留最近 {keep} 条。压缩会调用当前模型，可能需要一点时间并产生费用。', {
                        old: HISTORY_LIMIT - HISTORY_KEEP_RECENT,
                        keep: HISTORY_KEEP_RECENT
                      })}
                    </p>
                  </div>
                  <button
                    className="primary"
                    disabled={compressState?.busy}
                    onClick={() => void compressHistory()}
                  >
                    {compressState?.busy ? t('压缩中…') : t('压缩旧记录')}
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
                    <strong>{t('综合摘要')}</strong>
                    <span className="muted">{t('旧记录压缩后会保留在这里')}</span>
                  </div>
                  {summaries.map((summary) => (
                    <SummaryCard key={summary.id} summary={summary} />
                  ))}
                </div>
              )}

              <div className="history-toolbar">
                <input
                  value={historyQuery}
                  placeholder={t('搜索选中的文字、问题、回答或应用')}
                  onChange={(event) => setHistoryQuery(event.target.value)}
                />
                <span className="muted">
                  {t('共 {count} 条', { count: historyItems?.length ?? 0 })}
                </span>
                <label
                  className="history-toggle"
                  title={t('关闭后新的注解/提问不再写入历史，已有记录保留')}
                >
                  <input
                    type="checkbox"
                    checked={settings.historyEnabled}
                    onChange={(event) => void patch({ historyEnabled: event.target.checked })}
                  />
                  {t('记录新历史')}
                </label>
              </div>

              {!historyItems || historyItems.length === 0 ? (
                <div className="panel-card empty tall">
                  {t('还没有历史记录。选中文字做一次注解或提问后，这里会出现记录。')}
                </div>
              ) : filteredThreads.length === 0 ? (
                <div className="panel-card empty tall">
                  {t('没有匹配的记录，换个关键词试试。')}
                </div>
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
                            {thread.latest.mode === 'ask' ? t('提问') : t('注解')}
                          </span>
                          <span className="muted">{fmtTime(thread.latest.ts)}</span>
                        </div>
                        <div className="history-snippet">
                          {thread.latest.question || thread.latest.text}
                        </div>
                        <div className="history-meta">
                          {thread.latest.programName} · {thread.latest.model}
                          {thread.items.length > 1
                            ? ` · ${t('{count} 轮问答', { count: thread.items.length })}`
                            : ''}
                        </div>
                      </button>
                    ))}
                  </div>

                  {selectedThread && (
                    <div className="history-detail">
                      <div className="history-detail-head">
                        <div>
                          <strong>
                            {t('连续对话 · {count} 轮', { count: selectedThread.items.length })}
                          </strong>
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
                            {t('复制完整对话')}
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
                                {record.mode === 'ask' ? t('追问') : t('注解')}
                              </span>
                              <span className="muted">{fmtTime(record.ts)}</span>
                              <span className="foot-spacer" />
                              <div className="history-actions">
                                <button
                                  className="link"
                                  onClick={() => void toggleHistoryFavorite(record)}
                                >
                                  {favorited ? t('已收藏') : t('收藏')}
                                </button>
                                <button
                                  className="link danger"
                                  onClick={() => void removeHistory(record.id)}
                                >
                                  {t('删除')}
                                </button>
                              </div>
                            </div>
                            {record.mode === 'annotate' && (
                              <div className="history-quote">{record.text}</div>
                            )}
                            {record.mode === 'ask' && (
                              <div className="asked-question">
                                <span>{t('你的问题')}</span>
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
                                ? ` · ${t('结合上下文 {count} 字', { count: record.contextChars })}`
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
                  <h1>{t('收藏')}</h1>
                  <p>{t('在注解面板点右上角星星，收藏当前的问答；只保存在本机。')}</p>
                </div>
                <button
                  className="ghost danger"
                  disabled={!favorites?.length}
                  onClick={() => void clearFavorites()}
                >
                  {t('清空收藏')}
                </button>
              </header>

              {!favorites || favorites.length === 0 ? (
                <div className="panel-card empty tall">
                  {t('还没有收藏。打开一条注解或提问，点右上角的星星即可收藏当前问答。')}
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
                  <h1>{t('用量统计')}</h1>
                  <p>{t('记录每次注解/提问的模型、token、费用与耗时，数据只写在本机。')}</p>
                </div>
                <div className="head-actions">
                  <button
                    className="ghost"
                    onClick={() => void refreshUsage().then(() => flash(t('用量已刷新')))}
                  >
                    {t('刷新')}
                  </button>
                  <button className="ghost danger" onClick={() => void clearUsage()}>
                    {t('清空记录')}
                  </button>
                </div>
              </header>

              {!usage || usage.total.requests === 0 ? (
                <div className="panel-card empty tall">
                  {t('还没有用量。选中一段文字、点开「注解」后，这里会按模型和应用记录 token。')}
                </div>
              ) : (
                <>
                  <div className="stat-grid">
                    <div className="stat">
                      <span>{t('今日 tokens')}</span>
                      <strong>{fmtNum(usage.today.tokens)}</strong>
                      <small>
                        {t('{count} 次', { count: usage.today.requests })} ·{' '}
                        {formatCny(usage.today.cost)}
                      </small>
                    </div>
                    <div className="stat">
                      <span>{t('累计 tokens')}</span>
                      <strong>{fmtNum(usage.total.tokens)}</strong>
                      <small>
                        {t('{count} 次', { count: usage.total.requests })} ·{' '}
                        {formatCny(usage.total.cost)}
                      </small>
                    </div>
                    <div className="stat">
                      <span>{t('累计花费')}</span>
                      <strong>{formatCny(usage.total.cost)}</strong>
                      <small>{t('人民币估算')}</small>
                    </div>
                    <div className="stat">
                      <span>{t('平均耗时')}</span>
                      <strong>{(usage.avgLatencyMs / 1000).toFixed(1)}s</strong>
                      <small>{t('仅统计成功请求')}</small>
                    </div>
                    <div className="stat">
                      <span>{t('使用模型')}</span>
                      <strong>{usage.byModel.length}</strong>
                      <small>{t('覆盖 {count} 个应用', { count: usage.byApp.length })}</small>
                    </div>
                  </div>

                  <div className="panel-card">
                    <div className="card-head">
                      <h2>{t('近 14 天')}</h2>
                      <span className="muted">{t('tokens / 天')}</span>
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
                        <h2>{t('按模型')}</h2>
                      </div>
                      <table className="data-table numeric-3">
                        <thead>
                          <tr>
                            <th>{t('模型')}</th>
                            <th>{t('次数')}</th>
                            <th>tokens</th>
                            <th>{t('花费')}</th>
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
                        <h2>{t('按应用')}</h2>
                      </div>
                      <table className="data-table numeric-3">
                        <thead>
                          <tr>
                            <th>{t('应用')}</th>
                            <th>{t('次数')}</th>
                            <th>tokens</th>
                            <th>{t('花费')}</th>
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
                      <h2>{t('最近记录')}</h2>
                      <span className="muted">{t('最多显示 50 条')}</span>
                    </div>
                    <table className="data-table recent-table">
                      <thead>
                        <tr>
                          <th>{t('时间')}</th>
                          <th>{t('应用')}</th>
                          <th>{t('模型')}</th>
                          <th>tokens</th>
                          <th>{t('花费')}</th>
                          <th>{t('耗时')}</th>
                          <th>{t('状态')}</th>
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
                                {record.ok ? t('成功') : t('失败')}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="hint">
                      {t('费用按内置价目估算（人民币），本机模型为 0；自定义接口可在「高级」里填写输入/输出价格。')}
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
                  <h1>{t('关于')}</h1>
                  <p>{t('划词注解 · 本地优先的阅读辅助工具。')}</p>
                </div>
              </header>

              <div className="panel-card about-grid">
                <div>
                  <span className="muted">{t('版本')}</span>
                  <strong>{state.version}</strong>
                </div>
                <div>
                  <span className="muted">{t('制作')}</span>
                  <strong>piona</strong>
                </div>
                <div>
                  <span className="muted">{t('平台')}</span>
                  <strong>{state.platform}</strong>
                </div>
                <div>
                  <span className="muted">{t('取词服务')}</span>
                  <div className="copy-line">
                    <strong>
                      {state.hookStatus === 'running' ? t('运行中') : state.hookStatus}
                    </strong>
                    <button className="link" disabled={hookBusy} onClick={() => void restartHook()}>
                      {hookBusy ? t('重启中…') : t('重启')}
                    </button>
                  </div>
                </div>
                <div>
                  <span className="muted">{t('数据目录')}</span>
                  <div className="copy-line">
                    <code title={state.dataDir}>{state.dataDir}</code>
                    <button
                      className="link"
                      onClick={() => {
                        void window.zhujie.writeClipboard(state.dataDir)
                        flash(t('路径已复制'))
                      }}
                    >
                      {t('复制')}
                    </button>
                  </div>
                </div>
              </div>

              <div className="panel-card update-card">
                <div className="card-head">
                  <h2>{t('版本更新')}</h2>
                  <span className="muted">{t('当前 v{version}', { version: state.version })}</span>
                </div>
                <p className="muted">
                  {state.update.phase === 'idle' &&
                    t('应用会在启动后自动检查 GitHub Releases。')}
                  {state.update.phase === 'checking' && t('正在检查更新…')}
                  {state.update.phase === 'latest' &&
                    (state.update.latestVersion === state.version
                      ? t('已是最新版本 v{version}', { version: state.version })
                      : t('线上最新 v{latest}；当前本地 v{current}（本地构建较新）', {
                          latest: state.update.latestVersion ?? '',
                          current: state.version
                        }))}
                  {state.update.phase === 'available' &&
                    t('发现新版本 v{version}。{action}', {
                      version: state.update.latestVersion ?? '',
                      action: settings.autoDownloadUpdates
                        ? t('正在自动下载…')
                        : t('点击「下载更新」后再下载。')
                    })}
                  {state.update.phase === 'downloading' &&
                    t('正在下载 v{version}（{percent}%）。', {
                      version: state.update.latestVersion ?? '',
                      percent: updateProgress?.progress ?? state.update.progress ?? 0
                    })}
                  {state.update.phase === 'ready' &&
                    t('v{version} 已下载并通过 SHA-256 校验；重启后替换程序文件，配置和历史会保留。', {
                      version: state.update.latestVersion ?? ''
                    })}
                  {state.update.phase === 'error' &&
                    (state.update.latestVersion ? t('更新未完成。') : t('检查更新失败。'))}
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
                    {state.update.phase === 'checking' ? t('检查中…') : t('检查更新')}
                  </button>
                  {state.update.phase === 'available' && (
                    <button className="primary" onClick={() => void downloadUpdate()}>
                      {t('下载更新')}
                    </button>
                  )}
                  {state.update.phase === 'error' && state.update.latestVersion && (
                    <button className="primary" onClick={() => void downloadUpdate()}>
                      {t('重试下载')}
                    </button>
                  )}
                  {state.update.phase === 'ready' && (
                    <button
                      className="primary"
                      onClick={async () => {
                        const result = await window.zhujie.installUpdate()
                        if (!result.ok) flash(result.error ?? t('更新失败'))
                      }}
                    >
                      {t('重启并更新')}
                    </button>
                  )}
                  <button className="link" onClick={() => void window.zhujie.openReleasePage()}>
                    {t('打开发布页')}
                  </button>
                </div>
                <label className="switch-row update-auto">
                  <span>{t('启动时检查更新')}</span>
                  <input
                    type="checkbox"
                    className="switch"
                    checked={settings.checkUpdatesOnStartup}
                    onChange={(event) =>
                      void patch({ checkUpdatesOnStartup: event.target.checked })
                    }
                  />
                </label>
                <label className="switch-row update-auto">
                  <span>{t('发现新版本后自动下载')}</span>
                  <input
                    type="checkbox"
                    className="switch"
                    checked={settings.autoDownloadUpdates}
                    onChange={(event) => void patch({ autoDownloadUpdates: event.target.checked })}
                  />
                </label>
                <p className="hint">
                  {t('关闭时只弹出提示，点「下载更新」后才下载；无论开关如何，都需要你点「重启并更新」才会替换程序。')}
                </p>
                <p className="hint">
                  {t('安装包未做代码签名；SHA-256 主要防传输损坏，不能完全防止发布账号被入侵。只从本仓库 Releases 更新，介意供应链风险可关闭自动下载。')}
                </p>
              </div>

              <div className="panel-card">
                <div className="card-head">
                  <h2>{t('启动')}</h2>
                  <input
                    type="checkbox"
                    className="switch"
                    checked={settings.launchAtLogin}
                    onChange={(event) => void patch({ launchAtLogin: event.target.checked })}
                  />
                </div>
                <p className="muted">{t('开机后自动在托盘运行，不弹窗；需要时点托盘图标打开设置。')}</p>
              </div>

              <div className="panel-card">
                <div className="card-head">
                  <h2>{t('隐私')}</h2>
                </div>
                <p className="prose">
                  {t('配置、用量记录、历史对话和综合摘要都只保存在本机数据目录。历史和摘要是明文文件，未做额外加密。默认开启「仅本机」，请求只会发往 localhost。关闭后才会使用你自行配置的云端接口；本应用没有内置遥测、账号或云同步。')}
                </p>
              </div>

              <div className="panel-card">
                <div className="card-head">
                  <h2>{t('参考项目与许可')}</h2>
                  <span className="muted">{t('MIT · 制作 piona')}</span>
                </div>
                <ul className="ref-list">
                  <li>
                    <a href="https://github.com/0xfullex/selection-hook" target="_blank" rel="noreferrer">
                      selection-hook
                    </a>
                    <span className="license">MIT</span>
                    <span>{t('全局划词取词与鼠标/键盘钩子，返回文本、坐标与应用名。')}</span>
                  </li>
                  <li>
                    <a href="https://github.com/zcx960/AIA-selection-assistan" target="_blank" rel="noreferrer">
                      AIA-selection-assistan
                    </a>
                    <span className="license">MIT</span>
                    <span>{t('Electron 划词助手的交互与窗口定位思路参考。')}</span>
                  </li>
                  <li>
                    <a href="https://github.com/CherryHQ/cherry-studio" target="_blank" rel="noreferrer">
                      Cherry Studio
                    </a>
                    <span className="license warn">AGPL-3.0</span>
                    <span>{t('划词助手产品形态调研；未复用其代码。')}</span>
                  </li>
                  <li>
                    <a href="https://github.com/pot-app/pot-desktop" target="_blank" rel="noreferrer">
                      pot-desktop
                    </a>
                    <span className="license warn">GPL-3.0</span>
                    <span>{t('划词翻译交互调研；仓库已归档，未复用其代码。')}</span>
                  </li>
                  <li>
                    <a href="https://github.com/nextai-translator/nextai-translator" target="_blank" rel="noreferrer">
                      nextai-translator
                    </a>
                    <span className="license warn">AGPL-3.0</span>
                    <span>{t('桌面划词产品调研；未复用其代码。')}</span>
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
            {favorite.mode === 'ask' ? t('提问') : t('注解')}
          </span>
          <span className="muted">
            {fmtTime(favorite.ts)} · {favorite.programName} · {favorite.model}
          </span>
        </div>
        <div className="favorite-actions">
          <button className="link" onClick={() => void copy()}>
            {copied ? t('已复制') : t('复制回答')}
          </button>
          <button className="link danger" onClick={onDelete}>
            {t('删除')}
          </button>
        </div>
      </div>
      <div className="favorite-question">
        <span>{favorite.question ? t('你的问题') : t('选中的文字')}</span>
        <p>{favorite.question || favorite.text}</p>
      </div>
      <div className="favorite-answer markdown" dangerouslySetInnerHTML={{ __html: html }} />
      <div className="favorite-foot">
        {favorite.totalTokens.toLocaleString()} tokens · {formatCny(favorite.cost)}
        {favorite.contextChars
          ? ` · ${t('结合上下文 {count} 字', { count: favorite.contextChars })}`
          : ''}
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
        <span className="history-mode summary">{t('综合')}</span>
        <span className="summary-title">{t('{count} 条记录', { count: summary.sourceCount })}</span>
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
          {copied ? t('已复制') : t('复制摘要')}
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
            {isDefault && <span className="pill accent">{t('默认')}</span>}
            <span className={local ? 'pill' : 'pill warn'}>
              {local ? t('本机') : t('外部')}
            </span>
            {hasFree && <span className="free-badge">{t('免费')}</span>}
          </h3>
          <code className="provider-url">{provider.baseUrl}</code>
        </div>
        <div className="provider-actions">
          <button className="ghost" onClick={onTest} disabled={test?.loading}>
            {test?.loading ? t('测试中…') : t('测试 / 拉取模型')}
          </button>
          <button className="ghost" onClick={onEdit}>
            {t('编辑')}
          </button>
          {!provider.builtin && (
            <button className="ghost danger" onClick={onRemove}>
              {t('删除')}
            </button>
          )}
        </div>
      </div>

      <div className="model-chips">
        {provider.models.length === 0 ? (
          <span className="muted">{t('尚未获取模型列表')}</span>
        ) : (
          provider.models.map((model) => (
            <button
              key={model}
              className={model === currentModel ? 'chip-model active' : 'chip-model'}
              onClick={() => onUseModel(model)}
              title={t('设为默认模型')}
            >
              {modelDisplayName(provider.presetId ?? provider.id, model)}
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
      {test?.ok && (
        <p className="test-ok">{t('连接正常，发现 {count} 个模型。', { count: test.models ?? 0 })}</p>
      )}
      {provider.hasKey && <span className="key-flag">{t('已保存 API Key')}</span>}
    </div>
  )
}
