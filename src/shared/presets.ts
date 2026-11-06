import type { ProviderKind } from './types'

export interface ProviderGuide {
  steps: string[]
  billingUrl?: string
  billingLabel?: string
  note?: string
}

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
  guide: ProviderGuide
}

const BASE_PRESETS: Array<Omit<ProviderPreset, 'priceIn' | 'priceOut' | 'guide'>> = [
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
    models: ['deepseek-flash', 'deepseek-v4-pro'],
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
    models: ['qwen3.8-flash', 'qwen3.7-plus', 'qwen3.8-max', 'qwen3.7-flash'],
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
  qwen: { priceIn: 0.8, priceOut: 2.7 },
  moonshot: { priceIn: 12, priceOut: 12 },
  zhipu: { priceIn: 5, priceOut: 5 },
  openai: { priceIn: 5, priceOut: 20 }
}

const PROVIDER_GUIDES: Record<string, ProviderGuide> = {
  ollama: {
    steps: [
      '打开 ollama.com/download，下载并安装 Ollama。',
      '在终端运行 `ollama pull qwen2.5:7b` 下载一个模型（也可以换成别的模型）。',
      '确认 Ollama 正在运行，默认地址是 http://127.0.0.1:11434。',
      '回到这里点「重新检测模型」，选中模型后保存。'
    ],
    note: '本机模型免费，不按 token 计费；模型越大，占用的内存/显存越多。'
  },
  lmstudio: {
    steps: [
      '打开 lmstudio.ai，下载并安装 LM Studio。',
      '在 Discover 里搜索并下载一个模型。',
      '打开 Developer 页面，启动本地服务器，默认端口 1234。',
      '回到这里点「重新检测模型」，选中模型后保存。'
    ],
    note: '本机模型免费，不按 token 计费；需要先下载模型文件。'
  },
  deepseek: {
    steps: [
      '打开 platform.deepseek.com，注册并完成实名认证。',
      '在「API Keys」创建 Key，创建后立即复制保存（只完整显示一次）。',
      '在「充值」页面用支付宝/微信充少量金额，API 按 token 扣费。',
      '回到这里粘贴 Key，选 deepseek-flash 或 deepseek-v4-pro，保存并测试。'
    ],
    billingUrl: 'https://platform.deepseek.com/',
    billingLabel: '打开控制台充值',
    note: '余额不足时接口会报 402；先充 10 元通常就够试用很久。'
  },
  qwen: {
    steps: [
      '打开阿里云百炼控制台，登录并开通百炼。',
      '创建 API Key，复制保存。',
      '在阿里云费用中心充值，或购买模型资源包。',
      '回到这里粘贴 Key，日常选 qwen3.8-flash，复杂问题选 qwen3.8-max，保存并测试。'
    ],
    billingUrl: 'https://bailian.console.aliyun.com/',
    billingLabel: '打开百炼控制台',
    note: '新用户通常有免费额度，具体以控制台显示为准。'
  },
  moonshot: {
    steps: [
      '打开 platform.moonshot.cn，注册并完成个人认证。',
      '在 API Key 页面创建 Key，复制保存。',
      '在用户充值页面用微信/支付宝充值；新用户通常有免费测试额度。',
      '回到这里粘贴 Key，选 moonshot-v1-8k 等模型，保存并测试。'
    ],
    billingUrl: 'https://platform.moonshot.cn/',
    billingLabel: '打开 Kimi 控制台充值',
    note: '免费额度用完后按 token 扣费，输入和输出分别计价。'
  },
  zhipu: {
    steps: [
      '打开 open.bigmodel.cn，注册并完成实名认证。',
      '在 API Key 管理页创建 Key，复制保存。',
      '在控制台「财务」购买资源包或充值；glm-4-flash 通常有免费额度。',
      '回到这里粘贴 Key，选 glm-4-plus / glm-4-air / glm-4-flash，保存并测试。'
    ],
    billingUrl: 'https://open.bigmodel.cn/',
    billingLabel: '打开智谱控制台充值',
    note: '免费额度有限；复杂提问建议用 glm-4-plus 等更强的模型。'
  },
  openai: {
    steps: [
      '打开 platform.openai.com，注册并完成账单设置。',
      '在 API Keys 页面创建 Key，复制保存。',
      '在 Billing 页面绑定支付方式并充值（通常需要国际支付方式）。',
      '回到这里粘贴 Key，选 gpt-4o-mini 等模型，保存并测试。'
    ],
    billingUrl: 'https://platform.openai.com/settings/organization/billing/overview',
    billingLabel: '打开 OpenAI 账单页',
    note: '中国大陆可能无法直接付款；可以改用支持 OpenAI 兼容协议的中转服务。'
  }
}

export const PROVIDER_PRESETS: ProviderPreset[] = BASE_PRESETS.map((preset) => ({
  ...preset,
  priceIn: PRESET_PRICES[preset.id]?.priceIn ?? 0,
  priceOut: PRESET_PRICES[preset.id]?.priceOut ?? 0,
  guide: PROVIDER_GUIDES[preset.id] ?? { steps: [] }
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
