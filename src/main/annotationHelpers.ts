/**
 * 从 index.ts 抽出的纯逻辑：不碰 Electron、不读 settings 单例、不发 IPC。
 * 行为与抽出前完全一致（参数化了原来直接读单例的部分），由 tests/modelOptions.test.ts 覆盖。
 */
import { isLocalBaseUrl } from './ai.ts'
import type { Point } from './selectionCore.ts'
import type { StoredProvider, StoredSettings } from './settings.ts'
import { isChatModel } from '../shared/modelCatalog.ts'
import { isFreeModel } from '../shared/presets.ts'
import { usageMultiplier } from '../shared/pricing.ts'
import type { PanelMode, PanelModelOption, ProviderView } from '../shared/types.ts'

/** 注 / 问小框无操作自动消失的时长。原来是 15000ms：选中一段文字后小框要在屏幕上挂 15 秒才消失，用户体感就是“好一会才能消失”。 */
export const CHIP_AUTO_HIDE_MS = 3000

export interface ChipSelection {
  text: string
  anchor: Point
}

/**
 * 重复选区事件不重新弹小框、不重置自动隐藏计时：同一段文字、同一位置、
 * 且小框还在展示时，直接复用正在展示的那个。
 * 否则拖选 / 点击产生的重复 text-selection 事件会反复重置计时，小框迟迟不消失；
 * 点小框外面时 240ms 后的延迟隐藏也会被重复事件取消（chipShowId 被顶掉）。
 * 小框已经自动藏起时返回 false，让调用方重新弹。
 */
export function isSameChipSelection(
  prev: ChipSelection | null,
  text: string,
  anchor: Point,
  chipVisible: boolean
): boolean {
  if (!chipVisible || !prev) return false
  return prev.text === text && prev.anchor.x === anchor.x && prev.anchor.y === anchor.y
}

export function normalizeApp(name: string): string {
  return name.trim().toLowerCase().replace(/\.exe$/, '')
}

/** 白名单模式下当前应用是否允许划词。原来直接读 settings 单例，现由调用方传入。 */
export function isAppAllowed(s: StoredSettings, programName: string): boolean {
  if (s.filterMode === 'all') return true
  const target = normalizeApp(programName)
  if (!target) return false
  return s.whitelist.some((entry) => {
    const item = normalizeApp(entry)
    return item.length > 0 && item === target
  })
}

function toModelOption(
  providerId: string,
  providerName: string,
  presetId: string,
  model: string,
  local: boolean,
  priceIn: number,
  priceOut: number,
  useFallback: boolean,
  freePresetId?: string
): PanelModelOption {
  return {
    providerId,
    providerName,
    presetId,
    model,
    // 免费判断用的 presetId 与原来逐字一致：主循环传 provider.presetId，
    // 补当前模型那支传 presetId ?? id。
    free: isFreeModel(freePresetId ?? presetId, model, local),
    multiplier: usageMultiplier({
      model,
      local,
      fallbackIn: priceIn,
      fallbackOut: priceOut,
      useFallback
    })
  }
}

/**
 * 面板模型下拉列表：只收有 Key 的云端服务商和本机服务商；当前正在用的模型
 * 即使不在列表里也会补到最前面，保证面板不会突然失去当前模型。
 * providers / getProvider 由调用方传入（原来直接读 settings 单例）。
 */
export function buildModelOptions(
  providers: ProviderView[],
  getProvider: (id: string) => StoredProvider | undefined,
  currentProviderId: string,
  currentModel: string
): PanelModelOption[] {
  const options: PanelModelOption[] = []
  for (const provider of providers) {
    if (!isLocalBaseUrl(provider.baseUrl) && !provider.hasKey) continue
    const local = isLocalBaseUrl(provider.baseUrl)
    const providerKey = provider.presetId ?? provider.id
    for (const model of provider.models) {
      if (!isChatModel(providerKey, model)) continue
      options.push(
        toModelOption(
          provider.id,
          provider.name,
          providerKey,
          model,
          local,
          provider.priceIn,
          provider.priceOut,
          !provider.builtin,
          provider.presetId
        )
      )
    }
  }
  if (!options.some((o) => o.providerId === currentProviderId && o.model === currentModel)) {
    const provider = getProvider(currentProviderId)
    if (provider && currentModel) {
      const local = isLocalBaseUrl(provider.baseUrl)
      options.unshift(
        toModelOption(
          provider.id,
          provider.name,
          provider.presetId ?? provider.id,
          currentModel,
          local,
          provider.priceIn,
          provider.priceOut,
          !provider.builtin
        )
      )
    }
  }
  return options
}

export interface AnnotationIdentity {
  mode: PanelMode
  providerId: string
  model: string
}

/** 面板重置时发给渲染进程的载荷。localOnly 由调用方传入（原来直接读 settings 单例）。 */
export function panelResetPayload(
  a: AnnotationIdentity,
  providerName: string,
  localOnly: boolean,
  followUp = false,
  question?: string
): Record<string, unknown> {
  return {
    mode: a.mode,
    followUp,
    question,
    providerId: a.providerId,
    providerName,
    model: a.model,
    localOnly
  }
}

/** 去掉全部空白后比对：选中文本与上下文做包含判断时用。 */
export function normalizeForMatch(value: string): string {
  return value.replace(/\s+/g, '').trim()
}
