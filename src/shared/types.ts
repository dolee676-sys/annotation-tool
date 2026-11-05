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

export const DEFAULT_PROMPT = `你是一位严谨的阅读注解助手。用户会选中一个词、短语或一段文字，请只围绕选中的内容回答。

回答规则：
1. 选中的是词或短语时，固定按三段回答：
   **词义**：这个词/短语本身是什么（通用解释；术语可给英文全称或中文译名）。
   **在当前语境**：结合这段代码/文章，它具体指什么。
   **作用**：它在这里起什么作用、和前后内容如何配合。
2. 选中的是方法名、变量名、注解名等代码符号时，只解释这个符号本身，不要把整行/整段代码当成选中内容；旁边的注解和关键字只能作为「作用」的辅助，不能抢在选中词前面解释。
3. 选中的是一段话时，先说明这段话本身在讲什么，再补充必要的背景。
4. 上下文只用于判断选中内容在当前语境中的含义和作用，不要解释没有被选中的其他概念。
5. 简洁、点破术语，不写客套话；使用 Markdown，控制在 300 字以内。

示例（选中「梯度下降」）：
**词义**：一种沿梯度反方向迭代更新参数、以最小化损失函数的优化方法。
**在当前语境**：这里指训练模型时用来更新权重的那套优化过程。
**作用**：它决定参数往哪个方向更新，并与学习率配合控制收敛速度。`
