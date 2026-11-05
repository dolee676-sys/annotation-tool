import { app, safeStorage } from 'electron'
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
} from '../shared/types'
import { PROVIDER_PRESETS } from '../shared/presets'

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
  providers: StoredProvider[]
}

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
    providers: defaultProviders()
  }
}

function settingsPath(): string {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'settings.json')
}

export class SettingsStore {
  private data: StoredSettings
  private timer: NodeJS.Timeout | null = null
  private lastWriteError: string | null = null

  constructor() {
    this.data = this.load()
  }

  private load(): StoredSettings {
    const file = settingsPath()
    if (!existsSync(file)) {
      const d = defaults()
      this.writeNow(d)
      return d
    }
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<StoredSettings>
      const merged: StoredSettings = { ...defaults(), ...raw }
      for (const provider of merged.providers) {
        if (typeof provider.priceIn !== 'number' || typeof provider.priceOut !== 'number') {
          const preset = PROVIDER_PRESETS.find((item) => item.id === provider.id)
          provider.priceIn = preset?.priceIn ?? 0
          provider.priceOut = preset?.priceOut ?? 0
        }
      }
      const known = new Set(merged.providers.map((p) => p.id))
      for (const p of defaultProviders()) {
        if (!known.has(p.id)) merged.providers.push(p)
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
    const file = settingsPath()
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
      models: [...p.models],
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
    if (!p?.keyEnc) return ''
    try {
      if (p.keyEnc.startsWith('enc:')) {
        return safeStorage.decryptString(Buffer.from(p.keyEnc.slice(4), 'base64'))
      }
      if (p.keyEnc.startsWith('plain:')) {
        return Buffer.from(p.keyEnc.slice(6), 'base64').toString('utf8')
      }
    } catch {
      return ''
    }
    return ''
  }

  update(patch: SettingsPatch): StoredSettings {
    const next = { ...this.data }
    if (typeof patch.enabled === 'boolean') next.enabled = patch.enabled
    if (typeof patch.localOnly === 'boolean') next.localOnly = patch.localOnly
    if (patch.filterMode === 'all' || patch.filterMode === 'whitelist') next.filterMode = patch.filterMode
    if (Array.isArray(patch.whitelist)) {
      next.whitelist = Array.from(
        new Set(patch.whitelist.map((s) => String(s).trim()).filter(Boolean))
      ).slice(0, 80)
    }
    if (typeof patch.prompt === 'string' && patch.prompt.trim()) next.prompt = patch.prompt.trim()
    if (typeof patch.defaultProviderId === 'string') next.defaultProviderId = patch.defaultProviderId
    if (typeof patch.defaultModel === 'string' && patch.defaultModel.trim()) {
      next.defaultModel = patch.defaultModel.trim()
    }
    if (typeof patch.maxChars === 'number') {
      next.maxChars = Math.min(20000, Math.max(100, Math.round(patch.maxChars)))
    }
    if (typeof patch.launchAtLogin === 'boolean') next.launchAtLogin = patch.launchAtLogin
    if (typeof patch.useContext === 'boolean') next.useContext = patch.useContext
    if (typeof patch.historyEnabled === 'boolean') next.historyEnabled = patch.historyEnabled
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
    p.models = Array.from(new Set(models.filter(Boolean))).slice(0, 100)
    this.scheduleSave()
  }

  private encrypt(key: string): string {
    if (safeStorage.isEncryptionAvailable()) {
      return `enc:${safeStorage.encryptString(key).toString('base64')}`
    }
    return `plain:${Buffer.from(key, 'utf8').toString('base64')}`
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
