export interface ApplyResult {
  ok: boolean
  message?: string
}

export function parseChecksum(text: string): string | null {
  const match = text.match(/\b([a-f0-9]{64})\b/i)
  return match ? match[1].toLowerCase() : null
}

export function checksumMatches(expected: string, actual: string): boolean {
  return expected.trim().toLowerCase() === actual.trim().toLowerCase()
}

export function parseApplyResult(raw: string): ApplyResult | null {
  const value = raw.replace(/^\uFEFF/, '').trim()
  if (value === 'ok') return { ok: true }
  if (!value.startsWith('fail:')) return null
  const rollbackIndex = value.indexOf('rollback-failed:')
  const message = (rollbackIndex >= 0 ? value.slice(0, rollbackIndex) : value)
    .replace(/^fail:\s*/, '')
    .trim()
  return { ok: false, message: message || '未知错误' }
}
