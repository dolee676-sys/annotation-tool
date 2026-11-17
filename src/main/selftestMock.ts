import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

const ANSWER = `### 一句话

这句话说的是：模型不会平均看待每个词，而是按相关性分配注意力。

### 要点

- **注意力权重**决定了当前词从其他词那里取多少信息。
- 权重由 Query 与 Key 的相似度计算，再经 Softmax 归一化。
- 这是一种**动态**加权，不同上下文会得到不同权重。

> 容易误解的地方：权重高不等于语义上"最重要"，它只表示在当前任务里被读取得更多。`

const PROGRAMMING_ANSWER = `### 1. 一句话人话定义
自测概念：它是一段用于验证编程模式六步结构的示例回答。

### 2. 生活化比喻
像做菜前先把食材切好：准备动作让后续步骤更顺；**边界**：它不负责调味，不能替代真正的业务逻辑。

### 3. 为什么需要它（痛点）
没有它时，代码会把准备和执行混在一起，改一处牵连多处。

### 4. 代码对比（锚点）
反例：
\`\`\`js
doEverything()
\`\`\`
正例：
\`\`\`js
prepare()
execute()
\`\`\`

### 5. 底层真相（去魅）
它本质上是一次职责拆分，运行时仍然按顺序执行；这是简化说明。

### 6. 避坑指南
错误表现：把准备逻辑塞进执行函数；原因：职责边界不清；正确做法：先拆分，再分别测试。`

const BROKEN_PROGRAMMING_ANSWER = `### 一句话
这本来应该是一个六步讲解，但这次生成不稳定。

### 要点
先给结论，但缺少完整结构。`

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
          let system = ''
          let user = ''
          try {
            const parsed = JSON.parse(body) as {
              messages?: Array<{ role?: string; content?: string }>
            }
            system = parsed.messages?.find((message) => message.role === 'system')?.content ?? ''
            user = parsed.messages?.find((message) => message.role === 'user')?.content ?? ''
          } catch {
            /* keep default answer */
          }
          const programming = system.includes('资深技术专家')
          const repair = user.includes('[PREVIOUS ANSWER]') || user.includes('上一次回答')
          const answer = programming
            ? repair
              ? PROGRAMMING_ANSWER
              : BROKEN_PROGRAMMING_ANSWER
            : ANSWER
          const finishReason = programming && !repair ? 'length' : 'stop'
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive'
          })
          const pieces = answer.match(/[\s\S]{1,18}/g) ?? [answer]
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
                choices: [{ delta: {}, finish_reason: finishReason }]
              })}\n\n`
            )
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
