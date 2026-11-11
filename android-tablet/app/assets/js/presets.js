(function () {
  window.ZJ_PRESETS = [
    {
      id: 'deepseek',
      name: 'DeepSeek',
      tagline: '便宜 · 中文好',
      baseUrl: 'https://api.deepseek.com/v1',
      models: ['deepseek-chat', 'deepseek-reasoner', 'deepseek-flash', 'deepseek-v4-pro'],
      keyUrl: 'https://platform.deepseek.com/api_keys',
      keyHint: 'sk-...'
    },
    {
      id: 'qwen',
      name: '通义千问',
      tagline: '阿里云百炼',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      models: [
        'deepseek-v4.1-flash', 'qwen3.8-flash', 'qwen3.7-plus', 'qwen3.8-max',
        'glm-5.3', 'qwen3.7-flash', 'deepseek-v4-pro', 'glm-5.3-flash',
        'zhipu/glm-5.3-flash',
        'qwen3.6-plus', 'qwen3.6-flash', 'qwen3.5-plus', 'qwen3.5-flash',
        'qwen3.8-27b', 'qwen-plus', 'qwen-max', 'qwen-turbo', 'qwen-long',
        'qwen3.7-max', 'qwen3.7-max-preview',
        'deepseek-chat', 'deepseek-reasoner', 'deepseek-flash', 'deepseek-v4-flash',
        'glm-5.3-flashx', 'glm-5.2', 'glm-5.1', 'glm-5-turbo', 'glm-5',
        'glm-4.7-flashx', 'glm-4.7-flash', 'glm-4.7', 'glm-4.6', 'glm-4.5-air',
        'glm-4.5', 'glm-4-plus', 'glm-4-air', 'glm-4-flashx', 'glm-4-flash',
        'kimi-k3', 'kimi/kimi-k3', 'kimi-k2.7-code', 'kimi/kimi-k2.7-code',
        'kimi-k2.6', 'kimi/kimi-k2.6',
        'minimax/minimax-m3', 'minimax/minimax-m3.1-flash',
        'zhipu/glm-5.3', 'zhipu/glm-5.3-flashx', 'zhipu/glm-5.2',
        'zhipu/glm-5.1', 'zhipu/glm-5',
        'cmaas-glm-5.3', 'cmaas-qwen3.8-flash',
        'vanchin/deepseek-v4.1-flash', 'vanchin/deepseek-v4-pro',
        'vanchin/deepseek-v4-pro-0813', 'vanchin/deepseek-v3.2-think',
        'vanchin/deepseek-v3.1-terminus', 'vanchin/deepseek-r1', 'vanchin/deepseek-v3',
        'siliconflow/deepseek-v3.2', 'siliconflow/deepseek-v3.1-terminus',
        'siliconflow/deepseek-r1-0528', 'siliconflow/deepseek-v3-0324'
      ],
      keyUrl: 'https://bailian.console.aliyun.com/',
      keyHint: 'sk-...'
    },
    {
      id: 'moonshot',
      name: 'Kimi',
      tagline: '月之暗面',
      baseUrl: 'https://api.moonshot.cn/v1',
      models: ['kimi-k3', 'kimi-k2.6', 'moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
      keyUrl: 'https://platform.moonshot.cn/console/api-keys',
      keyHint: 'sk-...'
    },
    {
      id: 'zhipu',
      name: '智谱 GLM',
      tagline: '国产 · 有免费额度',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      models: ['glm-5.3', 'glm-5.3-flash', 'glm-5.2', 'glm-4.7-flash', 'glm-4.6', 'glm-4-plus', 'glm-4-air', 'glm-4-flash'],
      keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
      keyHint: '...'
    },
    {
      id: 'openai',
      name: 'OpenAI',
      tagline: 'GPT 系列',
      baseUrl: 'https://api.openai.com/v1',
      models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'],
      keyUrl: 'https://platform.openai.com/api-keys',
      keyHint: 'sk-...'
    }
  ];

  // 人民币 / 百万 tokens，仅用于估算，实际账单以服务商为准。
  window.ZJ_PRICES = {
    'deepseek-chat': { in: 2, out: 8 },
    'deepseek-reasoner': { in: 4, out: 16 },
    'deepseek-flash': { in: 2, out: 8 },
    'deepseek-v4-flash': { in: 2, out: 8 },
    'deepseek-v4.1-flash': { in: 2, out: 8 },
    'deepseek-v4-pro': { in: 9, out: 27 },
    'qwen3.8-flash': { in: 0.8, out: 2.7 },
    'qwen3.7-plus': { in: 2, out: 8 },
    'qwen3.8-max': { in: 12, out: 36 },
    'qwen3.7-max': { in: 12, out: 36 },
    'qwen3.7-max-preview': { in: 12, out: 36 },
    'qwen3.7-flash': { in: 0.2, out: 0.8 },
    'qwen3.6-plus': { in: 2, out: 12 },
    'qwen3.6-flash': { in: 1.2, out: 7.2 },
    'qwen3.5-plus': { in: 0.8, out: 4.8 },
    'qwen3.5-flash': { in: 0.2, out: 2 },
    'qwen3.8-27b': { in: 3, out: 12 },
    'qwen-plus': { in: 0.8, out: 2 },
    'qwen-max': { in: 2.4, out: 9.6 },
    'qwen-turbo': { in: 0.3, out: 0.6 },
    'qwen-long': { in: 0.5, out: 2 },
    'glm-5.3': { in: 8, out: 28 },
    'glm-5.3-flash': { in: 0.8, out: 2.8 },
    'glm-5.3-flashx': { in: 2, out: 7 },
    'glm-5.2': { in: 8, out: 28 },
    'glm-5.1': { in: 6, out: 24 },
    'glm-5-turbo': { in: 5, out: 22 },
    'glm-5': { in: 4, out: 18 },
    'glm-4.7-flashx': { in: 0.5, out: 3 },
    'glm-4.7-flash': { in: 0, out: 0 },
    'glm-4.7': { in: 3, out: 14 },
    'glm-4.6': { in: 3, out: 14 },
    'glm-4.5-air': { in: 0.8, out: 6 },
    'glm-4.5': { in: 3, out: 14 },
    'glm-4-plus': { in: 5, out: 5 },
    'glm-4-air': { in: 0.5, out: 0.5 },
    'glm-4-flashx': { in: 0.1, out: 0.1 },
    'glm-4-flash': { in: 0, out: 0 },
    'kimi-k3': { in: 20, out: 100 },
    'kimi/kimi-k3': { in: 20, out: 100 },
    'kimi-k2.7-code': { in: 6.5, out: 27 },
    'kimi/kimi-k2.7-code': { in: 6.5, out: 27 },
    'kimi-k2.6': { in: 6.5, out: 27 },
    'kimi/kimi-k2.6': { in: 6.5, out: 27 },
    'moonshot-v1-8k': { in: 12, out: 12 },
    'moonshot-v1-32k': { in: 24, out: 24 },
    'moonshot-v1-128k': { in: 60, out: 60 },
    'minimax/minimax-m3': { in: 2.1, out: 8.4 },
    'minimax/minimax-m3.1-flash': { in: 1, out: 4 },
    'zhipu/glm-5.3': { in: 8, out: 28 },
    'zhipu/glm-5.3-flash': { in: 0.8, out: 2.8 },
    'zhipu/glm-5.3-flashx': { in: 2, out: 7 },
    'zhipu/glm-5.2': { in: 8, out: 28 },
    'zhipu/glm-5.1': { in: 6, out: 24 },
    'zhipu/glm-5': { in: 4, out: 18 },
    'cmaas-glm-5.3': { in: 8, out: 28 },
    'cmaas-qwen3.8-flash': { in: 0.8, out: 2.7 },
    'vanchin/deepseek-v4.1-flash': { in: 2, out: 8 },
    'vanchin/deepseek-v4-pro': { in: 12, out: 24 },
    'vanchin/deepseek-v4-pro-0813': { in: 9, out: 27 },
    'vanchin/deepseek-v3.2-think': { in: 2, out: 3 },
    'vanchin/deepseek-v3.1-terminus': { in: 4, out: 12 },
    'vanchin/deepseek-r1': { in: 4, out: 16 },
    'vanchin/deepseek-v3': { in: 2, out: 8 },
    'siliconflow/deepseek-v3.2': { in: 2, out: 3 },
    'siliconflow/deepseek-v3.1-terminus': { in: 4, out: 12 },
    'siliconflow/deepseek-r1-0528': { in: 4, out: 16 },
    'siliconflow/deepseek-v3-0324': { in: 2, out: 8 },
    'gpt-4o-mini': { in: 1.1, out: 4.3 },
    'gpt-4o': { in: 18, out: 72 },
    'gpt-4.1-mini': { in: 3, out: 12 }
  };

  window.ZJ_DEFAULT_PROMPT = `你是一位严谨的阅读注解助手。用户会选中一段文字，请给出简明、有信息量的中文注解。

要求：
1. 先用一句话说明这段话到底在讲什么；
2. 解释理解它的概念以及用法（仅解释选中的那个专业术语或者词，不要加上他和别的词或者功能的组合用法）；
3. 专业术语要点破，不要绕圈子；
4. 指出容易误解或值得注意的地方；
5. 不要复述原文，不要写客套话。

使用 Markdown，控制在 300 字以内。如果选中的只是短语或单个术语，就按词典式注解处理。

【回答顺序（必须遵守）】
1. **词义**：先说明选中的词/短语本身是什么（通用解释；术语可给英文全称或中文译名）。
2. **在当前语境**：结合这段代码/文章，说明它具体指什么。
3. **作用**：说明它在这里起什么作用、和前后内容如何配合。
回答对象只能是选中的内容；不要把整行/整段代码或旁边的注解当成回答对象。`;
})();
