import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { compressHistory } from '../src/main/compress.ts'
import { HistoryStore } from '../src/main/history.ts'
import { startMockServer } from '../src/main/selftestMock.ts'
import type { UsageStore } from '../src/main/usage.ts'
import { HISTORY_LIMIT } from '../src/shared/types.ts'
import type { StoredProvider } from '../src/main/settings.ts'

test('历史压缩提交失败时不会删除旧记录', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zhujie-compress-test-'))
  const mock = await startMockServer()
  try {
    const history = new HistoryStore(dir)
    for (let index = 0; index < HISTORY_LIMIT; index += 1) {
      history.add({
        id: `record-${index}`,
        conversationId: `conversation-${index}`,
        ts: Date.now() + index,
        mode: 'ask',
        programName: '测试应用',
        providerName: 'Mock',
        model: 'mock-annotator',
        text: `第 ${index} 条选中的文字`,
        question: `第 ${index} 个问题`,
        answer: `第 ${index} 条回答，包含足够的内容用于压缩。`,
        totalTokens: 10,
        cost: 0,
        ok: true
      })
    }

    mkdirSync(join(dir, 'history-summaries.json'))
    const provider: StoredProvider = {
      id: 'mock',
      name: 'Mock',
      kind: 'openai',
      baseUrl: `http://127.0.0.1:${mock.port}/v1`,
      models: ['mock-annotator'],
      builtin: false,
      priceIn: 0,
      priceOut: 0
    }
    const usage = {
      newId: () => 'usage-1',
      add: () => undefined
    } as unknown as UsageStore

    await assert.rejects(
      compressHistory({
        history,
        usage,
        provider,
        apiKey: '',
        model: 'mock-annotator'
      }),
      /旧记录已保留/
    )
    assert.equal(history.list().length, HISTORY_LIMIT)
    assert.equal(history.listSummaries().length, 0)
  } finally {
    mock.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
