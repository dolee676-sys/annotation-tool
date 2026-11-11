import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildModelOptions,
  isAppAllowed,
  normalizeApp,
  normalizeForMatch,
  panelResetPayload
} from '../src/main/annotationHelpers.ts'
import type { StoredSettings } from '../src/main/settings.ts'
import type { ProviderView } from '../src/shared/types.ts'

const ollamaView: ProviderView = {
  id: 'ollama',
  name: 'Ollama',
  kind: 'ollama',
  baseUrl: 'http://127.0.0.1:11434',
  models: ['llama3'],
  hasKey: false,
  builtin: true,
  presetId: 'ollama',
  priceIn: 0,
  priceOut: 0
}

const deepseekView: ProviderView = {
  id: 'deepseek',
  name: 'DeepSeek',
  kind: 'openai',
  baseUrl: 'https://api.deepseek.com/v1',
  models: ['deepseek-chat'],
  hasKey: true,
  builtin: true,
  presetId: 'deepseek',
  priceIn: 1,
  priceOut: 2
}

const noKeyView: ProviderView = {
  id: 'zhipu',
  name: '智谱',
  kind: 'openai',
  baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
  models: ['glm-4-flash'],
  hasKey: false,
  builtin: true,
  presetId: 'zhipu',
  priceIn: 0,
  priceOut: 0
}

function getProvider(id: string) {
  const map: Record<string, ProviderView> = {
    ollama: ollamaView,
    deepseek: deepseekView,
    zhipu: noKeyView
  }
  const view = map[id]
  if (!view) return undefined
  return { ...view }
}

test('buildModelOptions 只收本机与有 Key 的服务商，跳过无 Key 的云端', () => {
  const options = buildModelOptions(
    [ollamaView, deepseekView, noKeyView],
    getProvider,
    'ollama',
    'llama3'
  )
  assert.deepEqual(
    options.map((o) => `${o.providerId}/${o.model}`),
    ['ollama/llama3', 'deepseek/deepseek-chat']
  )
})

test('buildModelOptions 会把不在列表里的当前模型补到最前面', () => {
  const options = buildModelOptions(
    [ollamaView, deepseekView],
    getProvider,
    'deepseek',
    'deepseek-reasoner'
  )
  assert.equal(options[0]?.providerId, 'deepseek')
  assert.equal(options[0]?.model, 'deepseek-reasoner')
  assert.equal(options.some((o) => o.model === 'deepseek-chat'), true)
})

test('buildModelOptions 过滤百炼的非文字对话模型', () => {
  const qwenView: ProviderView = {
    id: 'qwen',
    name: '通义',
    kind: 'openai',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen3.8-flash', 'qwen-image-3.0'],
    hasKey: true,
    builtin: true,
    presetId: 'qwen',
    priceIn: 0,
    priceOut: 0
  }
  const options = buildModelOptions([qwenView], getProvider, 'qwen', 'qwen3.8-flash')
  assert.deepEqual(
    options.map((o) => o.model),
    ['qwen3.8-flash']
  )
})

test('isAppAllowed 白名单按进程名（不区分大小写、忽略 .exe）匹配', () => {
  const s = { filterMode: 'whitelist', whitelist: ['Code.exe'] } as StoredSettings
  assert.equal(isAppAllowed(s, 'code.exe'), true)
  assert.equal(isAppAllowed(s, 'Code'), true)
  assert.equal(isAppAllowed(s, 'notepad.exe'), false)
  assert.equal(isAppAllowed({ ...s, filterMode: 'all' }, 'notepad.exe'), true)
  assert.equal(isAppAllowed(s, '  '), false)
})

test('panelResetPayload 原样带回 mode/provider/model，并传入 localOnly', () => {
  const payload = panelResetPayload(
    { mode: 'annotate', providerId: 'deepseek', model: 'deepseek-chat' },
    'DeepSeek',
    true
  )
  assert.equal(payload.mode, 'annotate')
  assert.equal(payload.providerId, 'deepseek')
  assert.equal(payload.providerName, 'DeepSeek')
  assert.equal(payload.model, 'deepseek-chat')
  assert.equal(payload.localOnly, true)
  assert.equal(payload.followUp, false)
})

test('normalizeApp 去空格转小写去 .exe；normalizeForMatch 去全部空白', () => {
  assert.equal(normalizeApp('  Code.EXE '), 'code')
  assert.equal(normalizeApp('notepad'), 'notepad')
  assert.equal(normalizeForMatch('你 好\n世 界'), '你好世界')
})
