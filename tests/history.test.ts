import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { HistoryStore } from '../src/main/history.ts'
import type { HistoryRecord, HistorySummary } from '../src/shared/types.ts'

function record(id: string): HistoryRecord {
  return {
    id,
    conversationId: 'conversation-1',
    ts: Date.now(),
    mode: 'annotate',
    programName: '测试应用',
    providerName: 'Mock',
    model: 'mock',
    text: `选中的文字 ${id}`,
    answer: `回答 ${id}`,
    totalTokens: 10,
    cost: 0,
    ok: true
  }
}

function summary(id: string): HistorySummary {
  return {
    id,
    ts: Date.now(),
    providerName: 'Mock',
    model: 'mock',
    sourceCount: 2,
    fromTs: Date.now() - 1000,
    toTs: Date.now(),
    summary: '综合摘要',
    totalTokens: 20,
    cost: 0
  }
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'zhujie-history-test-'))
}

test('历史压缩提交成功会写入摘要并删除旧记录', () => {
  const dir = tempDir()
  try {
    const store = new HistoryStore(dir)
    store.add(record('a'))
    store.add(record('b'))
    store.add(record('c'))
    assert.equal(store.commitCompression(summary('s1'), new Set(['a', 'b'])), true)
    assert.deepEqual(store.list().map((item) => item.id), ['c'])
    assert.deepEqual(store.listSummaries().map((item) => item.id), ['s1'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('摘要写入失败时历史记录保持不变', () => {
  const dir = tempDir()
  try {
    const store = new HistoryStore(dir)
    store.add(record('a'))
    store.add(record('b'))
    mkdirSync(join(dir, 'history-summaries.json'))
    assert.equal(store.commitCompression(summary('s1'), new Set(['a'])), false)
    assert.deepEqual(store.list().map((item) => item.id), ['b', 'a'])
    assert.equal(store.listSummaries().length, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('记录重写失败时回滚摘要', () => {
  const dir = tempDir()
  try {
    const store = new HistoryStore(dir)
    store.add(record('a'))
    store.add(record('b'))
    const historyFile = join(dir, 'history.jsonl')
    rmSync(historyFile, { force: true })
    mkdirSync(historyFile)
    assert.equal(store.commitCompression(summary('s1'), new Set(['a'])), false)
    assert.deepEqual(store.list().map((item) => item.id), ['b', 'a'])
    assert.equal(store.listSummaries().length, 0)
    assert.equal(existsSync(join(dir, 'history-summaries.json')), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('清空写入失败时恢复内存中的历史和摘要', () => {
  const dir = tempDir()
  try {
    const store = new HistoryStore(dir)
    store.add(record('a'))
    store.addSummary(summary('s1'))
    rmSync(join(dir, 'history.jsonl'), { force: true })
    rmSync(join(dir, 'history-summaries.json'), { force: true })
    mkdirSync(join(dir, 'history.jsonl'))
    mkdirSync(join(dir, 'history-summaries.json'))
    assert.equal(store.clear(), false)
    assert.deepEqual(store.list().map((item) => item.id), ['a'])
    assert.deepEqual(store.listSummaries().map((item) => item.id), ['s1'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
