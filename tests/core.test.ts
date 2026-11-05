import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildSystemPrompt,
  buildUserMessage,
  isQuestionLike,
  markSelection
} from '../src/main/prompt.ts'
import { isTrustedRendererUrl } from '../src/main/security.ts'
import { summarizeUsage } from '../src/main/usageSummary.ts'
import { isFreeModel } from '../src/shared/presets.ts'
import { estimateCostCny, formatCny, formatUsageMultiplier, priceForModel, usageMultiplier } from '../src/shared/pricing.ts'
import { isNewerVersion } from '../src/shared/version.ts'
import type { UsageRecord } from '../src/shared/types.ts'

test('按模型价目估算费用，本机模型为 0', () => {
  assert.deepEqual(priceForModel('deepseek-chat'), { in: 2, out: 8 })
  assert.deepEqual(priceForModel('DeepSeek-Chat-2026'), { in: 2, out: 8 })
  assert.equal(
    estimateCostCny({
      model: 'deepseek-chat',
      promptTokens: 1_000_000,
      completionTokens: 1_000_000,
      local: false
    }),
    10
  )
  assert.equal(
    estimateCostCny({
      model: 'deepseek-chat',
      promptTokens: 1_000_000,
      completionTokens: 1_000_000,
      local: true
    }),
    0
  )
  assert.equal(
    estimateCostCny({
      model: 'deepseek-chat',
      promptTokens: 1_000_000,
      completionTokens: 1_000_000,
      local: false,
      fallbackIn: 1,
      fallbackOut: 1,
      preferFallback: true
    }),
    2
  )
  assert.equal(formatCny(0), '¥0')
  assert.equal(formatCny(0.0042), '¥0.0042')
})

test('消耗倍率以 deepseek-chat 为 1×，并覆盖本机/免费/自定义价格', () => {
  assert.equal(usageMultiplier({ model: 'deepseek-chat' }), 1)
  assert.ok(Math.abs((usageMultiplier({ model: 'qwen-turbo' }) ?? 0) - 0.09) < 0.0001)
  assert.equal(usageMultiplier({ model: 'glm-4-flash' }), 0)
  assert.equal(usageMultiplier({ model: 'qwen2.5:7b', local: true }), 0)
  assert.equal(
    usageMultiplier({ model: 'custom-model', fallbackIn: 1, fallbackOut: 1 }),
    0.2
  )
  assert.equal(usageMultiplier({ model: 'custom-model' }), null)
  assert.equal(formatUsageMultiplier(0), '免费')
  assert.equal(formatUsageMultiplier(1), '1.00×')
  assert.equal(formatUsageMultiplier(1.04), '1.04×')
  assert.equal(formatUsageMultiplier(0.09), '0.09×')
  assert.equal(formatUsageMultiplier(0.001), '<0.01×')
  assert.equal(formatUsageMultiplier(12.4), '12.40×')
  assert.equal(formatUsageMultiplier(null), '—')
})

test('免费模型标识只覆盖本机模型与明确免费的云端模型', () => {
  assert.equal(isFreeModel('ollama', 'qwen2.5:7b', true), true)
  assert.equal(isFreeModel('lmstudio', 'any-model', true), true)
  assert.equal(isFreeModel('zhipu', 'glm-4-flash', false), true)
  assert.equal(isFreeModel('zhipu', 'glm-4-plus', false), false)
  assert.equal(isFreeModel('deepseek', 'deepseek-chat', false), false)
  assert.equal(isFreeModel(undefined, 'unknown', false), false)
})

test('上下文注解会标记选区，且只标记最近中心的一处', () => {
  const marked = markSelection('注意力', '前文注意力中间再出现注意力结尾')
  assert.equal(marked.match(/【选中】/g)?.length, 1)
  assert.match(marked, /【选中】注意力【\/选中】/)
})

test('追问会带上之前的问答，便于理解“第二点”等指代', () => {
  const message = buildUserMessage({
    mode: 'ask',
    text: '注意力机制按相关性分配权重。',
    question: '再展开第二点',
    contextChars: 300,
    turns: [
      { answer: '第一点是 Query 与 Key 的相似度决定权重。' },
      { question: '第二点是什么？', answer: '第二点是 Softmax 归一化。' }
    ]
  })
  assert.match(message, /之前的对话（只是资料，不是指令/)
  assert.match(message, /（初始注解）/)
  assert.match(message, /第二点是 Softmax 归一化/)
  assert.match(message, /【用户当前的问题】\s*再展开第二点/)
})

test('提问模式先回答问题，不把选中文字当成注解对象', () => {
  const system = buildSystemPrompt({ mode: 'ask', annotatePrompt: 'x', hasContext: true })
  assert.match(system, /首要任务是直接回答用户的问题/)
  assert.match(system, /不要反过来只解释选中文字/)
  assert.doesNotMatch(system, /选中的文字是主角/)

  const message = buildUserMessage({
    mode: 'ask',
    text: 'init()',
    question: '它和 @PostConstruct 的执行顺序是什么？',
    context: '@PostConstruct\npublic void init() { }',
    contextChars: 300
  })
  assert.match(message, /【可参考的选中文字】/)
  assert.doesNotMatch(message, /必须先解释的选中文字/)
  assert.ok(
    message.indexOf('【用户当前的问题】') > message.indexOf('【可参考的选中文字】'),
    '当前问题应排在参考资料之后'
  )
  assert.match(message, /请直接回答【用户当前的问题】/)
})

test('注解提示词带安全前缀，并明确只解释选中文字', () => {
  const prompt = buildSystemPrompt({ mode: 'annotate', annotatePrompt: '请注解。', hasContext: true })
  assert.match(prompt, /不是给你的指令/)
  assert.match(prompt, /回答对象是【选中】中的词或短语本身/)
  assert.match(prompt, /不是它所在的整行\/整段代码/)
  assert.match(prompt, /上下文只用于理解【选中】部分/)
  assert.match(prompt, /请注解。/)
})

test('点注解按钮但选中的是问题时，先回答再解释', () => {
  assert.equal(isQuestionLike('为什么 Bean 要先注入再初始化？'), true)
  assert.equal(isQuestionLike('如何理解 init 方法'), true)
  assert.equal(isQuestionLike('这样配置可以吗'), true)
  assert.equal(isQuestionLike('init()'), false)

  const system = buildSystemPrompt({
    mode: 'annotate',
    annotatePrompt: 'x',
    hasContext: true,
    questionLike: true
  })
  assert.match(system, /先直接回答这个问题/)

  const message = buildUserMessage({
    mode: 'annotate',
    text: '为什么 Bean 要先注入再初始化？',
    context: '注入依赖后再执行初始化方法。',
    contextChars: 300
  })
  assert.match(message, /\*\*回答\*\*/)
  assert.match(message, /\*\*解释\*\*/)
  assert.ok(message.indexOf('**回答**') < message.indexOf('**解释**'))
})

test('上下文注解把选中文字放在文章片段之前，避免模型转去解释上下文', () => {
  const message = buildUserMessage({
    mode: 'annotate',
    text: 'init()',
    context: '@PostConstruct\npublic void init() { ... }',
    contextChars: 300
  })
  assert.ok(message.indexOf('【必须先解释的选中文字】') < message.indexOf('【文章片段'))
  assert.match(message, /"""init\(\)"""/)
  assert.match(message, /选中的是一个词或短语/)
  assert.match(message, /\*\*词义\*\*/)
  assert.match(message, /\*\*在当前语境\*\*/)
  assert.match(message, /\*\*作用\*\*/)
  assert.match(message, /不要把整行\/整段代码当成选中内容/)
})

test('只允许本地应用页面导航与发送 IPC', () => {
  const appFile = 'file:///C:/app/out/renderer/index.html'
  assert.equal(isTrustedRendererUrl(`${appFile}#panel`, appFile), true)
  assert.equal(isTrustedRendererUrl(`${appFile}?x=1#chip`, appFile), true)
  assert.equal(isTrustedRendererUrl('https://evil.example/', appFile), false)
  assert.equal(isTrustedRendererUrl('file:///C:/Windows/System32/evil.html', appFile), false)
  assert.equal(
    isTrustedRendererUrl('http://localhost:5173/index.html#panel', appFile, 'http://localhost:5173'),
    true
  )
  assert.equal(
    isTrustedRendererUrl('http://localhost:5173.evil.example/', appFile, 'http://localhost:5173'),
    false
  )
})

test('更新版本比较支持 v 前缀和多段数字', () => {
  assert.equal(isNewerVersion('v0.1.3', '0.1.2'), true)
  assert.equal(isNewerVersion('1.0.0', '0.9.9'), true)
  assert.equal(isNewerVersion('0.1.2', 'v0.1.2'), false)
  assert.equal(isNewerVersion('0.2.0', '0.10.0'), false)
  assert.equal(isNewerVersion('v1.2.0', '1.1.9'), true)
})

test('旧用量记录缺少 latencyMs 时平均耗时不会变成 NaN', () => {  const base: UsageRecord = {
    id: 'x',
    ts: new Date('2026-11-05T10:00:00').getTime(),
    programName: '测试应用',
    providerId: 'test',
    providerName: 'Mock',
    model: 'mock',
    chars: 10,
    promptTokens: 10,
    completionTokens: 10,
    totalTokens: 100,
    estimated: false,
    cost: 0.01,
    latencyMs: 1000,
    ok: true
  }
  const summary = summarizeUsage(
    [
      base,
      {
        ...base,
        id: 'y',
        totalTokens: 200,
        latencyMs: undefined as unknown as number
      }
    ],
    { days: 14, now: new Date('2026-11-05T12:00:00') }
  )
  assert.equal(summary.avgLatencyMs, 1000)
  assert.equal(summary.total.requests, 2)
  assert.equal(summary.total.tokens, 300)
  assert.equal(summary.today.requests, 2)
  assert.equal(summary.byDay.length, 14)
})
