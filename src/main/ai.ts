import type { StoredProvider } from './settings'

export interface ChatOptions {
  provider: StoredProvider
  apiKey: string
  model: string
  system: string
  user: string
  signal: AbortSignal
  onDelta: (text: string) => void
}

export interface ChatResult {
  text: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  estimated: boolean
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0'])

export function isLocalBaseUrl(baseUrl: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(baseUrl).hostname.toLowerCase())
  } catch {
    return false
  }
}

export function estimateTokens(text: string): number {
  let cjk = 0
  let other = 0
  for (const ch of text) {
    if (/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(ch)) cjk += 1
    else other += 1
  }
  return Math.max(1, Math.round(cjk * 1.1 + other / 4))
}

function trimBase(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '')
}

function joinUrl(baseUrl: string, path: string): string {
  return `${trimBase(baseUrl)}${path}`
}

function authHeaders(apiKey: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  return headers
}

async function readError(res: Response): Promise<string> {
  try {
    const text = await res.text()
    try {
      const json = JSON.parse(text) as { error?: { message?: string }; message?: string }
      return json.error?.message || json.message || text.slice(0, 400)
    } catch {
      return text.slice(0, 400) || `HTTP ${res.status}`
    }
  } catch {
    return `HTTP ${res.status}`
  }
}

export async function listModels(
  provider: StoredProvider,
  apiKey: string,
  timeoutMs = 8000
): Promise<string[]> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const url =
      provider.kind === 'ollama'
        ? joinUrl(trimBase(provider.baseUrl).replace(/\/v1$/, ''), '/api/tags')
        : joinUrl(provider.baseUrl, '/models')
    const res = await fetch(url, { headers: authHeaders(apiKey), signal: controller.signal })
    if (!res.ok) throw new Error(await readError(res))
    const json = (await res.json()) as {
      models?: Array<{ name?: string; model?: string }>
      data?: Array<{ id?: string }>
    }
    if (provider.kind === 'ollama') {
      return (json.models ?? []).map((m) => m.name || m.model || '').filter(Boolean)
    }
    return (json.data ?? []).map((m) => m.id || '').filter(Boolean)
  } finally {
    clearTimeout(timer)
  }
}

async function chatOllama(options: ChatOptions): Promise<ChatResult> {
  const base = trimBase(options.provider.baseUrl).replace(/\/v1$/, '')
  const res = await fetch(joinUrl(base, '/api/chat'), {
    method: 'POST',
    headers: authHeaders(options.apiKey),
    signal: options.signal,
    body: JSON.stringify({
      model: options.model,
      stream: true,
      messages: [
        { role: 'system', content: options.system },
        { role: 'user', content: options.user }
      ],
      options: { temperature: 0.2, num_predict: 700 }
    })
  })
  if (!res.ok) throw new Error(await readError(res))
  if (!res.body) throw new Error('模型服务没有返回内容')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  let promptTokens = 0
  let completionTokens = 0
  let gotUsage = false

  const handleLine = (line: string): void => {
    const trimmed = line.trim()
    if (!trimmed) return
    let obj: {
      error?: string
      message?: { content?: string }
      done?: boolean
      prompt_eval_count?: number
      eval_count?: number
    }
    try {
      obj = JSON.parse(trimmed)
    } catch {
      return
    }
    if (obj.error) throw new Error(obj.error)
    if (obj.message?.content) {
      text += obj.message.content
      options.onDelta(obj.message.content)
    }
    if (obj.done) {
      promptTokens = obj.prompt_eval_count ?? 0
      completionTokens = obj.eval_count ?? 0
      gotUsage = promptTokens > 0 || completionTokens > 0
    }
  }

  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let idx = buffer.indexOf('\n')
    while (idx >= 0) {
      handleLine(buffer.slice(0, idx))
      buffer = buffer.slice(idx + 1)
      idx = buffer.indexOf('\n')
    }
  }
  buffer += decoder.decode()
  handleLine(buffer)

  if (!text.trim()) throw new Error('模型没有返回可显示的内容')
  if (!gotUsage) {
    const promptTokensEst = estimateTokens(`${options.system}\n${options.user}`)
    const completionTokensEst = estimateTokens(text)
    return {
      text,
      promptTokens: promptTokensEst,
      completionTokens: completionTokensEst,
      totalTokens: promptTokensEst + completionTokensEst,
      estimated: true
    }
  }
  return {
    text,
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    estimated: false
  }
}

async function chatOpenAI(options: ChatOptions): Promise<ChatResult> {
  const res = await fetch(joinUrl(options.provider.baseUrl, '/chat/completions'), {
    method: 'POST',
    headers: authHeaders(options.apiKey),
    signal: options.signal,
    body: JSON.stringify({
      model: options.model,
      stream: true,
      stream_options: { include_usage: true },
      temperature: 0.2,
      max_tokens: 700,
      messages: [
        { role: 'system', content: options.system },
        { role: 'user', content: options.user }
      ]
    })
  })
  if (!res.ok) throw new Error(await readError(res))
  if (!res.body) throw new Error('模型服务没有返回内容')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  let promptTokens = 0
  let completionTokens = 0
  let gotUsage = false

  const handleLine = (line: string): void => {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) return
    const payload = trimmed.slice(5).trim()
    if (!payload || payload === '[DONE]') return
    let obj: {
      error?: { message?: string }
      choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }>
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null
    }
    try {
      obj = JSON.parse(payload)
    } catch {
      return
    }
    if (obj.error?.message) throw new Error(obj.error.message)
    const choice = obj.choices?.[0]
    const piece = choice?.delta?.content ?? choice?.message?.content ?? ''
    if (piece) {
      text += piece
      options.onDelta(piece)
    }
    if (obj.usage) {
      promptTokens = obj.usage.prompt_tokens ?? 0
      completionTokens = obj.usage.completion_tokens ?? 0
      gotUsage = true
    }
  }

  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let idx = buffer.indexOf('\n')
    while (idx >= 0) {
      handleLine(buffer.slice(0, idx))
      buffer = buffer.slice(idx + 1)
      idx = buffer.indexOf('\n')
    }
  }
  buffer += decoder.decode()
  handleLine(buffer)

  if (!text.trim()) throw new Error('模型没有返回可显示的内容')
  if (!gotUsage) {
    const promptTokensEst = estimateTokens(`${options.system}\n${options.user}`)
    const completionTokensEst = estimateTokens(text)
    return {
      text,
      promptTokens: promptTokensEst,
      completionTokens: completionTokensEst,
      totalTokens: promptTokensEst + completionTokensEst,
      estimated: true
    }
  }
  return {
    text,
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    estimated: false
  }
}

export async function chat(options: ChatOptions): Promise<ChatResult> {
  const controller = new AbortController()
  const onAbort = (): void => controller.abort()
  if (options.signal.aborted) controller.abort()
  else options.signal.addEventListener('abort', onAbort, { once: true })
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, 120_000)
  try {
    const internal = { ...options, signal: controller.signal }
    if (options.provider.kind === 'ollama') return await chatOllama(internal)
    return await chatOpenAI(internal)
  } catch (error) {
    if (timedOut) throw new Error('模型响应超时（120 秒），请确认本机模型仍在运行。')
    throw error
  } finally {
    clearTimeout(timer)
    options.signal.removeEventListener('abort', onAbort)
  }
}
