/** 从 App.tsx 抽出的纯工具函数：不依赖组件状态，行为与抽出前一致。 */
import { DEFAULT_PROMPT, DEFAULT_PROMPT_EN, type HistoryRecord } from '../../shared/types'
import { formatUsageMultiplier } from '../../shared/pricing'
import { getI18nLocale, t } from './i18n'

export const fmtNum = (n: number): string => n.toLocaleString(getI18nLocale())

export const fmtTime = (ts: number): string =>
  new Date(ts).toLocaleString(getI18nLocale(), {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })

export const readableError = (error: unknown): string => {
  const raw = error instanceof Error ? error.message : String(error)
  return raw.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

export const multiplierSuffix = (value: number | null): string => {
  if (value === null) return ''
  if (value === 0) return t('（免费）')
  return `（${formatUsageMultiplier(value)}）`
}

export const promptForLocale = (prompt: string, locale: string): string => {
  const value = prompt.trim()
  if (locale === 'en-US' && value === DEFAULT_PROMPT.trim()) return DEFAULT_PROMPT_EN
  if (locale === 'zh-CN' && value === DEFAULT_PROMPT_EN.trim()) return DEFAULT_PROMPT
  return prompt
}

export const normalizeAppName = (value: string): string =>
  value.trim().toLowerCase().replace(/\.exe$/i, '')

export function historyThreadKey(record: HistoryRecord): string {
  return record.conversationId ?? `${record.programName}\u0000${record.text}`
}

export function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return t('刚刚')
  if (minutes < 60) return t('{count} 分钟前', { count: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('{count} 小时前', { count: hours })
  return t('{count} 天前', { count: Math.floor(hours / 24) })
}
