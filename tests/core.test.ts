import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildSystemPrompt,
  buildUserMessage,
  classifySelection,
  isQuestionLike,
  markSelection
} from '../src/main/prompt.ts'
import { isTrustedRendererUrl } from '../src/main/security.ts'
import { summarizeUsage } from '../src/main/usageSummary.ts'
import { isFreeModel, presetById } from '../src/shared/presets.ts'
import { estimateCostCny, formatCny, formatUsageMultiplier, priceForModel, usageMultiplier } from '../src/shared/pricing.ts'
import {
  groupQwenModels,
  isBailianThirdPartyModel,
  isChatModel,
  modelDisplayName,
  sortModelsForProvider
} from '../src/shared/modelCatalog.ts'
import { isNewerVersion, parseReleaseVersion } from '../src/shared/version.ts'
import {
  checksumMatches,
  parseApplyResult,
  parseChecksum
} from '../src/main/updateSafety.ts'
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

test('消耗倍率以 deepseek-flash 为 1×，并覆盖本机/免费/自定义价格', () => {
  assert.deepEqual(presetById('deepseek')?.models, ['deepseek-flash', 'deepseek-v4-pro'])
  assert.equal(usageMultiplier({ model: 'deepseek-chat' }), 1)
  assert.ok(Math.abs((usageMultiplier({ model: 'qwen-turbo' }) ?? 0) - 0.09) < 0.0001)
  assert.equal(usageMultiplier({ model: 'glm-4-flash' }), 0)
  assert.equal(usageMultiplier({ model: 'qwen2.5:7b', local: true }), 0)
  assert.equal(
    usageMultiplier({ model: 'custom-model', fallbackIn: 1, fallbackOut: 1 }),
    0.2
  )
  assert.equal(usageMultiplier({ model: 'custom-model' }), null)
  assert.equal(usageMultiplier({ model: 'deepseek-flash' }), 1)
  assert.equal(usageMultiplier({ model: 'deepseek-v4-pro' }), 3.6)
  assert.equal(usageMultiplier({ model: 'glm-5.3' }), 3.6)
  assert.equal(usageMultiplier({ model: 'glm-5.3-flash' }), 0.36)
  assert.equal(usageMultiplier({ model: 'glm-4.6' }), 1.7)
  assert.equal(usageMultiplier({ model: 'glm-4-plus' }), 1)
  assert.equal(
    usageMultiplier({
      model: 'unknown-model',
      fallbackIn: 2,
      fallbackOut: 8,
      useFallback: false
    }),
    null
  )
  assert.equal(
    usageMultiplier({ model: 'unknown-model', fallbackIn: 2, fallbackOut: 8 }),
    1
  )
  assert.equal(formatUsageMultiplier(0), '免费')
  assert.equal(formatUsageMultiplier(1), '1.00×')
  assert.equal(formatUsageMultiplier(3.6), '3.60×')
  assert.equal(formatUsageMultiplier(1.04), '1.04×')
  assert.equal(formatUsageMultiplier(0.09), '0.09×')
  assert.equal(formatUsageMultiplier(0.001), '<0.01×')
  assert.equal(formatUsageMultiplier(12.4), '12.40×')
  assert.equal(formatUsageMultiplier(null), '—')
})

test('百炼模型按注解效果排序，并把图片/语音/向量类放到最后', () => {
  const models = [
    'qwen-image-2.1-pro',
    'qwen3.8-max',
    'qwen3.7-flash-2026-07-15',
    'test-sre-gpu-auto-handle',
    'qwen3.8-flash',
    'qwen3.7-flash',
    'qwen-audio-3.0-asr-flash',
    'glm-5.3',
    'qwen3.6-plus'
  ]
  const sorted = sortModelsForProvider('qwen', models)
  assert.equal(sorted[0], 'qwen3.8-flash')
  assert.equal(sorted[1], 'qwen3.8-max')
  assert.ok(sorted.indexOf('qwen3.6-plus') < sorted.indexOf('qwen-image-2.1-pro'))
  assert.ok(sorted.indexOf('qwen3.6-plus') < sorted.indexOf('qwen-audio-3.0-asr-flash'))
  assert.ok(sorted.indexOf('qwen3.7-flash') < sorted.indexOf('qwen3.7-flash-2026-07-15'))

  const groups = groupQwenModels(models)
  assert.deepEqual(
    groups.map((entry) => entry.group),
    ['recommended', 'text', 'other']
  )
  assert.ok(groups[0].models.includes('qwen3.8-flash'))
  assert.ok(groups[1].models.includes('qwen3.6-plus'))
  assert.ok(groups[2].models.includes('qwen-image-2.1-pro'))
  assert.equal(isChatModel('qwen', 'qwen3.8-flash'), true)
  assert.equal(isChatModel('qwen', 'qwen-image-2.1-pro'), false)
  assert.equal(isChatModel('deepseek', 'deepseek-flash'), true)
  assert.deepEqual(sortModelsForProvider('deepseek', ['b', 'a']), ['b', 'a'])
})

test('百炼当前文本模型价格与倍率', () => {
  assert.deepEqual(priceForModel('qwen3.8-flash'), { in: 0.8, out: 2.7 })
  assert.equal(usageMultiplier({ model: 'qwen3.8-flash' }), 0.35)
  assert.equal(usageMultiplier({ model: 'qwen3.7-plus' }), 1)
  assert.equal(usageMultiplier({ model: 'qwen3.8-max' }), 4.8)
  assert.equal(usageMultiplier({ model: 'qwen3.8-max-0902' }), 4.8)
  assert.equal(usageMultiplier({ model: 'qwen3.7-max-preview' }), 4.8)
  assert.equal(usageMultiplier({ model: 'ZHIPU/GLM-5.3-Flash' }), 0.36)
  assert.equal(usageMultiplier({ model: 'qwen3.7-flash' }), 0.1)
  assert.equal(usageMultiplier({ model: 'qwen3.7-flash-2026-07-15' }), 0.1)
  assert.ok(Math.abs((usageMultiplier({ model: 'qwen3.6-flash' }) ?? 0) - 0.84) < 0.0001)
  assert.ok(Math.abs((usageMultiplier({ model: 'qwen3.5-plus' }) ?? 0) - 0.56) < 0.0001)
  assert.equal(usageMultiplier({ model: 'deepseek-v4.1-flash' }), 1)
  assert.equal(usageMultiplier({ model: 'kimi/kimi-k3' }), 12)
  // 高价变体不套基础价，避免倍率被低估。
  assert.equal(usageMultiplier({ model: 'glm-5.3-prime' }), null)
  assert.equal(usageMultiplier({ model: 'kimi/kimi-k3.1-pro' }), null)
})

test('百炼托管的第三方模型显示“百炼版”，但不改动真实模型名', () => {
  assert.equal(modelDisplayName('qwen', 'deepseek-v4-pro'), 'deepseek-v4-pro · 百炼版')
  assert.equal(modelDisplayName('qwen', 'vanchin/deepseek-v4.1-flash'), 'vanchin/deepseek-v4.1-flash · 百炼版')
  assert.equal(modelDisplayName('qwen', 'ZHIPU/GLM-5.3-Flash'), 'ZHIPU/GLM-5.3-Flash · 百炼版')
  assert.equal(modelDisplayName('qwen', 'kimi/kimi-k3.1-pro'), 'kimi/kimi-k3.1-pro · 百炼版')
  assert.equal(modelDisplayName('qwen', 'MiniMax/MiniMax-M3'), 'MiniMax/MiniMax-M3 · 百炼版')
  assert.equal(modelDisplayName('qwen', 'stepfun/step-5-preview'), 'stepfun/step-5-preview · 百炼版')
  assert.equal(modelDisplayName('qwen', 'qwen3.8-flash'), 'qwen3.8-flash')
  assert.equal(modelDisplayName('qwen', 'cmaas-qwen3.8-flash'), 'cmaas-qwen3.8-flash')
  assert.equal(modelDisplayName('qwen', 'qwen-image-3.0'), 'qwen-image-3.0')
  assert.equal(modelDisplayName('deepseek', 'deepseek-v4-pro'), 'deepseek-v4-pro')
  assert.equal(isBailianThirdPartyModel('deepseek-v4-pro'), true)
  assert.equal(isBailianThirdPartyModel('qwen3.8-flash'), false)
})

test('能从 GitHub 重定向地址或发布页标题识别版本号', () => {
  assert.equal(
    parseReleaseVersion('https://github.com/x/y/releases/tag/v0.1.21'),
    '0.1.21'
  )
  assert.equal(
    parseReleaseVersion(
      'https://github.com/x/y/releases/latest',
      '<title>Release 注解 v0.1.21 · GitHub</title>'
    ),
    '0.1.21'
  )
  assert.equal(
    parseReleaseVersion('', '<a href="/x/y/releases/tag/v0.1.20">'),
    '0.1.20'
  )
  assert.equal(
    parseReleaseVersion('https://github.com/x/y/releases/latest', '<title>没有版本号</title>'),
    null
  )
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
  assert.equal(classifySelection('init()'), 'word')

  const system = buildSystemPrompt({
    mode: 'annotate',
    annotatePrompt: 'CUSTOM_WORD_TEMPLATE',
    hasContext: true,
    questionLike: true
  })
  assert.match(system, /第一句必须是答案本身/)
  assert.match(system, /不要套用「词义 → 在当前语境 → 作用」的模板/)
  assert.doesNotMatch(system, /CUSTOM_WORD_TEMPLATE/)

  const message = buildUserMessage({
    mode: 'annotate',
    text: '为什么 Bean 要先注入再初始化？',
    context: '注入依赖后再执行初始化方法。',
    contextChars: 300
  })
  assert.match(message, /【用户提出的问题】/)
  assert.doesNotMatch(message, /必须先解释的选中文字/)
  assert.match(message, /第一句直接给答案/)
  assert.match(message, /\*\*回答\*\*/)
  assert.match(message, /\*\*解释\*\*/)
  assert.ok(message.indexOf('**回答**') < message.indexOf('**解释**'))
  assert.ok(
    message.indexOf('【问题所在文章片段') < message.indexOf('【用户提出的问题】'),
    '问题应放在参考片段之后'
  )
})

test('长段落按段落注解，不套用词义三段式', () => {
  const paragraph =
    'Spring 的依赖注入容器会在启动时读取配置类，创建 Bean 定义，然后按照依赖关系完成实例化和注入。' +
    '这个过程涉及配置解析、BeanDefinition 注册、后置处理器、代理创建以及生命周期回调，理解顺序很重要。'
  assert.equal(classifySelection(paragraph), 'paragraph')
  assert.equal(classifySelection(`${paragraph}？`), 'paragraph')

  const system = buildSystemPrompt({
    mode: 'annotate',
    annotatePrompt: 'CUSTOM_STYLE',
    hasContext: true,
    selectionText: paragraph
  })
  assert.match(system, /整段文字/)
  assert.match(system, /不要套用/)
  assert.match(system, /CUSTOM_STYLE/)

  const message = buildUserMessage({
    mode: 'annotate',
    text: paragraph,
    contextChars: 300
  })
  assert.match(message, /\*\*概括\*\*/)
  assert.match(message, /\*\*补充\*\*/)
  assert.doesNotMatch(message, /\*\*词义\*\*/)
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

test('更新包校验和与安装结果解析', () => {
  const sum = 'a'.repeat(64)
  assert.equal(parseChecksum(`${sum}  zhujie-win-x64.zip`), sum)
  assert.equal(parseChecksum('not a checksum'), null)
  assert.equal(checksumMatches(sum, sum.toUpperCase()), true)
  assert.equal(checksumMatches(sum, 'b'.repeat(64)), false)
  assert.deepEqual(parseApplyResult('ok'), { ok: true })
  assert.deepEqual(parseApplyResult('\uFEFFfail: copy failed'), {
    ok: false,
    message: 'copy failed'
  })
  assert.deepEqual(parseApplyResult('fail: copy failed\nrollback-failed: locked'), {
    ok: false,
    message: 'copy failed'
  })
  assert.equal(parseApplyResult('weird'), null)
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
