import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import type { UsageBucket, UsageDay, UsageRecord, UsageSummary } from '../shared/types'

const MAX_RECORDS = 20000

function dayKey(ts: number): string {
  const d = new Date(ts)
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

export class UsageStore {
  private file: string
  private records: UsageRecord[] = []

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
      try {
        const tmp = `${this.file}.tmp`
        writeFileSync(tmp, this.records.map((record) => JSON.stringify(record)).join('\n'), 'utf8')
        renameSync(tmp, this.file)
      } catch {
        /* keep in-memory copy */
      }
    }
  }

  add(rec: UsageRecord): void {
    this.records.push(rec)
    try {
      appendFileSync(this.file, `${JSON.stringify(rec)}\n`, 'utf8')
    } catch {
      /* keep in-memory record even if disk write fails */
    }
  }

  newId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  }

  recent(limit = 50): UsageRecord[] {
    return this.records.slice(-limit).reverse()
  }

  summary(days = 14): UsageSummary {
    const now = new Date()
    const today = dayKey(now.getTime())
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1))
    const byModel = new Map<string, UsageBucket>()
    const byApp = new Map<string, UsageBucket>()
    const byDayMap = new Map<string, UsageDay>()
    let todayRequests = 0
    let todayTokens = 0
    let todayCost = 0
    let totalRequests = 0
    let totalTokens = 0
    let totalCost = 0
    let latencySum = 0
    let latencyCount = 0

    for (let i = 0; i < days; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
      const key = dayKey(d.getTime())
      byDayMap.set(key, { date: key, requests: 0, tokens: 0, cost: 0 })
    }

    for (const r of this.records) {
      const cost = r.cost || 0
      totalRequests += 1
      totalTokens += r.totalTokens || 0
      totalCost += cost
      const key = dayKey(r.ts)
      if (key === today) {
        todayRequests += 1
        todayTokens += r.totalTokens || 0
        todayCost += cost
      }
      if (r.ok) {
        latencySum += r.latencyMs
        latencyCount += 1
      }
      const model = byModel.get(r.model) ?? { key: r.model, requests: 0, tokens: 0, cost: 0 }
      model.requests += 1
      model.tokens += r.totalTokens || 0
      model.cost += cost
      byModel.set(r.model, model)

      const appName = r.programName || '未知应用'
      const app = byApp.get(appName) ?? { key: appName, requests: 0, tokens: 0, cost: 0 }
      app.requests += 1
      app.tokens += r.totalTokens || 0
      app.cost += cost
      byApp.set(appName, app)

      const day = byDayMap.get(key)
      if (day) {
        day.requests += 1
        day.tokens += r.totalTokens || 0
        day.cost += cost
      }
    }

    return {
      today: { requests: todayRequests, tokens: todayTokens, cost: todayCost },
      total: { requests: totalRequests, tokens: totalTokens, cost: totalCost },
      avgLatencyMs: latencyCount ? Math.round(latencySum / latencyCount) : 0,
      byModel: Array.from(byModel.values()).sort((a, b) => b.tokens - a.tokens),
      byApp: Array.from(byApp.values()).sort((a, b) => b.tokens - a.tokens),
      byDay: Array.from(byDayMap.values()),
      recent: this.recent(50)
    }
  }

  clear(): void {
    this.records = []
    try {
      writeFileSync(this.file, '', 'utf8')
    } catch {
      /* ignore */
    }
  }
}
