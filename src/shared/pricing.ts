export interface ModelPrice {
  in: number
  out: number
}

// 人民币 / 百万 tokens，按公开价目整理，仅用于估算，实际账单以服务商为准。
export const MODEL_PRICES_CNY: Record<string, ModelPrice> = {
  'deepseek-chat': { in: 2, out: 8 },
  'deepseek-reasoner': { in: 4, out: 16 },
  'deepseek-flash': { in: 2, out: 8 },
  // 官方仍受理的旧别名，请求由 V4.1 Flash 承接并按 Flash 计价；不在模型预设中展示。
  'deepseek-v4-flash': { in: 2, out: 8 },
  'deepseek-v4-pro': { in: 9, out: 27 },
  'deepseek-v4.1-flash': { in: 2, out: 8 },
  // 阿里云百炼（华北2-北京，2026-11 公开价）；分档计价取本应用选区所在的低档。
  'qwen3.8-max': { in: 12, out: 36 },
  'qwen3.8-flash': { in: 0.8, out: 2.7 },
  'qwen3.7-max': { in: 12, out: 36 },
  'qwen3.7-max-preview': { in: 12, out: 36 },
  'qwen3.7-plus': { in: 2, out: 8 },
  'qwen3.7-flash': { in: 0.2, out: 0.8 },
  'qwen3.6-plus': { in: 2, out: 12 },
  'qwen3.6-flash': { in: 1.2, out: 7.2 },
  'qwen3.5-plus': { in: 0.8, out: 4.8 },
  'qwen3.5-flash': { in: 0.2, out: 2 },
  'qwen3.8-27b': { in: 3, out: 12 },
  'qwen-plus': { in: 0.8, out: 2 },
  'qwen-max': { in: 2.4, out: 9.6 },
  'qwen-turbo': { in: 0.3, out: 0.6 },
  'qwen-long': { in: 0.5, out: 2 },
  // 百炼上第三方托管模型（公开价；实际以百炼账单为准）。
  'vanchin/deepseek-v4.1-flash': { in: 2, out: 8 },
  'vanchin/deepseek-v4-pro': { in: 12, out: 24 },
  'vanchin/deepseek-v4-pro-0813': { in: 9, out: 27 },
  'vanchin/deepseek-v3.2-think': { in: 2, out: 3 },
  'vanchin/deepseek-v3.1-terminus': { in: 4, out: 12 },
  'vanchin/deepseek-r1': { in: 4, out: 16 },
  'vanchin/deepseek-v3': { in: 2, out: 8 },
  'siliconflow/deepseek-v3.2': { in: 2, out: 3 },
  'siliconflow/deepseek-v3.1-terminus': { in: 4, out: 12 },
  'siliconflow/deepseek-r1-0528': { in: 4, out: 16 },
  'siliconflow/deepseek-v3-0324': { in: 2, out: 8 },
  'kimi-k3': { in: 20, out: 100 },
  'kimi/kimi-k3': { in: 20, out: 100 },
  'kimi-k2.7-code': { in: 6.5, out: 27 },
  'kimi/kimi-k2.7-code': { in: 6.5, out: 27 },
  'kimi-k2.6': { in: 6.5, out: 27 },
  'kimi/kimi-k2.6': { in: 6.5, out: 27 },
  'minimax/minimax-m3': { in: 2.1, out: 8.4 },
  'minimax/minimax-m3.1-flash': { in: 1, out: 4 },
  'moonshot-v1-8k': { in: 12, out: 12 },
  'moonshot-v1-32k': { in: 24, out: 24 },
  'moonshot-v1-128k': { in: 60, out: 60 },
  'glm-5.3': { in: 8, out: 28 },
  'glm-5.3-flash': { in: 0.8, out: 2.8 },
  'glm-5.3-flashx': { in: 2, out: 7 },
  'glm-5.2': { in: 8, out: 28 },
  'glm-5.1': { in: 6, out: 24 },
  'glm-5-turbo': { in: 5, out: 22 },
  'glm-5': { in: 4, out: 18 },
  'glm-4.7-flashx': { in: 0.5, out: 3 },
  'glm-4.7-flash': { in: 0, out: 0 },
  'glm-4.7': { in: 3, out: 14 },
  'glm-4.6': { in: 3, out: 14 },
  'glm-4.5-air': { in: 0.8, out: 6 },
  'glm-4.5': { in: 3, out: 14 },
  'glm-4-plus': { in: 5, out: 5 },
  'glm-4-air': { in: 0.5, out: 0.5 },
  'glm-4-flashx': { in: 0.1, out: 0.1 },
  'glm-4-flash': { in: 0, out: 0 },
  'cmaas-glm-5.3': { in: 8, out: 28 },
  'zhipu/glm-5.3': { in: 8, out: 28 },
  'zhipu/glm-5.3-flash': { in: 0.8, out: 2.8 },
  'zhipu/glm-5.3-flashx': { in: 2, out: 7 },
  'zhipu/glm-5.2': { in: 8, out: 28 },
  'zhipu/glm-5.1': { in: 6, out: 24 },
  'zhipu/glm-5': { in: 4, out: 18 },
  'cmaas-qwen3.8-flash': { in: 0.8, out: 2.7 },
  'gpt-4o-mini': { in: 1.1, out: 4.3 },
  'gpt-4o': { in: 18, out: 72 },
  'gpt-4.1-mini': { in: 3, out: 12 }
}

const ORDERED_KEYS = Object.keys(MODEL_PRICES_CNY).sort((a, b) => b.length - a.length)
const EXACT_PRICES = new Map(
  Object.entries(MODEL_PRICES_CNY).map(([key, price]) => [key.toLowerCase(), price])
)
// 只让日期/版本快照沿用基础价；-prime、-highspeed 等高价变体保持“未收录”，避免低估。
const SNAPSHOT_SUFFIX = /^-(?:latest|\d{4}(?:-\d{2}(?:-\d{2})?)?)$/

export function priceForModel(model: string): ModelPrice | null {
  const name = model.trim().toLowerCase()
  const exact = EXACT_PRICES.get(name)
  if (exact) return exact
  for (const key of ORDERED_KEYS) {
    if (!name.startsWith(key)) continue
    if (SNAPSHOT_SUFFIX.test(name.slice(key.length))) return MODEL_PRICES_CNY[key]
  }
  return null
}

export function estimateCostCny(options: {
  model: string
  promptTokens: number
  completionTokens: number
  local: boolean
  fallbackIn?: number
  fallbackOut?: number
  preferFallback?: boolean
}): number {
  if (options.local) return 0
  const fallback = {
    in: Math.max(0, options.fallbackIn ?? 0),
    out: Math.max(0, options.fallbackOut ?? 0)
  }
  const hasFallback = fallback.in > 0 || fallback.out > 0
  const price =
    options.preferFallback && hasFallback ? fallback : (priceForModel(options.model) ?? fallback)
  return (
    (Math.max(0, options.promptTokens) / 1_000_000) * price.in +
    (Math.max(0, options.completionTokens) / 1_000_000) * price.out
  )
}

export function formatCny(cost: number): string {
  if (!Number.isFinite(cost) || cost <= 0) return '¥0'
  if (cost < 0.01) return `¥${cost.toFixed(4)}`
  if (cost < 1) return `¥${cost.toFixed(3)}`
  return `¥${cost.toFixed(2)}`
}

// DeepSeek 当前官方模型是 deepseek-flash / deepseek-v4-pro；
// deepseek-chat / deepseek-reasoner 是已停止使用的旧名，仅保留价格用于旧记录估算。
export const USAGE_BASELINE_MODEL = 'deepseek-flash'
const USAGE_BASELINE_COMBINED =
  MODEL_PRICES_CNY[USAGE_BASELINE_MODEL].in + MODEL_PRICES_CNY[USAGE_BASELINE_MODEL].out

export function usageMultiplier(options: {
  model: string
  local?: boolean
  fallbackIn?: number
  fallbackOut?: number
  useFallback?: boolean
}): number | null {
  if (options.local) return 0
  const known = priceForModel(options.model)
  if (known) {
    const combined = known.in + known.out
    return combined <= 0 ? 0 : combined / USAGE_BASELINE_COMBINED
  }
  // 内置服务商的模型没有收录价目时，宁可显示“未收录”，也不要把所有
  // 未知模型都按同一个服务商价格显示成 1.00×，造成错误比较。
  if (options.useFallback === false) return null
  const fallbackIn = Math.max(0, options.fallbackIn ?? 0)
  const fallbackOut = Math.max(0, options.fallbackOut ?? 0)
  const combined = fallbackIn + fallbackOut
  return combined <= 0 ? null : combined / USAGE_BASELINE_COMBINED
}

export function formatUsageMultiplier(value: number | null): string {
  if (value === null) return '—'
  if (value === 0) return '免费'
  if (value < 0.01) return '<0.01×'
  return `${value.toFixed(2)}×`
}
