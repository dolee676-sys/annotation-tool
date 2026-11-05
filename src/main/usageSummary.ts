import type { UsageBucket, UsageDay, UsageRecord, UsageSummary } from '../shared/types'

function dayKey(ts: number): string {
  const d = new Date(ts)
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

export function summarizeUsage(
  records: UsageRecord[],
  options: { days?: number; recentLimit?: number; now?: Date } = {}
): UsageSummary {
  const days = options.days ?? 14
  const recentLimit = options.recentLimit ?? 50
  const now = options.now ?? new Date()
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

  for (const record of records) {
    const cost = record.cost || 0
    totalRequests += 1
    totalTokens += record.totalTokens || 0
    totalCost += cost
    const key = dayKey(record.ts)
    if (key === today) {
      todayRequests += 1
      todayTokens += record.totalTokens || 0
      todayCost += cost
    }
    if (record.ok && Number.isFinite(record.latencyMs)) {
      latencySum += record.latencyMs
      latencyCount += 1
    }
    const model = byModel.get(record.model) ?? { key: record.model, requests: 0, tokens: 0, cost: 0 }
    model.requests += 1
    model.tokens += record.totalTokens || 0
    model.cost += cost
    byModel.set(record.model, model)

    const appName = record.programName || '未知应用'
    const app = byApp.get(appName) ?? { key: appName, requests: 0, tokens: 0, cost: 0 }
    app.requests += 1
    app.tokens += record.totalTokens || 0
    app.cost += cost
    byApp.set(appName, app)

    const day = byDayMap.get(key)
    if (day) {
      day.requests += 1
      day.tokens += record.totalTokens || 0
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
    recent: records.slice(-recentLimit).reverse()
  }
}
