import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { SettingsStore } from '../src/main/settings.ts'

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'zhujie-settings-test-'))
}

const codec = {
  encrypt: (key: string) => `test:${Buffer.from(key, 'utf8').toString('base64')}`,
  decrypt: (value: string) =>
    value.startsWith('test:') ? Buffer.from(value.slice(5), 'base64').toString('utf8') : ''
}

test('设置写入失败时返回 false 并保留错误信息', () => {
  const dir = tempDir()
  try {
    const store = new SettingsStore(dir)
    const file = join(dir, 'settings.json')
    rmSync(file, { force: true })
    mkdirSync(file)
    assert.equal(store.flush(), false)
    assert.ok(store.getLastWriteError())
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('旧设置迁移为中文，新设置跟随系统语言', () => {
  const dir = tempDir()
  try {
    const fresh = new SettingsStore(dir)
    assert.equal(fresh.get().language, 'system')
    assert.equal(fresh.get().answerLanguage, 'auto')
    assert.equal(fresh.get().prompt.length > 0, true)

    const file = join(dir, 'settings.json')
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    delete raw.language
    delete raw.answerLanguage
    writeFileSync(file, JSON.stringify(raw), 'utf8')

    const migrated = new SettingsStore(dir)
    assert.equal(migrated.get().language, 'zh-CN')
    assert.equal(migrated.get().answerLanguage, 'auto')

    migrated.update({ language: 'en-US', answerLanguage: 'en-US' })
    assert.equal(migrated.get().language, 'en-US')
    assert.equal(migrated.get().answerLanguage, 'en-US')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('百炼模型列表会删除不能文字对话的模型', () => {
  const dir = tempDir()
  try {
    const store = new SettingsStore(dir)
    store.setModels('qwen', [
      'qwen3.8-flash',
      'qwen-image-3.0',
      'qwen-audio-3.0-asr-flash',
      'deepseek-v4-pro',
      'kimi-k3'
    ])
    assert.deepEqual(store.getProvider('qwen')?.models, [
      'qwen3.8-flash',
      'deepseek-v4-pro',
      'kimi-k3'
    ])
    assert.equal(store.flush(), true)

    const file = join(dir, 'settings.json')
    const raw = JSON.parse(readFileSync(file, 'utf8')) as {
      providers: Array<{ id: string; models: string[] }>
    }
    const qwen = raw.providers.find((provider) => provider.id === 'qwen')
    assert.ok(qwen)
    qwen.models = ['qwen3.8-flash', 'qwen-image-3.0', 'qwen3.5-ocr']
    writeFileSync(file, JSON.stringify(raw), 'utf8')

    const reopened = new SettingsStore(dir)
    assert.deepEqual(reopened.getProvider('qwen')?.models, ['qwen3.8-flash'])
    const persisted = JSON.parse(readFileSync(file, 'utf8')) as {
      providers: Array<{ id: string; models: string[] }>
    }
    assert.deepEqual(
      persisted.providers.find((provider) => provider.id === 'qwen')?.models,
      ['qwen3.8-flash']
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('损坏的 providers（models 不是数组、条目不是对象、默认指向不存在的 id）加载时被清理、不丢整份设置', () => {
  const dir = tempDir()
  try {
    const store = new SettingsStore(dir)
    const file = join(dir, 'settings.json')
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    raw.providers = [
      { id: 'ollama', name: 'Ollama', kind: 'ollama', baseUrl: 'http://127.0.0.1:11434', models: 'oops' },
      null,
      'not-an-object',
      { id: 'deepseek', name: 'DeepSeek', kind: 'openai', baseUrl: 'https://api.deepseek.com/v1', models: ['a', 1, null] }
    ]
    raw.defaultProviderId = 'ghost'
    raw.defaultModel = 'ghost-model'
    writeFileSync(file, JSON.stringify(raw), 'utf8')

    const reopened = new SettingsStore(dir)
    assert.deepEqual(reopened.getProvider('ollama')?.models, [])
    assert.deepEqual(reopened.getProvider('deepseek')?.models, ['a'])
    // 悬空默认回到 ollama；默认服务商补齐后视图渲染也不会崩
    assert.equal(reopened.get().defaultProviderId, 'ollama')
    assert.equal(reopened.get().defaultModel, '')
    assert.doesNotThrow(() => reopened.getProvidersView())
    // 整份设置没被当成损坏备份丢掉
    assert.equal(reopened.get().enabled, true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('update() 不接受不存在的默认服务商 id', () => {
  const dir = tempDir()
  try {
    const store = new SettingsStore(dir)
    store.update({ defaultProviderId: 'no-such-provider' })
    assert.equal(store.get().defaultProviderId, 'ollama')
    store.update({ defaultProviderId: 'deepseek' })
    assert.equal(store.get().defaultProviderId, 'deepseek')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('设置中的 API Key 通过注入的加密器保存和读取', () => {
  const dir = tempDir()
  try {
    const store = new SettingsStore(dir, codec)
    store.saveProvider({
      id: 'custom',
      name: '测试接口',
      kind: 'openai',
      baseUrl: 'http://127.0.0.1:9999/v1',
      apiKey: 'secret-key'
    })
    assert.equal(store.flush(), true)
    const raw = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')) as {
      providers: Array<{ id: string; keyEnc?: string }>
    }
    const saved = raw.providers.find((provider) => provider.id === 'custom')
    assert.ok(saved?.keyEnc?.startsWith('test:'))

    const reopened = new SettingsStore(dir, codec)
    assert.equal(reopened.apiKey('custom'), 'secret-key')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
