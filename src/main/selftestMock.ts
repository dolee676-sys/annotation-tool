import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

const ANSWER = `### 一句话

这句话说的是：模型不会平均看待每个词，而是按相关性分配注意力。

### 要点

- **注意力权重**决定了当前词从其他词那里取多少信息。
- 权重由 Query 与 Key 的相似度计算，再经 Softmax 归一化。
- 这是一种**动态**加权，不同上下文会得到不同权重。

> 容易误解的地方：权重高不等于语义上"最重要"，它只表示在当前任务里被读取得更多。`

export interface MockServer {
  port: number
  close: () => void
}

export function startMockServer(): Promise<MockServer> {
  return new Promise((resolve, reject) => {
    const server: Server = createServer((req, res) => {
      const url = req.url || ''
      if (req.method === 'GET' && url.startsWith('/v1/models')) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ data: [{ id: 'mock-annotator' }, { id: 'mock-annotator-2' }] }))
        return
      }

      if (req.method === 'GET' && url.startsWith('/api/tags')) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ models: [{ name: 'mock-ollama' }] }))
        return
      }

      if (req.method === 'POST' && url.startsWith('/api/chat')) {
        req.resume()
        req.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
          const pieces = ANSWER.match(/[\s\S]{1,20}/g) ?? [ANSWER]
          let index = 0
          const timer = setInterval(() => {
            if (index < pieces.length) {
              res.write(`${JSON.stringify({ message: { content: pieces[index] }, done: false })}\n`)
              index += 1
              return
            }
            clearInterval(timer)
            res.write(`${JSON.stringify({ done: true, prompt_eval_count: 150, eval_count: 90 })}\n`)
            res.end()
          }, 10)
        })
        return
      }

      if (req.method === 'POST' && url.startsWith('/v1/chat/completions')) {
        let body = ''
        req.on('data', (chunk) => {
          body += chunk
        })
        req.on('end', () => {
          void body
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive'
          })
          const pieces = ANSWER.match(/[\s\S]{1,18}/g) ?? [ANSWER]
          let index = 0
          const timer = setInterval(() => {
            if (index < pieces.length) {
              const chunk = {
                choices: [{ delta: { content: pieces[index] }, index: 0 }]
              }
              res.write(`data: ${JSON.stringify(chunk)}\n\n`)
              index += 1
              return
            }
            clearInterval(timer)
            res.write(
              `data: ${JSON.stringify({
                choices: [],
                usage: { prompt_tokens: 186, completion_tokens: 214, total_tokens: 400 }
              })}\n\n`
            )
            res.write('data: [DONE]\n\n')
            res.end()
          }, 12)
        })
        return
      }

      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'not found' } }))
    })

    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo
      resolve({
        port: address.port,
        close: () => server.close()
      })
    })
  })
}
