import type { ProviderKind } from './types'

export interface ProviderPreset {
  id: string
  name: string
  tagline: string
  kind: ProviderKind
  baseUrl: string
  local: boolean
  models: string[]
  priceIn: number
  priceOut: number
  keyUrl?: string
  keyHint?: string
  free?: boolean
  freeModels?: string[]
}

const BASE_PRESETS: Array<Omit<ProviderPreset, 'priceIn' | 'priceOut'>> = [
  {
    id: 'ollama',
    name: 'Ollama',
    tagline: '本机运行 · 免费 · 不联网',
    kind: 'ollama',
    baseUrl: 'http://127.0.0.1:11434',
    local: true,
    models: [],
    free: true
  },
  {
    id: 'lmstudio',
    name: 'LM Studio',
    tagline: '本机运行 · 免费 · 不联网',
    kind: 'openai',
    baseUrl: 'http://127.0.0.1:1234/v1',
    local: true,
    models: [],
    free: true
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    tagline: '便宜 · 中文好',
    kind: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    local: false,
    models: ['deepseek-chat', 'deepseek-reasoner'],
    keyUrl: 'https://platform.deepseek.com/api_keys',
    keyHint: 'sk-...'
  },
  {
    id: 'qwen',
    name: '通义千问',
    tagline: '阿里云百炼',
    kind: 'openai',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    local: false,
    models: ['qwen-plus', 'qwen-max', 'qwen-turbo', 'qwen-long'],
    keyUrl: 'https://bailian.console.aliyun.com/',
    keyHint: 'sk-...'
  },
  {
    id: 'moonshot',
    name: 'Kimi',
    tagline: '月之暗面',
    kind: 'openai',
    baseUrl: 'https://api.moonshot.cn/v1',
    local: false,
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
    keyUrl: 'https://platform.moonshot.cn/console/api-keys',
    keyHint: 'sk-...'
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    tagline: '国产 · 有免费额度',
    kind: 'openai',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    local: false,
    models: ['glm-4-plus', 'glm-4-air', 'glm-4-flash'],
    keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    keyHint: '...',
    freeModels: ['glm-4-flash']
  },
  {
    id: 'openai',
    name: 'OpenAI',
    tagline: 'GPT 系列',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    local: false,
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'],
    keyUrl: 'https://platform.openai.com/api-keys',
    keyHint: 'sk-...'
  }
]

const PRESET_PRICES: Record<string, { priceIn: number; priceOut: number }> = {
  deepseek: { priceIn: 2, priceOut: 8 },
  qwen: { priceIn: 1, priceOut: 3 },
  moonshot: { priceIn: 12, priceOut: 12 },
  zhipu: { priceIn: 5, priceOut: 5 },
  openai: { priceIn: 5, priceOut: 20 }
}

export const PROVIDER_PRESETS: ProviderPreset[] = BASE_PRESETS.map((preset) => ({
  ...preset,
  priceIn: PRESET_PRICES[preset.id]?.priceIn ?? 0,
  priceOut: PRESET_PRICES[preset.id]?.priceOut ?? 0
}))

export function presetById(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((preset) => preset.id === id)
}

export function isLocalAddress(baseUrl: string): boolean {
  try {
    return ['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0'].includes(
      new URL(baseUrl).hostname.toLowerCase()
    )
  } catch {
    return false
  }
}

export function isFreeModel(presetId: string | undefined, model: string, local: boolean): boolean {
  if (local) return true
  const preset = presetId ? presetById(presetId) : undefined
  if (!preset) return false
  if (preset.free) return true
  const name = model.trim().toLowerCase()
  if (!name) return false
  return (preset.freeModels ?? []).some((free) => name === free.toLowerCase())
}
