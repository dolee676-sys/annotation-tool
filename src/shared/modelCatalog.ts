import { priceForModel } from './pricing.ts'

export type ModelGroup = 'recommended' | 'text' | 'other'

export interface ModelGroupEntry {
  group: ModelGroup
  models: string[]
}

// 按注解/问答场景的综合表现排序：日常速度、中文理解、价格。
// 只收录当前在百炼可用的文本对话模型；图片、语音、向量类放到最后。
const RECOMMENDED_QWEN = [
  'qwen3.8-flash',
  'qwen3.7-plus',
  'qwen3.8-max',
  'deepseek-v4.1-flash',
  'glm-5.3',
  'qwen3.7-flash',
  'deepseek-v4-pro',
  'glm-5.3-flash',
  'zhipu/glm-5.3-flash'
]

const RECOMMENDED_QWEN_SET = new Set(RECOMMENDED_QWEN.map((model) => model.toLowerCase()))

const NON_CHAT =
  /(image|audio|asr|tts|speech|realtime|livetranslate|embedding|rerank|ocr|mt-uni|omni|wan2|test-sre|sre-gpu|auto-handle|unisound)/i

const INTERNAL = /^(test-sre|sre-gpu|sre-)/i

// 百炼平台上的第三方模型：按厂商计费，但走百炼的 Key 和账单。
const BAILIAN_THIRD_PARTY =
  /(^|[/-])(deepseek|kimi|glm|minimax|stepfun|xiaomi|unisound|antdigital)/i

const FAMILY_ORDER = [/^qwen/, /deepseek/, /^kimi/, /glm/, /minimax/, /step/, /mimo|xiaomi/]

function groupOf(model: string): ModelGroup {
  if (NON_CHAT.test(model)) return 'other'
  return RECOMMENDED_QWEN_SET.has(model.toLowerCase()) ? 'recommended' : 'text'
}

function familyRank(model: string): number {
  const name = model.toLowerCase()
  const index = FAMILY_ORDER.findIndex((pattern) => pattern.test(name))
  return index === -1 ? FAMILY_ORDER.length : index
}

function versionRank(model: string): number {
  const match = model.toLowerCase().match(/(\d+)\.(\d+)/)
  return match ? Number(match[1]) * 100 + Number(match[2]) : 0
}

function tierRank(model: string): number {
  const name = model.toLowerCase()
  if (!name.startsWith('qwen')) return 0
  if (name.includes('max')) return 0
  if (name.includes('plus')) return 1
  if (name.includes('flash')) return 2
  return 3
}

function isSnapshot(model: string): boolean {
  return /-(?:\d{4}(?:-\d{2}(?:-\d{2})?)?|\d{4})$/.test(model.toLowerCase())
}

function compareTextModel(a: string, b: string): number {
  const family = familyRank(a) - familyRank(b)
  if (family !== 0) return family
  const tier = tierRank(a) - tierRank(b)
  if (tier !== 0) return tier
  const missingPrice = Number(priceForModel(a) === null) - Number(priceForModel(b) === null)
  if (missingPrice !== 0) return missingPrice
  const version = versionRank(b) - versionRank(a)
  if (version !== 0) return version
  const snapshot = Number(isSnapshot(a)) - Number(isSnapshot(b))
  if (snapshot !== 0) return snapshot
  return a.localeCompare(b, 'en')
}

function compareOtherModel(a: string, b: string): number {
  const internal = Number(INTERNAL.test(a)) - Number(INTERNAL.test(b))
  if (internal !== 0) return internal
  return a.localeCompare(b, 'en')
}

export function groupQwenModels(models: string[]): ModelGroupEntry[] {
  const unique = Array.from(new Set(models.filter(Boolean)))
  const recommended: string[] = []
  const text: string[] = []
  const other: string[] = []
  for (const model of unique) {
    const group = groupOf(model)
    if (group === 'recommended') recommended.push(model)
    else if (group === 'text') text.push(model)
    else other.push(model)
  }
  recommended.sort(
    (a, b) =>
      RECOMMENDED_QWEN.indexOf(a.toLowerCase()) - RECOMMENDED_QWEN.indexOf(b.toLowerCase())
  )
  text.sort(compareTextModel)
  other.sort(compareOtherModel)
  return [
    { group: 'recommended', models: recommended },
    { group: 'text', models: text },
    { group: 'other', models: other }
  ]
}

export function sortModelsForProvider(
  providerKey: string | undefined,
  models: string[]
): string[] {
  if (providerKey !== 'qwen') return [...models]
  return groupQwenModels(models).flatMap((entry) => entry.models)
}

export function isChatModel(providerKey: string | undefined, model: string): boolean {
  if (providerKey !== 'qwen') return true
  return groupOf(model) !== 'other'
}

export function isBailianThirdPartyModel(model: string): boolean {
  return BAILIAN_THIRD_PARTY.test(model)
}

export function modelDisplayName(providerKey: string | undefined, model: string): string {
  if (providerKey !== 'qwen') return model
  return isBailianThirdPartyModel(model) ? `${model} · 百炼版` : model
}
