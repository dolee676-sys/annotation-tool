export type ProviderKind = 'ollama' | 'openai'

export interface ProviderView {
  id: string
  name: string
  kind: ProviderKind
  baseUrl: string
  models: string[]
  hasKey: boolean
  builtin: boolean
  presetId?: string
  priceIn: number
  priceOut: number
}

export interface DetectedApp {
  name: string
  lastSeen: number
  count: number
}

export interface AppEntry {
  processName: string
  name: string
  path?: string
  title?: string
  running: boolean
  installed: boolean
}

export interface SettingsView {
  enabled: boolean
  localOnly: boolean
  filterMode: 'all' | 'whitelist'
  whitelist: string[]
  detectedApps: DetectedApp[]
  prompt: string
  defaultProviderId: string
  defaultModel: string
  maxChars: number
  launchAtLogin: boolean
  useContext: boolean
  contextChars: number
  historyEnabled: boolean
  autoDownloadUpdates: boolean
}

export interface AppState {
  settings: SettingsView
  providers: ProviderView[]
  hookStatus: 'starting' | 'running' | 'stopped' | 'error'
  hookError?: string
  version: string
  platform: string
  dataDir: string
  update: UpdateStatus
}

export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'latest'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'error'

export interface UpdateStatus {
  phase: UpdatePhase
  currentVersion: string
  latestVersion?: string
  progress?: number
  message?: string
  releaseUrl?: string
}

export interface UpdateProgress {
  progress: number
  message: string
}

export interface UsageRecord {
  id: string
  ts: number
  programName: string
  providerId: string
  providerName: string
  model: string
  chars: number
  contextChars?: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  estimated: boolean
  cost?: number
  latencyMs: number
  ok: boolean
  error?: string
}

export interface UsageBucket {
  key: string
  requests: number
  tokens: number
  cost: number
}

export interface UsageDay {
  date: string
  requests: number
  tokens: number
  cost: number
}

export interface UsageSummary {
  today: { requests: number; tokens: number; cost: number }
  total: { requests: number; tokens: number; cost: number }
  avgLatencyMs: number
  byModel: UsageBucket[]
  byApp: UsageBucket[]
  byDay: UsageDay[]
  recent: UsageRecord[]
}

export interface PanelModelOption {
  providerId: string
  providerName: string
  model: string
  free?: boolean
  multiplier?: number | null
}

export const HISTORY_LIMIT = 1000
export const HISTORY_KEEP_RECENT = 200

export type PanelMode = 'annotate' | 'ask'

export interface PanelInit {
  mode: PanelMode
  text: string
  programName: string
  providerId: string
  providerName: string
  model: string
  options: PanelModelOption[]
  localOnly: boolean
  contextChars: number
  contextEnabled: boolean
  contextPending: boolean
  truncated: boolean
  maxChars: number
}

export interface PanelContext {
  contextChars: number
  contextEnabled: boolean
  contextPending: boolean
}

export interface PanelDone {
  usage: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
    estimated: boolean
  }
  cost: number
  latencyMs: number
}

export interface HistoryRecord {
  id: string
  ts: number
  mode: PanelMode
  programName: string
  providerName: string
  model: string
  text: string
  question?: string
  answer: string
  contextChars?: number
  totalTokens: number
  cost: number
  ok: boolean
}

export interface HistorySummary {
  id: string
  ts: number
  providerName: string
  model: string
  sourceCount: number
  fromTs: number
  toTs: number
  summary: string
  totalTokens: number
  cost: number
}

export interface FavoriteRecord {
  id: string
  turnId: string
  ts: number
  mode: PanelMode
  programName: string
  providerName: string
  model: string
  text: string
  question?: string
  answer: string
  contextChars?: number
  totalTokens: number
  cost: number
}

export interface FavoriteToggleResult {
  ok: boolean
  favorited: boolean
  id?: string
  error?: string
}

export interface HistoryCompressResult {
  ok: boolean
  error?: string
  compressed: number
  kept: number
  summary?: HistorySummary
}

export interface HistoryCompressProgress {
  done: number
  total: number
  message: string
}

export interface PanelError {
  message: string
}

export interface SettingsPatch {
  enabled?: boolean
  localOnly?: boolean
  filterMode?: 'all' | 'whitelist'
  whitelist?: string[]
  prompt?: string
  defaultProviderId?: string
  defaultModel?: string
  maxChars?: number
  launchAtLogin?: boolean
  useContext?: boolean
  contextChars?: number
  historyEnabled?: boolean
  autoDownloadUpdates?: boolean
}

export interface ProviderPatch {
  id?: string
  name: string
  kind: ProviderKind
  baseUrl: string
  apiKey?: string | null
  model?: string
  priceIn?: number
  priceOut?: number
}

export interface TestProviderResult {
  ok: boolean
  models: string[]
  error?: string
}

export const DEFAULT_PROMPT = `你是一位严谨的阅读注解助手。用户会选中一段文字，请给出简明、有信息量的中文注解。

要求：
1. 先用一句话说明这段话到底在讲什么；
2. 解释理解它所需的背景或概念；
3. 专业术语要点破，不要绕圈子；
4. 指出容易误解或值得注意的地方；
5. 不要复述原文，不要写客套话。

使用 Markdown，控制在 300 字以内。如果选中的只是短语或单个术语，就按词典式注解处理。`
