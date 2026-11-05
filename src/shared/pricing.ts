export interface ModelPrice {
  in: number
  out: number
}

// 人民币 / 百万 tokens，按公开价目整理，仅用于估算，实际账单以服务商为准。
export const MODEL_PRICES_CNY: Record<string, ModelPrice> = {
  'deepseek-chat': { in: 2, out: 8 },
  'deepseek-reasoner': { in: 4, out: 16 },
  'qwen-plus': { in: 0.8, out: 2 },
  'qwen-max': { in: 2.4, out: 9.6 },
  'qwen-turbo': { in: 0.3, out: 0.6 },
  'qwen-long': { in: 0.5, out: 2 },
  'moonshot-v1-8k': { in: 12, out: 12 },
  'moonshot-v1-32k': { in: 24, out: 24 },
  'moonshot-v1-128k': { in: 60, out: 60 },
  'glm-4-plus': { in: 50, out: 50 },
  'glm-4-air': { in: 1, out: 1 },
  'glm-4-flash': { in: 0, out: 0 },
  'gpt-4o-mini': { in: 1.1, out: 4.3 },
  'gpt-4o': { in: 18, out: 72 },
  'gpt-4.1-mini': { in: 3, out: 12 }
}

const ORDERED_KEYS = Object.keys(MODEL_PRICES_CNY).sort((a, b) => b.length - a.length)

export function priceForModel(model: string): ModelPrice | null {
  const name = model.trim().toLowerCase()
  for (const key of ORDERED_KEYS) {
    if (name === key || name.startsWith(key)) return MODEL_PRICES_CNY[key]
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

export const USAGE_BASELINE_MODEL = 'deepseek-chat'
const USAGE_BASELINE_COMBINED =
  MODEL_PRICES_CNY[USAGE_BASELINE_MODEL].in + MODEL_PRICES_CNY[USAGE_BASELINE_MODEL].out

export function usageMultiplier(options: {
  model: string
  local?: boolean
  fallbackIn?: number
  fallbackOut?: number
}): number | null {
  if (options.local) return 0
  const known = priceForModel(options.model)
  if (known) {
    const combined = known.in + known.out
    return combined <= 0 ? 0 : combined / USAGE_BASELINE_COMBINED
  }
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
