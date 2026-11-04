import { app } from 'electron'
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { HistoryRecord } from '../shared/types'

const MAX_RECORDS = 1000

export class HistoryStore {
  private file: string
  private records: HistoryRecord[] = []

  constructor() {
    const dir = app.getPath('userData')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    this.file = join(dir, 'history.jsonl')
    if (existsSync(this.file)) {
      try {
        for (const line of readFileSync(this.file, 'utf8').split('\n')) {
          if (!line.trim()) continue
          try {
            this.records.push(JSON.parse(line) as HistoryRecord)
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
      this.rewrite()
    }
  }

  newId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  }

  add(record: HistoryRecord): void {
    this.records.push(record)
    if (this.records.length > MAX_RECORDS) this.records = this.records.slice(-MAX_RECORDS)
    try {
      appendFileSync(this.file, `${JSON.stringify(record)}\n`, 'utf8')
    } catch {
      /* keep in-memory copy */
    }
  }

  list(limit = 200): HistoryRecord[] {
    return this.records.slice(-limit).reverse()
  }

  remove(id: string): void {
    this.records = this.records.filter((record) => record.id !== id)
    this.rewrite()
  }

  clear(): void {
    this.records = []
    this.rewrite()
  }

  private rewrite(): void {
    try {
      const tmp = `${this.file}.tmp`
      writeFileSync(tmp, this.records.map((record) => JSON.stringify(record)).join('\n'), 'utf8')
      renameSync(tmp, this.file)
    } catch {
      /* ignore disk errors */
    }
  }
}
