import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { HISTORY_LIMIT, type HistoryRecord, type HistorySummary } from '../shared/types.ts'

const MAX_SUMMARIES = 50
export const HISTORY_REWRITE_BATCH = 25

export class HistoryStore {
  private file: string
  private summaryFile: string
  private records: HistoryRecord[] = []
  private summaries: HistorySummary[] = []
  private pendingDrops = 0

  constructor(dir: string) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    this.file = join(dir, 'history.jsonl')
    this.summaryFile = join(dir, 'history-summaries.json')
    this.records = readRecords(this.file)
    this.summaries = readSummaries(this.summaryFile)
    if (this.records.length > HISTORY_LIMIT) {
      this.records = this.records.slice(-HISTORY_LIMIT)
      if (this.rewriteRecords()) this.pendingDrops = 0
    }
  }

  newId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  }

  add(record: HistoryRecord): boolean {
    this.records.push(record)
    if (this.records.length > HISTORY_LIMIT) {
      this.pendingDrops += this.records.length - HISTORY_LIMIT
      this.records = this.records.slice(-HISTORY_LIMIT)
      if (this.pendingDrops >= HISTORY_REWRITE_BATCH && this.rewriteRecords()) {
        this.pendingDrops = 0
        return true
      }
    }
    try {
      appendFileSync(this.file, `${JSON.stringify(record)}\n`, 'utf8')
      return true
    } catch (error) {
      console.error('[history] 追加记录失败，尝试重写并保留在内存中', error)
      return this.rewriteRecords()
    }
  }

  list(limit = HISTORY_LIMIT): HistoryRecord[] {
    return this.records.slice(-limit).reverse()
  }

  all(): HistoryRecord[] {
    return [...this.records]
  }

  get(id: string): HistoryRecord | undefined {
    return this.records.find((record) => record.id === id)
  }

  remove(id: string): boolean {
    return this.removeMany(new Set([id]))
  }

  removeMany(ids: Set<string>): boolean {
    if (ids.size === 0) return true
    const previous = this.records
    this.records = this.records.filter((record) => !ids.has(record.id))
    if (this.rewriteRecords()) {
      this.pendingDrops = 0
      return true
    }
    this.records = previous
    return false
  }

  listSummaries(): HistorySummary[] {
    return [...this.summaries].reverse()
  }

  addSummary(summary: HistorySummary): boolean {
    const previous = this.summaries
    const next = [...this.summaries, summary]
    this.summaries = next.length > MAX_SUMMARIES ? next.slice(-MAX_SUMMARIES) : next
    if (this.rewriteSummaries()) return true
    this.summaries = previous
    return false
  }

  commitCompression(summary: HistorySummary, ids: Set<string>): boolean {
    if (ids.size === 0) return false
    const previousSummaries = this.summaries
    const previousRecords = this.records
    const next = [...this.summaries, summary]
    this.summaries = next.length > MAX_SUMMARIES ? next.slice(-MAX_SUMMARIES) : next
    if (!this.rewriteSummaries()) {
      this.summaries = previousSummaries
      return false
    }

    this.records = this.records.filter((record) => !ids.has(record.id))
    if (!this.rewriteRecords()) {
      this.records = previousRecords
      this.summaries = previousSummaries
      this.rewriteSummaries()
      return false
    }
    this.pendingDrops = 0
    return true
  }

  clear(): boolean {
    const previousRecords = this.records
    const previousSummaries = this.summaries
    this.records = []
    this.summaries = []
    this.pendingDrops = 0
    const recordsOk = this.rewriteRecords()
    const summariesOk = this.rewriteSummaries()
    if (recordsOk && summariesOk) return true
    this.records = previousRecords
    this.summaries = previousSummaries
    this.rewriteRecords()
    this.rewriteSummaries()
    return false
  }

  private rewriteRecords(): boolean {
    return writeAtomic(this.file, this.records.map((record) => JSON.stringify(record)).join('\n'))
  }

  private rewriteSummaries(): boolean {
    return writeAtomic(this.summaryFile, JSON.stringify(this.summaries, null, 2))
  }
}

function readRecords(file: string): HistoryRecord[] {
  if (!existsSync(file)) return []
  const records: HistoryRecord[] = []
  try {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue
      try {
        records.push(JSON.parse(line) as HistoryRecord)
      } catch {
        /* skip malformed line */
      }
    }
  } catch {
    /* start empty if unreadable */
  }
  return records
}

function readSummaries(file: string): HistorySummary[] {
  if (!existsSync(file)) return []
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown
    return Array.isArray(parsed) ? (parsed as HistorySummary[]) : []
  } catch {
    return []
  }
}

function writeAtomic(file: string, content: string): boolean {
  try {
    const tmp = `${file}.tmp`
    writeFileSync(tmp, content, 'utf8')
    renameSync(tmp, file)
    return true
  } catch (error) {
    console.error('[history] 写入失败，保留内存副本', error)
    return false
  }
}
