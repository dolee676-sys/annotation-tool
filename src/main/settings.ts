import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_PROMPT,
  type DetectedApp,
  type ProviderKind,
  type ProviderPatch,
  type ProviderView,
  type SettingsPatch,
  type SettingsView
} from '../shared/types.ts'
import { PROVIDER_PRESETS } from '../shared/presets.ts'
import { isChatModel, sortModelsForProvider } from '../shared/modelCatalog.ts'
import type { AnswerLanguageSetting, LanguageSetting } from '../shared/i18n.ts'

export interface StoredProvider {
  id: string
  name: string
  kind: ProviderKind
  baseUrl: string
  keyEnc?: string
  models: string[]
  builtin: boolean
  presetId?: string
  priceIn: number
  priceOut: number
}

export interface StoredSettings {
  language: LanguageSetting
  answerLanguage: AnswerLanguageSetting
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
  checkUpdatesOnStartup: boolean
  promptStandardVersion: number
  providers: StoredProvider[]
}

const PROMPT_STANDARD_SUFFIX = `【回答顺序（必须遵守）】
1. **词义**：先说明选中的词/短语本身是什么（通用解释；术语可给英文全称或中文译名）。
2. **在当前语境**：结合这段代码/文章，说明它具体指什么。
3. **作用**：说明它在这里起什么作用、和前后内容如何配合。
回答对象只能是选中的内容；不要把整行/整段代码或旁边的注解当成回答对象。`

const CUSTOM_PROVIDER: StoredProvider = {
  id: 'custom',
  name: '自定义接口（高级）',
  kind: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  models: [],
  builtin: true,
  priceIn: 0,
  priceOut: 0
}

function defaultProviders(): StoredProvider[] {
  return [
    ...PROVIDER_PRESETS.map((preset) => ({
      id: preset.id,
      name: preset.name,
      kind: preset.kind,
      baseUrl: preset.baseUrl,
      models: [...preset.models],
      builtin: true,
      presetId: preset.id,
      priceIn: preset.priceIn,
      priceOut: preset.priceOut
    })),
    { ...CUSTOM_PROVIDER, models: [] }
  ]
}

function defaults(): StoredSettings {
  return {
    language: 'system',
    answerLanguage: 'auto',
    enabled: true,
    localOnly: true,
    filterMode: 'all',
    whitelist: [],
    detectedApps: [],
    prompt: DEFAULT_PROMPT,
    defaultProviderId: 'ollama',
    defaultModel: '',
    maxChars: 2000,
    launchAtLogin: false,
    useContext: true,
    contextChars: 300,
    historyEnabled: true,
    autoDownloadUpdates: false,
    checkUpdatesOnStartup: true,
    promptStandardVersion: 2,
    providers: defaultProviders()
  }
}

function settingsPath(dir: string): string {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'settings.json')
}

export interface SettingsCodec {
  encrypt: (key: string) => string
  decrypt: (value: string) => string
}

export class SettingsStore {
  private readonly dir: string
  private readonly codec?: SettingsCodec
  private data: StoredSettings
  private timer: NodeJS.Timeout | null = null
  private lastWriteError: string | null = null

  constructor(dir: string, codec?: SettingsCodec) {
    this.dir = dir
    this.codec = codec
    this.data = this.load()
  }

  private load(): StoredSettings {
    const file = settingsPath(this.dir)
    if (!existsSync(file)) {
      const d = defaults()
      this.writeNow(d)
      return d
    }
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<StoredSettings>
      const merged: StoredSettings = { ...defaults(), ...raw }
      // settings.json 语义损坏时（合法 JSON 但类型不对）不能整份丢弃：
      // 非对象条目丢弃，非数组 models 矫正为空数组，非字符串模型名过滤掉。
      // 否则下面遍历 providers 会抛错，整个设置文件会被当成损坏备份并重置。
      if (!Array.isArray(raw.providers)) {
        merged.providers = defaultProviders()
      } else {
        merged.providers = raw.providers
          .filter(
            (entry): entry is StoredProvider =>
              Boolean(entry) &&
              typeof entry === 'object' &&
              typeof (entry as StoredProvider).id === 'string' &&
              (entry as StoredProvider).id.length > 0
          )
          .map((entry) => ({
            ...entry,
            models: Array.isArray(entry.models)
              ? entry.models.filter((model): model is string => typeof model === 'string')
              : []
          }))
      }
      // 默认服务商指向不存在的 id 时回到 ollama，不留悬空默认。
      if (!merged.providers.some((provider) => provider.id === merged.defaultProviderId)) {
        merged.defaultProviderId = 'ollama'
        merged.defaultModel = ''
      }
      if (!raw.language) merged.language = 'zh-CN'
      if (!raw.answerLanguage) merged.answerLanguage = 'auto'
      for (const provider of merged.providers) {
        if (typeof provider.priceIn !== 'number' || typeof provider.priceOut !== 'number') {
          const preset = PROVIDER_PRESETS.find((item) => item.id === provider.id)
          provider.priceIn = preset?.priceIn ?? 0
          provider.priceOut = preset?.priceOut ?? 0
        }
      }
      let prunedModels = false
      for (const provider of merged.providers) {
        const key = provider.presetId ?? provider.id
        if (key !== 'qwen' || !Array.isArray(provider.models)) continue
        const usable = provider.models.filter((model) => isChatModel(key, model))
        if (usable.length !== provider.models.length) {
          provider.models = usable
          prunedModels = true
        }
      }
      if (prunedModels) {
        const def = merged.providers.find((p) => p.id === merged.defaultProviderId)
        if (
          def &&
          (def.presetId ?? def.id) === 'qwen' &&
          merged.defaultModel &&
          !def.models.includes(merged.defaultModel)
        ) {
          merged.defaultModel = def.models[0] ?? ''
        }
        this.writeNow(merged)
      }
      const known = new Set(merged.providers.map((p) => p.id))
      for (const p of defaultProviders()) {
        if (!known.has(p.id)) merged.providers.push(p)
      }
      if (!raw.promptStandardVersion || raw.promptStandardVersion < 2) {
        if (!merged.prompt.includes('**词义**')) {
          merged.prompt = `${merged.prompt.trim()}\n\n${PROMPT_STANDARD_SUFFIX}`
        }
        merged.promptStandardVersion = 2
        this.writeNow(merged)
      }
      return merged
    } catch {
      const backup = `${file}.broken-${Date.now()}`
      try {
        renameSync(file, backup)
      } catch {
        /* keep original if backup fails */
      }
      const d = defaults()
      this.writeNow(d)
      return d
    }
  }

  private writeNow(data: StoredSettings): boolean {
    const file = settingsPath(this.dir)
    const tmp = `${file}.tmp`
    try {
      writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
      renameSync(tmp, file)
      this.lastWriteError = null
      return true
    } catch (error) {
      this.lastWriteError = error instanceof Error ? error.message : String(error)
      console.error('[settings] 写入配置失败', error)
      return false
    }
  }

  private scheduleSave(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      this.writeNow(this.data)
    }, 150)
  }

  flush(): boolean {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    return this.writeNow(this.data)
  }

  getLastWriteError(): string | null {
    return this.lastWriteError
  }

  get(): StoredSettings {
    return this.data
  }

  getView(): SettingsView {
    const { providers, ...rest } = this.data
    void providers
    return JSON.parse(JSON.stringify(rest)) as SettingsView
  }

  getProvidersView(): ProviderView[] {
    return this.data.providers.map((p) => ({
      id: p.id,
      name: p.name,
      kind: p.kind,
      baseUrl: p.baseUrl,
      models: sortModelsForProvider(p.presetId ?? p.id, p.models).filter((model) =>
        isChatModel(p.presetId ?? p.id, model)
      ),
      hasKey: Boolean(p.keyEnc),
      builtin: p.builtin,
      presetId: p.presetId ?? (PROVIDER_PRESETS.some((preset) => preset.id === p.id) ? p.id : undefined),
      priceIn: p.priceIn ?? 0,
      priceOut: p.priceOut ?? 0
    }))
  }

  getProvider(id: string): StoredProvider | undefined {
    return this.data.providers.find((p) => p.id === id)
  }

  apiKey(id: string): string {
    const p = this.getProvider(id)
    if (!p?.keyEnc || !this.codec) return ''
    try {
      return this.codec.decrypt(p.keyEnc)
    } catch {
      return ''
    }
  }

  update(patch: SettingsPatch): StoredSettings {
    const next = { ...this.data }
    if (patch.language === 'system' || patch.language === 'zh-CN' || patch.language === 'en-US') {
      next.language = patch.language
    }
    if (
      patch.answerLanguage === 'auto' ||
      patch.answerLanguage === 'zh-CN' ||
      patch.answerLanguage === 'en-US'
    ) {
      next.answerLanguage = patch.answerLanguage
    }
    if (typeof patch.enabled === 'boolean') next.enabled = patch.enabled
    if (typeof patch.localOnly === 'boolean') next.localOnly = patch.localOnly
    if (patch.filterMode === 'all' || patch.filterMode === 'whitelist') next.filterMode = patch.filterMode
    if (Array.isArray(patch.whitelist)) {
      next.whitelist = Array.from(
        new Set(patch.whitelist.map((s) => String(s).trim()).filter(Boolean))
      ).slice(0, 80)
    }
    if (typeof patch.prompt === 'string' && patch.prompt.trim()) next.prompt = patch.prompt.trim()
    // 默认服务商只接受已存在的 id，不存在的直接忽略，不留悬空默认。
    if (
      typeof patch.defaultProviderId === 'string' &&
      next.providers.some((provider) => provider.id === patch.defaultProviderId)
    ) {
      next.defaultProviderId = patch.defaultProviderId
    }
    if (typeof patch.defaultModel === 'string' && patch.defaultModel.trim()) {
      next.defaultModel = patch.defaultModel.trim()
    }
    if (typeof patch.maxChars === 'number') {
      next.maxChars = Math.min(20000, Math.max(100, Math.round(patch.maxChars)))
    }
    if (typeof patch.launchAtLogin === 'boolean') next.launchAtLogin = patch.launchAtLogin
    if (typeof patch.useContext === 'boolean') next.useContext = patch.useContext
    if (typeof patch.historyEnabled === 'boolean') next.historyEnabled = patch.historyEnabled
    if (typeof patch.autoDownloadUpdates === 'boolean') {
      next.autoDownloadUpdates = patch.autoDownloadUpdates
    }
    if (typeof patch.checkUpdatesOnStartup === 'boolean') {
      next.checkUpdatesOnStartup = patch.checkUpdatesOnStartup
    }
    if (typeof patch.contextChars === 'number') {
      next.contextChars = Math.min(1000, Math.max(100, Math.round(patch.contextChars)))
    }
    this.data = next
    this.scheduleSave()
    return this.data
  }

  saveProvider(patch: ProviderPatch): StoredProvider {
    const existing = patch.id ? this.getProvider(patch.id) : undefined
    if (existing) {
      existing.name = patch.name.trim() || existing.name
      existing.kind = patch.kind
      existing.baseUrl = patch.baseUrl.trim().replace(/\/+$/, '')
      if (typeof patch.priceIn === 'number') existing.priceIn = Math.max(0, patch.priceIn)
      if (typeof patch.priceOut === 'number') existing.priceOut = Math.max(0, patch.priceOut)
      if (patch.apiKey === null) existing.keyEnc = undefined
      else if (typeof patch.apiKey === 'string' && patch.apiKey.trim()) {
        existing.keyEnc = this.encrypt(patch.apiKey.trim())
      }
    } else {
      const id = `custom-${Date.now().toString(36)}`
      const created: StoredProvider = {
        id,
        name: patch.name.trim() || '自定义服务',
        kind: patch.kind,
        baseUrl: patch.baseUrl.trim().replace(/\/+$/, ''),
        models: [],
        builtin: false,
        priceIn: Math.max(0, patch.priceIn ?? 0),
        priceOut: Math.max(0, patch.priceOut ?? 0)
      }
      if (typeof patch.apiKey === 'string' && patch.apiKey.trim()) {
        created.keyEnc = this.encrypt(patch.apiKey.trim())
      }
      this.data.providers.push(created)
    }
    const target = existing ?? this.data.providers[this.data.providers.length - 1]
    const model = patch.model?.trim()
    if (model && target && !target.models.includes(model)) {
      target.models.unshift(model)
    }
    this.scheduleSave()
    return target
  }

  removeProvider(id: string): void {
    this.data.providers = this.data.providers.filter((p) => p.id !== id || p.builtin)
    if (!this.getProvider(this.data.defaultProviderId)) {
      this.data.defaultProviderId = 'ollama'
      this.data.defaultModel = ''
    }
    this.scheduleSave()
  }

  setModels(id: string, models: string[]): void {
    const p = this.getProvider(id)
    if (!p) return
    const key = p.presetId ?? p.id
    const unique = Array.from(new Set(models.filter(Boolean)))
    p.models = sortModelsForProvider(key, unique)
      .filter((model) => isChatModel(key, model))
      .slice(0, 100)
    if (
      p.id === this.data.defaultProviderId &&
      this.data.defaultModel &&
      !p.models.includes(this.data.defaultModel)
    ) {
      this.data.defaultModel = p.models[0] ?? ''
    }
    this.scheduleSave()
  }

  private encrypt(key: string): string {
    return this.codec?.encrypt(key) ?? `plain:${Buffer.from(key, 'utf8').toString('base64')}`
  }

  clearDetectedApps(): void {
    this.data.detectedApps = []
    this.scheduleSave()
  }

  touchApp(name: string): DetectedApp | null {
    const clean = name.trim()
    if (!clean) return null
    const now = Date.now()
    const existing = this.data.detectedApps.find((a) => a.name === clean)
    const shouldSave = !existing || now - existing.lastSeen >= 60_000
    if (existing) {
      existing.lastSeen = now
      existing.count += 1
    } else {
      this.data.detectedApps.push({ name: clean, lastSeen: now, count: 1 })
    }
    this.data.detectedApps.sort((a, b) => b.lastSeen - a.lastSeen)
    this.data.detectedApps = this.data.detectedApps.slice(0, 40)
    if (shouldSave) this.scheduleSave()
    return existing ?? this.data.detectedApps[0]
  }
}
