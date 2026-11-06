import { createHash } from 'node:crypto'
import { createReadStream, rmSync } from 'node:fs'

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

export function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(file)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

export async function verifyDownloadedFile(file: string, expected: string): Promise<boolean> {
  const actual = await sha256File(file)
  if (checksumMatches(expected, actual)) return true
  rmSync(file, { force: true })
  return false
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
