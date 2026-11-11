import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import type { UsageRecord, UsageSummary } from '../shared/types'
import { summarizeUsage } from './usageSummary'

const MAX_RECORDS = 20000
const REWRITE_BATCH = 200

export class UsageStore {
  private file: string
  private records: UsageRecord[] = []
  private pendingDrops = 0

  constructor() {
    const dir = app.getPath('userData')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    this.file = join(dir, 'usage.jsonl')
    if (existsSync(this.file)) {
      try {
        const lines = readFileSync(this.file, 'utf8').split('\n')
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            this.records.push(JSON.parse(line) as UsageRecord)
          } catch {
            /* skip malformed line */
          }
        }
      } catch {
        /* start empty if unreadable */
      }
    }
    if (this.records.length > MAX_RECORDS) {
      this.records = this.records.slice(-MAX_RECORDS)
      if (this.rewrite()) this.pendingDrops = 0
    }
  }

  add(rec: UsageRecord): void {
    this.records.push(rec)
    if (this.records.length > MAX_RECORDS) {
      this.pendingDrops += this.records.length - MAX_RECORDS
      this.records = this.records.slice(-MAX_RECORDS)
      if (this.pendingDrops >= REWRITE_BATCH && this.rewrite()) {
        this.pendingDrops = 0
        return
      }
    }
    try {
      appendFileSync(this.file, `${JSON.stringify(rec)}\n`, 'utf8')
    } catch (error) {
      console.error('[usage] 追加用量失败，保留在内存中', error)
    }
  }

  private rewrite(): boolean {
    try {
      const tmp = `${this.file}.tmp`
      writeFileSync(tmp, this.records.map((record) => JSON.stringify(record)).join('\n'), 'utf8')
      renameSync(tmp, this.file)
      return true
    } catch (error) {
      console.error('[usage] 写入失败，保留内存副本', error)
      return false
    }
  }

  newId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  }

  summary(days = 14): UsageSummary {
    return summarizeUsage(this.records, { days })
  }

  /**
   * 先落盘、成功后再清空内存：之前是先清空内存再写盘，写盘失败时内存已空，
   * 界面却会显示“用量记录已清空”，重启后记录又出现。
   * 返回 false 时调用方应报错，不要谎称已清空。
   */
  clear(): boolean {
    const kept = this.records
    const keptDrops = this.pendingDrops
    this.records = []
    this.pendingDrops = 0
    if (this.rewrite()) return true
    this.records = kept
    this.pendingDrops = keptDrops
    return false
  }
}
