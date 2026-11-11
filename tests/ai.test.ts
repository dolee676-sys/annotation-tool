import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import test from 'node:test'
import { chat, listModels, type ChatOptions } from '../src/main/ai.ts'
import type { StoredProvider } from '../src/main/settings.ts'

type Handler = (req: IncomingMessage, res: ServerResponse) => void

async function withServer(handler: Handler, run: (port: number) => Promise<void>): Promise<void> {
  const server = createServer(handler)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  try {
    await run(port)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

function provider(port: number, kind: 'openai' | 'ollama'): StoredProvider {
  return {
    id: 'test',
    name: 'Mock',
    kind,
    baseUrl: kind === 'ollama' ? `http://127.0.0.1:${port}` : `http://127.0.0.1:${port}/v1`,
    models: ['mock'],
    builtin: false,
    priceIn: 0,
    priceOut: 0
  }
}

function options(port: number, kind: 'openai' | 'ollama', signal = new AbortController().signal): ChatOptions {
  return {
    provider: provider(port, kind),
    apiKey: '',
    model: 'mock',
    system: 'system',
    user: 'user',
    signal,
    onDelta: () => undefined
  }
}

test('OpenAI SSE 会拼接正常分片、忽略坏行并读取 usage', async () => {
  await withServer(
    (req, res) => {
      if (req.method !== 'POST' || !req.url?.startsWith('/v1/chat/completions')) {
        res.writeHead(404).end()
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write('data: {"choices":[{"delta":{"content":"你"}}]}\n\n')
      res.write('data: {not-json}\n\n')
      res.write('data: {"choices":[{"delta":{"content":"好"}}]}\n\n')
      res.write(
        `data: ${JSON.stringify({
          choices: [],
          usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 }
        })}\n\n`
      )
      res.write('data: [DONE]\n\n')
      res.end()
    },
    async (port) => {
      const result = await chat(options(port, 'openai'))
      assert.equal(result.text, '你好')
      assert.equal(result.promptTokens, 12)
      assert.equal(result.completionTokens, 8)
      assert.equal(result.totalTokens, 20)
      assert.equal(result.estimated, false)
    }
  )
})

test('OpenAI 401 会带出服务商错误信息', async () => {
  await withServer(
    (req, res) => {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'invalid api key' } }))
    },
    async (port) => {
      await assert.rejects(chat(options(port, 'openai')), /invalid api key/)
    }
  )
})

test('Ollama NDJSON 会拼接正常行、忽略坏行并读取用量', async () => {
  await withServer(
    (req, res) => {
      if (req.method !== 'POST' || !req.url?.startsWith('/api/chat')) {
        res.writeHead(404).end()
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
      res.write(`${JSON.stringify({ message: { content: '注' }, done: false })}\n`)
      res.write('{broken-json}\n')
      res.write(`${JSON.stringify({ message: { content: '解' }, done: false })}\n`)
      res.write(`${JSON.stringify({ done: true, prompt_eval_count: 10, eval_count: 5 })}\n`)
      res.end()
    },
    async (port) => {
      const result = await chat(options(port, 'ollama'))
      assert.equal(result.text, '注解')
      assert.equal(result.totalTokens, 15)
      assert.equal(result.estimated, false)
    }
  )
})

test('外部 AbortSignal 能中止仍在流式返回的请求', async () => {
  await withServer(
    (req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write('data: {"choices":[{"delta":{"content":"慢"}}]}\n\n')
      // 不结束响应，等待客户端 abort
    },
    async (port) => {
      const controller = new AbortController()
      const pending = chat(options(port, 'openai', controller.signal))
      setTimeout(() => controller.abort(), 80)
      await assert.rejects(pending, (error: unknown) => {
        return error instanceof Error && error.name === 'AbortError'
      })
    }
  )
})

test('模型列表接口能解析 OpenAI 与 Ollama 两种返回', async () => {
  await withServer(
    (req, res) => {
      if (req.url?.startsWith('/v1/models')) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ data: [{ id: 'a' }, { id: 'b' }] }))
        return
      }
      if (req.url?.startsWith('/api/tags')) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ models: [{ name: 'c' }] }))
        return
      }
      res.writeHead(404).end()
    },
    async (port) => {
      const openai = await listModels(provider(port, 'openai'), '')
      const ollama = await listModels(provider(port, 'ollama'), '')
      assert.deepEqual(openai, ['a', 'b'])
      assert.deepEqual(ollama, ['c'])
    }
  )
})
