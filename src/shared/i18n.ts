export type Locale = 'zh-CN' | 'en-US'
export type LanguageSetting = 'system' | Locale
export type AnswerLanguageSetting = 'auto' | Locale

export function isLocale(value: unknown): value is Locale {
  return value === 'zh-CN' || value === 'en-US'
}

export function resolveLocale(setting: LanguageSetting, systemLocale?: string): Locale {
  if (isLocale(setting)) return setting
  return /^en(?:[-_]|$)/i.test(systemLocale ?? '') ? 'en-US' : 'zh-CN'
}

export function resolveAnswerLocale(setting: AnswerLanguageSetting, uiLocale: Locale): Locale {
  return setting === 'auto' ? uiLocale : setting
}

const EN: Record<string, string> = {
  // Shell
  '应用范围': 'Apps',
  '模型服务': 'Models',
  '注解提示词': 'Prompt',
  '历史记录': 'History',
  '收藏': 'Favorites',
  '用量统计': 'Usage',
  '关于': 'About',
  '划词 AI 助手': 'AI reading assistant',
  '取词服务运行中': 'Selection service running',
  '取词服务异常': 'Selection service error',
  '取词服务未运行': 'Selection service stopped',
  '最小化': 'Minimize',
  '隐藏到托盘': 'Hide to tray',
  '正在读取本机配置…': 'Loading local settings…',
  '划词注解已开启': 'Selection annotation is on',
  '划词注解已暂停': 'Selection annotation is paused',
  '选中任意文字，旁边会出现「注解」。': 'Select text in any app to show the annotation chip.',
  '总开关': 'Main switch',

  // Language card
  '语言': 'Language',
  '界面语言': 'Interface language',
  '跟随系统': 'Follow system',
  '中文': 'Chinese',
  '回答语言': 'Answer language',
  '跟随界面': 'Follow interface',
  '语言说明': 'English UI covers all pages. Use the selectors above to switch interface and answer language.',
  '切换语言后，界面会立即更新。': 'The interface updates immediately after switching.',

  // Models page
  '用哪家 AI': 'Which AI?',
  '先选本机还是云端，再选服务商、选模型、填 API Key。接口地址不用管。':
    'Choose local or cloud, then a provider, a model, and paste your API key. You do not need to manage the endpoint URL.',
  '当前使用': 'Current',
  '还没有选择模型': 'No model selected',
  '云端': 'Cloud',
  '已切到云端模式，但当前仍用本机模型；选一家云端服务并保存后生效。':
    'Cloud mode is on, but the current model is local. Choose a cloud provider and save.',
  '已切到本机模式，云端模型会被拦截；请选择一个本机模型。':
    'Local-only mode is on. Cloud models are blocked; choose a local model.',
  '本机模型': 'Local model',
  'Ollama / LM Studio · 文字不离开电脑': 'Ollama / LM Studio · text stays on your computer',
  '云端 AI': 'Cloud AI',
  'DeepSeek / 通义 / Kimi 等 · 需要 API Key': 'DeepSeek / Qwen / Kimi and more · API key required',
  '选择服务商': 'Choose a provider',
  '已配置': 'Configured',
  '未配置': 'Not configured',
  '免费': 'Free',
  '标有「免费」的服务商或模型由服务商提供免费额度，具体额度和有效期以服务商页面为准。':
    'Providers or models marked Free offer a free tier from the provider. Limits and expiry are set by the provider.',
  '设置': 'Settings',
  '不用填 Key': 'No API key needed',
  '需要 API Key': 'API key required',
  '已保存，留空表示不修改': 'Saved. Leave blank to keep it.',
  '粘贴 API Key': 'Paste your API key',
  '没有 Key？去 {name} 获取': 'No key? Get one from {name}',
  '模型': 'Model',
  '（当前）': '(current)',
  '请选择模型': 'Choose a model',
  '还没检测到本机模型。点下面的按钮，会读取你已经下载的模型。':
    'No local models detected. Click the button below to read the models you have downloaded.',
  '这个服务商没有预置模型，请手动填写模型名。':
    'This provider has no preset models. Enter a model ID manually.',
  '模型旁的倍率以 deepseek-flash 为 1.00×，精确到 0.01×；按每百万 tokens 输入+输出价格估算，数字越小越省，仅用于横向比较，实际费用以用量页为准。':
    'Multipliers use deepseek-flash as 1.00×, rounded to 0.01×. They are estimated from input + output prices per million tokens; lower is cheaper. Use them for comparison only; actual charges come from your provider.',
  '百炼返回的图片、语音、向量等不能用于文字对话的模型已自动过滤，列表只保留文字对话模型。':
    'Bailian models that cannot handle text chat (image, audio, vector, and similar models) are filtered out automatically; only text chat models are listed.',
  '免费或轻量模型响应快，适合简单注解；复杂提问和连续追问建议选能力更强的模型。':
    'Free or light models are faster and good for simple annotations. Use a stronger model for complex questions and follow-ups.',
  '列表里没有我要的模型？手动填写': 'Model not listed? Enter it manually',
  '直接输入模型名，例如 deepseek-flash': 'Enter a model ID, e.g. deepseek-flash',
  '处理中…': 'Working…',
  '保存并使用': 'Save and use',
  '检测本机模型并启用': 'Detect local models and enable',
  '保存并测试': 'Save and test',
  '重新检测模型': 'Detect again',
  '只访问本机端口，文字不离开电脑。': 'Only connects to localhost; text stays on your computer.',
  '选中的文字会发送给 {name}，请勿用于敏感内容。':
    'Selected text is sent to {name}. Do not use it for sensitive content.',
  '怎么配置 {name}': 'How to set up {name}',
  '、怎么购买 tokens': ' and buy tokens',
  '获取 API Key': 'Get an API key',
  '充值 / 购买 tokens': 'Top up / buy tokens',
  '高级：手动填写接口地址（一般不用）': 'Advanced: enter the endpoint manually (usually not needed)',
  '只有在使用公司内网、自建代理，或上面的服务商里没有你要的接口时，才需要改这里。':
    'Only change this for a company network, a self-hosted proxy, or an endpoint not listed above.',
  '怎么配置自定义接口、怎么购买 tokens': 'How to set up a custom endpoint and buy tokens',
  '向服务商获取三样东西：Base URL、API Key、模型名。':
    'Get three things from the provider: Base URL, API key, and model ID.',
  'Base URL 一般以 /v1 结尾；不确定时看服务商文档。':
    'The Base URL usually ends with /v1; check the provider docs if unsure.',
  '在服务商控制台充值或购买 tokens 后，把 Key 和模型名填到上面的表单。':
    'Top up or buy tokens in the provider console, then fill in the key and model ID above.',
  '保存后点「测试」，能拉到模型列表就说明配置成功。':
    'After saving, click Test. If the model list loads, the setup works.',
  '如果是中转或聚合服务，确认它兼容 OpenAI 协议；不要购买来源不明的低价 Key。':
    'For a relay or aggregator, make sure it is OpenAI-compatible. Do not buy suspiciously cheap keys.',
  '编辑服务': 'Edit provider',
  '添加服务': 'Add provider',
  '取消': 'Cancel',
  '名称': 'Name',
  '例如 公司内网模型': 'e.g. Company internal model',
  '协议': 'Protocol',
  'OpenAI 兼容': 'OpenAI-compatible',
  'Ollama 原生': 'Ollama native',
  'API Key（可选，保存在本机密钥存储）': 'API key (optional, stored in the local key store)',
  '留空表示不修改已保存的密钥': 'Leave blank to keep the saved key',
  '输入价格（元 / 百万 tokens）': 'Input price (CNY / million tokens)',
  '输出价格（元 / 百万 tokens）': 'Output price (CNY / million tokens)',
  '费用按这里的价格估算；内置服务商已带默认价目，本机模型为 0。':
    'Cost is estimated from these prices. Built-in providers have default prices; local models cost 0.',
  '保存中…': 'Saving…',
  '保存': 'Save',
  '已清除密钥': 'Key cleared',
  '清除密钥': 'Clear key',
  '已删除': 'Deleted',
  '添加自定义服务': 'Add a custom provider',
  '测试 / 拉取模型': 'Test / fetch models',
  '编辑': 'Edit',
  '删除': 'Delete',
  '默认': 'Default',
  '外部': 'External',
  '尚未获取模型列表': 'No model list yet',
  '设为默认模型': 'Set as default model',
  '连接正常，发现 {count} 个模型。': 'Connected. Found {count} models.',
  '已保存 API Key': 'API key saved',
  '推荐（按注解/问答效果排序）': 'Recommended (ordered for annotation/Q&A)',
  '其他对话模型': 'Other chat models',
  '图片 / 语音 / 向量等（不用于文字注解）': 'Image / audio / vector models (not for text annotation)',

  // Panel
  'AI 注解这段文字': 'Annotate this text with AI',
  '就这段文字向 AI 提问': 'Ask AI about this text',
  '来自 {name}': 'From {name}',
  'AI 解析': 'AI analysis',
  '切换模型（同时设为默认）': 'Switch model (also sets default)',
  '选择模型': 'Choose a model',
  '取消收藏': 'Remove from favorites',
  '收藏当前问答': 'Favorite this answer',
  '取消钉住，点外部可关闭': 'Unpin; click outside to close',
  '钉在当前屏幕上': 'Pin on screen',
  '提问模式请直接重新提问': 'In Ask mode, ask again directly',
  '重新生成注解（会清空追问）': 'Regenerate annotation (clears follow-ups)',
  '重新生成注解': 'Regenerate annotation',
  '复制内容': 'Copy',
  '关闭': 'Close',
  '正在读取上下文…': 'Reading context…',
  '注解完成后可以继续提问…': 'Ask a follow-up after the annotation is ready…',
  '回答中…': 'Answering…',
  '对这段内容继续提问…': 'Ask a follow-up about this text…',
  '继续问这段文字…': 'Ask a follow-up…',
  '想问这段文字什么？': 'What do you want to ask?',
  '正在读取上下文': 'Reading context',
  '正在解析': 'Analyzing',
  '正在回答': 'Answering',
  '已记录用量': 'Usage recorded',
  '未完成': 'Not finished',
  '等你提问': 'Waiting for your question',
  '准备中': 'Preparing',
  ' · 正在读取上下文…': ' · reading context…',
  ' · 已结合上下文': ' · with context',
  '当前应用没有向系统暴露可选文本，本次只发送选中文字':
    'This app did not expose selectable text to Windows; only the selection is being sent.',
  ' · 未读取到上下文': ' · no context read',
  ' · 已截断，仅发送前 {count} 字': ' · truncated to the first {count} characters',
  '在下面输入你的问题，AI 会结合这段文字回答。':
    'Type your question below. AI will answer using this text.',
  '正在生成注解': 'Generating annotation',
  '没能完成注解': 'Could not complete the annotation',
  '没能完成回答': 'Could not complete the answer',
  '重试': 'Retry',
  '打开设置': 'Open settings',
  '你的问题': 'Your question',
  '选中的文字': 'Selected text',
  '轻量模型': 'Light model',
  '这是轻量模型，复杂提问建议在顶部切换到 qwen3.8-max、DeepSeek V4 Pro 等更强的模型':
    'This is a light model. For complex questions, switch to a stronger model such as qwen3.8-max or DeepSeek V4 Pro.',
  '结合上下文': 'With context',
  '已钉住': 'Pinned',
  '仅本机': 'Local only',
  '收藏失败': 'Failed to favorite',
  '提问': 'Ask',
  '注解': 'Annotation',
  '未读取到上下文': 'No context read',
  '已截断，仅发送前 {count} 字': 'Truncated to the first {count} characters',

  // Errors / notices
  '未知错误': 'Unknown error',
  '请先填入 API Key。': 'Enter an API key first.',
  '请选择一个模型。': 'Choose a model first.',
  '没有检测到模型。请先启动 Ollama / LM Studio，并下载一个模型。':
    'No models detected. Start Ollama / LM Studio and download a model first.',
  '已启用 {name} · {model}。连接正常，发现 {count} 个模型。':
    'Enabled {name} · {model}. Connected; found {count} models.',
  '已保存，但连接测试失败：{error}': 'Saved, but the connection test failed: {error}',
  '还没有配置 AI': 'No AI configured yet',
  '去配置': 'Set up',
  '没有找到匹配的应用，换个关键词试试。': 'No matching app. Try another keyword.',
  '没有扫描到应用，可以在下面手动输入进程名。':
    'No apps found. You can enter a process name below.',
  '扫描中…': 'Scanning…',
  '刷新': 'Refresh',
  '清除': 'Clear',
  '扫描应用失败：{error}': 'Failed to scan apps: {error}',
  '正在扫描电脑上的应用…': 'Scanning apps on this computer…',
  '运行中': 'Running',
  '已安装': 'Installed',
  '上次使用：{time}': 'Last used: {time}',
  '用过 {count} 次': 'Used {count} times',
  '添加': 'Add',
  '正在重启…': 'Restarting…',
  '重启取词服务': 'Restart selection service',
  '取词服务启动失败': 'Selection service failed to start',
  '可尝试以管理员身份运行，或检查是否有安全软件拦截全局钩子。':
    'Try running as administrator, or check whether security software is blocking the global hook.',

  // Tray / dialogs
  '启用划词注解': 'Enable selection annotation',
  '退出': 'Quit',
  '注解 · 划词 AI 助手': 'Annotation · AI reading assistant',
  '发现新版本': 'Update available',
  '发现新版本 v{version}': 'Version v{version} is available',
  '是否现在下载？下载完成后需要重启安装，配置和历史会保留。':
    'Download now? You will need to restart to install. Settings and history are preserved.',
  '下载更新': 'Download update',
  '稍后': 'Later',
  '点此打开设置，下载并安装更新。': 'Open Settings to download and install the update.',
  '这个模型服务已不存在，请到设置里重新选择。':
    'This provider no longer exists. Choose another one in Settings.',
  '还没有选择 AI。请打开设置 → 模型服务，选一家 AI、选一个模型，然后填入 API Key。':
    'No AI selected. Open Settings → Models, choose a provider and model, then enter an API key.',
  '已开启「仅本机」模式，但 {name} 指向非本机地址（{url}），请求已被阻止。':
    'Local-only mode is on, but {name} points to a non-local address ({url}). The request was blocked.',
  '（免费）': ' (free)',
  'Base URL 一般以': 'The Base URL usually ends with',
  '结尾；不确定时看服务商文档。': '; check the provider docs if unsure.',
  '正在读取最新版本': 'Checking for updates',
  '已是最新版本': 'You are up to date',
  '检查更新失败': 'Update check failed',
  '更新失败': 'Update failed',
  '没有打开的面板': 'No open panel',
  '回答还没完成': 'The answer is not finished yet',
  '还没有可收藏的回答': 'There is no answer to favorite yet',
  '收藏写入磁盘失败，请检查磁盘空间。':
    'Failed to save the favorite. Please check disk space.',
  '模型服务不存在': 'The provider does not exist',
  '已开启「仅本机」模式，已阻止非本机地址':
    'Local-only mode is on. Non-local addresses are blocked.',
  '连接成功，但模型列表写入磁盘失败：{error}':
    'Connected, but saving the model list failed: {error}',
  '连不上 {name}。请确认它已经启动，然后再试一次。':
    'Cannot reach {name}. Make sure it is running and try again.',
  'API Key 不正确或没有权限（401）。请重新复制一次 Key。':
    'The API key is invalid or lacks permission (401). Copy the key again.',
  '连不上 {name}。请确认本机模型服务已启动（例如运行 ollama serve）。':
    'Cannot reach {name}. Make sure the local model server is running (for example, ollama serve).',
  '接口路径可能不对，请检查 Base URL：{url}':
    'The endpoint path may be wrong. Check the Base URL: {url}',
  '未收录该模型价格，暂不比较': 'Price not listed; comparison unavailable',
  '相对 deepseek-flash 的 token 价格；按每百万 tokens 输入+输出估算，实际以用量页为准':
    'Token price relative to deepseek-flash, estimated from input + output per million tokens. Actual charges come from Usage.',
  '连接成功，发现 {count} 个模型': 'Connected. Found {count} models.',
  '已切换：只用本机模型，不联网': 'Switched: local models only, no network.',
  '已切换：允许云端 AI，选中的文字会发出去':
    'Switched: cloud AI allowed; selected text will be sent.',
  '测试中…': 'Testing…',
  '模型服务已保存': 'Provider saved',
  '请填写 Base URL': 'Enter the Base URL',
  '本机': 'Local',
  '已复制': 'Copied',
  '复制回答': 'Copy answer',
  '复制摘要': 'Copy summary',
  '结合上下文 {count} 字': 'with {count} characters of context',
  '综合': 'Summary',
  '{count} 条记录': '{count} records',
  '刚刚': 'Just now',
  '{count} 分钟前': '{count} min ago',
  '{count} 小时前': '{count} h ago',
  '{count} 天前': '{count} d ago',
  '决定哪些应用里选中文字时会出现「注解」小框。':
    'Choose which apps show the annotation chip when you select text.',
  '还没有可用模型': 'No usable model yet',
  '先启动 Ollama 或 LM Studio，再点「测试 / 拉取模型」。也可以添加任意 OpenAI 兼容接口。':
    'Start Ollama or LM Studio, then click Test / fetch models. You can also add any OpenAI-compatible endpoint.',
  '全部应用': 'All apps',
  '浏览器、PDF、Office、编辑器里都能用': 'Works in browsers, PDF readers, Office, and editors',
  '仅指定应用': 'Selected apps only',
  '只在下面勾选的应用中出现': 'Only appears in the apps checked below',
  '应用列表': 'App list',
  '{count} 个应用': '{count} apps',
  '{count} 个运行中': '{count} running',
  '搜索应用，例如 Chrome、微信、VS Code': 'Search apps, e.g. Chrome, WeChat, VS Code',
  '手动输入应用名或进程名，例如 chrome 或 WeChat':
    'Enter an app or process name, e.g. chrome or WeChat',
  '当前是「全部应用」；切换到「仅指定应用」后，才能勾选下面的应用。':
    'All apps is selected. Switch to Selected apps only to check apps below.',
  '勾选后，只有这些应用里划词才会出现小框。':
    'After checking, the chip appears only in those apps.',
  '勾选保存的是真实进程名（如 msedge.exe）；手动输入按进程名精确匹配，可省略 .exe。':
    'Checked items store the real process name (e.g. msedge.exe). Manual entries match the process name exactly; .exe is optional.',
  '应用列表会自动扫描电脑上已安装和正在运行的程序；在注解面板和设置窗口内不会触发。':
    'The list scans installed and running programs automatically. It does not trigger inside the annotation panel or Settings.',
  '作为系统提示词发送给模型；选中的文字会作为用户消息附在后面。':
    'Sent to the model as the system prompt; the selected text is appended as the user message.',
  '回答顺序（应用强制执行）': 'Answer order (enforced by the app)',
  '回答顺序由应用按「词 / 问题 / 段落」自动决定，旧提示词不会改变这个顺序；点「恢复默认」可换成简洁模板，模板只保留你的风格偏好。':
    'The app chooses the answer order for words, questions, and paragraphs; old prompts cannot change it. Click Reset to use the concise template, which keeps only your style preferences.',
  '套用模板': 'Use template',
  '系统提示词': 'System prompt',
  '{count} 字': '{count} characters',
  '建议保留“Markdown / 300 字以内”之类的约束，面板显示更稳定。':
    'Keep constraints such as “Markdown / under 300 words” for more stable panel rendering.',
  '恢复默认': 'Reset to default',
  '开启后，点「注解 / 提问」时会读取选中位置前后各 {count} 字，把【选中】部分标出来后一起发给模型。只读取当前应用的无障碍文本，不截屏；取不到时自动只发选中文字。':
    'When enabled, Annotate / Ask reads about {count} characters around the selection and sends them with the selected part marked. It reads only the app’s accessibility text, never takes screenshots, and falls back to sending only the selection.',
  '前后各': 'Around',
  '字': 'characters',
  '会多发送约 2 倍上下文，费用通常为原来的 1.5–2 倍。':
    'Sends about twice as much context; cost is usually 1.5–2× higher.',
  '单次发送上限': 'Maximum characters per request',
  '当前 {count} 字': 'Currently {count} characters',
  '选中文字超过上限时只发送前面的部分，注解面板会明确提示「已截断」，不会让你误以为整段都发送了。':
    'Selections above the limit send only the beginning; the panel clearly says “truncated” so you do not think the whole passage was sent.',
  '最多': 'Up to',
  '删除「{name}」？': 'Delete “{name}”?',
  '默认模型：{model}': 'Default model: {model}',
  '注解和提问都会保存在本机，最多保留 {count} 条；满了可以压缩成综合摘要。':
    'Annotations and questions are saved locally, up to {count} records. When full, older records can be compressed into a summary.',
  '清空记录': 'Clear records',
  '历史已满 {count} 条': 'History is full ({count} records)',
  '可以把最早的 {old} 条压缩成一份综合摘要，保留最近 {keep} 条。压缩会调用当前模型，可能需要一点时间并产生费用。':
    'Compress the earliest {old} records into a summary and keep the latest {keep}. Compression calls the current model, may take a moment, and may cost tokens.',
  '压缩中…': 'Compressing…',
  '压缩旧记录': 'Compress old records',
  '综合摘要': 'Summary',
  '旧记录压缩后会保留在这里': 'Compressed old records are kept here',
  '搜索选中的文字、问题、回答或应用': 'Search selected text, questions, answers, or apps',
  '共 {count} 条': '{count} records',
  '关闭后新的注解/提问不再写入历史，已有记录保留':
    'When off, new annotations/questions are not written to history; existing records remain.',
  '记录新历史': 'Record new history',
  '还没有历史记录。选中文字做一次注解或提问后，这里会出现记录。':
    'No history yet. Annotate or ask about selected text and records will appear here.',
  '没有匹配的记录，换个关键词试试。': 'No matching records. Try another keyword.',
  '{count} 轮问答': '{count} turns',
  '连续对话 · {count} 轮': 'Conversation · {count} turns',
  '复制完整对话': 'Copy full conversation',
  '追问': 'Follow-up',
  '已收藏': 'Favorited',
  '在注解面板点右上角星星，收藏当前的问答；只保存在本机。':
    'Click the star in the annotation panel to favorite the current answer. It is stored only on this computer.',
  '清空收藏': 'Clear favorites',
  '还没有收藏。打开一条注解或提问，点右上角的星星即可收藏当前问答。':
    'No favorites yet. Open an annotation or question and click the star to favorite it.',
  '用量已刷新': 'Usage refreshed',
  '记录每次注解/提问的模型、token、费用与耗时，数据只写在本机。':
    'Track the model, tokens, cost, and latency of each annotation/question. Data is written locally only.',
  '还没有用量。选中一段文字、点开「注解」后，这里会按模型和应用记录 token。':
    'No usage yet. Annotate a selection and token usage will appear here by model and app.',
  '今日 tokens': 'Today tokens',
  '累计 tokens': 'Total tokens',
  '累计花费': 'Total cost',
  '人民币估算': 'Estimated in CNY',
  '平均耗时': 'Avg latency',
  '仅统计成功请求': 'Successful requests only',
  '使用模型': 'Models used',
  '覆盖 {count} 个应用': 'Across {count} apps',
  '{count} 次': '{count} requests',
  '近 14 天': 'Last 14 days',
  'tokens / 天': 'tokens / day',
  '按模型': 'By model',
  '按应用': 'By app',
  '次数': 'Requests',
  '花费': 'Cost',
  '应用': 'App',
  '最近记录': 'Recent requests',
  '最多显示 50 条': 'Showing up to 50',
  '时间': 'Time',
  '耗时': 'Latency',
  '状态': 'Status',
  '成功': 'Success',
  '失败': 'Failed',
  '费用按内置价目估算（人民币），本机模型为 0；自定义接口可在「高级」里填写输入/输出价格。':
    'Costs are estimated from built-in prices in CNY; local models cost 0. For custom endpoints, enter input/output prices under Advanced.',
  '划词注解 · 本地优先的阅读辅助工具。': 'Selection annotation · a local-first reading assistant.',
  '版本': 'Version',
  '制作': 'Made by',
  '平台': 'Platform',
  '取词服务': 'Selection service',
  '重启中…': 'Restarting…',
  '重启': 'Restart',
  '数据目录': 'Data folder',
  '路径已复制': 'Path copied',
  '复制': 'Copy',
  '版本更新': 'Updates',
  '当前 v{version}': 'Current v{version}',
  '应用会在启动后自动检查 GitHub Releases。':
    'The app checks GitHub Releases after startup.',
  '正在检查更新…': 'Checking for updates…',
  '已是最新版本 v{version}': 'You are up to date (v{version})',
  '线上最新 v{latest}；当前本地 v{current}（本地构建较新）':
    'Latest online: v{latest}; local build: v{current} (newer).',
  '发现新版本 v{version}。{action}': 'Version v{version} is available. {action}',
  '正在自动下载…': 'Downloading automatically…',
  '点击「下载更新」后再下载。': 'Click Download update to start.',
  '正在下载 v{version}（{percent}%）。': 'Downloading v{version} ({percent}%).',
  'v{version} 已下载并通过 SHA-256 校验；重启后替换程序文件，配置和历史会保留。':
    'v{version} has been downloaded and verified with SHA-256. Restart to replace the program files; settings and history are preserved.',
  '更新未完成。': 'Update not completed.',
  '检查更新失败。': 'Update check failed.',
  '检查中…': 'Checking…',
  '检查更新': 'Check for updates',
  '重试下载': 'Retry download',
  '重启并更新': 'Restart and update',
  '打开发布页': 'Open releases',
  '启动时检查更新': 'Check for updates on startup',
  '发现新版本后自动下载': 'Download updates automatically',
  '关闭时只弹出提示，点「下载更新」后才下载；无论开关如何，都需要你点「重启并更新」才会替换程序。':
    'When off, the app only shows a prompt; click Download update to download. Either way, the program is replaced only after you click Restart and update.',
  '安装包未做代码签名；SHA-256 主要防传输损坏，不能完全防止发布账号被入侵。只从本仓库 Releases 更新，介意供应链风险可关闭自动下载。':
    'The build is not code-signed. SHA-256 protects against transfer corruption, not a compromised release account. Update only from this repository’s Releases; turn off auto-download if you are concerned about supply-chain risk.',
  '启动': 'Startup',
  '开机后自动在托盘运行，不弹窗；需要时点托盘图标打开设置。':
    'Runs in the tray after login without showing a window; click the tray icon to open Settings.',
  '隐私': 'Privacy',
  '配置、用量记录、历史对话和综合摘要都只保存在本机数据目录。历史和摘要是明文文件，未做额外加密。默认开启「仅本机」，请求只会发往 localhost。关闭后才会使用你自行配置的云端接口；本应用没有内置遥测、账号或云同步。':
    'Settings, usage, history, and summaries are stored only in the local data folder. History and summaries are plain-text files without extra encryption. Local-only is on by default, so requests go only to localhost. Cloud endpoints are used only after you turn it off and configure them. The app has no built-in telemetry, account, or cloud sync.',
  '参考项目与许可': 'References and licenses',
  'MIT · 制作 piona': 'MIT · Made by piona',
  '全局划词取词与鼠标/键盘钩子，返回文本、坐标与应用名。':
    'Global selection capture and mouse/keyboard hooks; returns text, coordinates, and app name.',
  'Electron 划词助手的交互与窗口定位思路参考。':
    'Interaction and window-positioning reference for an Electron selection assistant.',
  '划词助手产品形态调研；未复用其代码。':
    'Product research for selection assistants; no code reused.',
  '划词翻译交互调研；仓库已归档，未复用其代码。':
    'Interaction research for selection translation; repository archived; no code reused.',
  '桌面划词产品调研；未复用其代码。':
    'Desktop selection product research; no code reused.',
  '本项目直接依赖 MIT 的 selection-hook 与常用开源库；GPL/AGPL 项目仅作产品与交互调研，未复制其代码。':
    'This project directly depends on MIT-licensed selection-hook and common open-source libraries. GPL/AGPL projects were used only for product/interaction research; no code was copied.',
  '已在列表中': 'Already in the list',
  '已加入：{name}': 'Added: {name}',
  '提示词不能为空': 'The prompt cannot be empty',
  '提示词已保存': 'Prompt saved',
  '自定义服务': 'Custom provider',
  '确定清空本机用量记录？此操作不可恢复。':
    'Clear local usage records? This cannot be undone.',
  '用量记录已清空': 'Usage records cleared',
  '历史记录已删除': 'History record deleted',
  '清空全部历史记录和综合摘要？此操作不可恢复。':
    'Clear all history and summaries? This cannot be undone.',
  '历史记录已清空': 'History cleared',
  '收藏已删除': 'Favorite deleted',
  '清空全部收藏？此操作不可恢复。': 'Clear all favorites? This cannot be undone.',
  '收藏已清空': 'Favorites cleared',
  '问：{question}\n答：{answer}': 'Q: {question}\nA: {answer}',
  '已复制完整对话': 'Full conversation copied',
  '已收藏这条问答': 'Answer favorited',
  '已取消收藏': 'Favorite removed',
  '取词服务已重启': 'Selection service restarted',
  '下载更新失败': 'Update download failed',
  '历史记录已有 {count} 条。\n\n将把最早的 {old} 条压缩成一份综合摘要，保留最近 {keep} 条原文。\n\n旧记录会被删除且不可恢复，建议先备份 history.jsonl。压缩会调用 AI，可能产生费用并需要一点时间。继续吗？':
    'History has {count} records.\n\nCompress the earliest {old} records into a summary and keep the latest {keep} originals.\n\nOld records will be deleted permanently; back up history.jsonl first. Compression calls AI, may cost tokens, and may take a moment. Continue?',
  '正在准备历史记录…': 'Preparing history…',
  '压缩失败': 'Compression failed',
  '已压缩 {compressed} 条，保留最近 {kept} 条':
    'Compressed {compressed} records; kept the latest {kept}.',
  '扫描应用失败': 'Failed to scan apps',
  '已移出：{name}': 'Removed: {name}',
  '设置已在本次运行中生效，但写入磁盘失败：{error}':
    'Settings are active for this run, but saving to disk failed: {error}',
  'Base URL 不能为空': 'Base URL cannot be empty',
  'Base URL 必须以 http:// 或 https:// 开头':
    'Base URL must start with http:// or https://',
  '不支持的协议类型': 'Unsupported protocol',
  '删除历史记录写入磁盘失败，请检查磁盘空间后重试。':
    'Failed to delete the history record. Check disk space and try again.',
  '清空历史记录写入磁盘失败，请检查磁盘空间后重试。':
    'Failed to clear history. Check disk space and try again.',
  '删除收藏写入磁盘失败，请检查磁盘空间后重试。':
    'Failed to delete the favorite. Check disk space and try again.',
  '清空收藏写入磁盘失败，请检查磁盘空间后重试。':
    'Failed to clear favorites. Check disk space and try again.',
  '这条历史记录不存在。': 'This history record does not exist.',
  '正在压缩历史记录，请等这次完成后再试。':
    'History compression is running. Wait for it to finish and try again.',
  '历史记录达到 {count} 条后才能压缩。':
    'History must reach {count} records before compression.',
  '没有可用的模型服务，请先去「模型服务」配置。':
    'No usable provider. Configure one under Models first.',
  '还没有选择模型，请先去「模型服务」选择模型。':
    'No model selected. Choose one under Models first.',
  '已开启「仅本机」模式，当前模型不是本机地址，压缩请求已被阻止。':
    'Local-only mode is on and the current model is not local. Compression was blocked.',
  '第 {done}/{total} 批': 'Batch {done}/{total}',
  '已整理 {done}/{total} 条': 'Processed {done}/{total} records',
  '历史记录压缩': 'History compression',
  '正在综合各批摘要…': 'Merging batch summaries…',
  '摘要已保存': 'Summary saved',
  '未知应用': 'Unknown app',
  '检查更新失败：连不上 GitHub。请检查网络或代理，然后点「检查更新」重试。':
    'Update check failed: cannot reach GitHub. Check your network or proxy, then try again.',
  '更新包还没有准备好': 'The update package is not ready yet',
  '开发模式不支持自动更新，请使用打包版':
    'Auto-update is not supported in development mode; use the packaged build.',
  '更新包文件不完整，请重新下载': 'The update package is incomplete; download it again.',
  '安装目录不可写（{target}）。请用管理员身份运行，或到发布页手动下载。':
    'The install folder is not writable ({target}). Run as administrator or download from Releases.',
  '无法启动更新程序：{error}': 'Could not start the updater: {error}',
  '上次更新安装失败，已回滚到当前版本：{error}':
    'The last update failed and was rolled back to the current version: {error}',
  '检查更新失败：GitHub 返回 {status}': 'Update check failed: GitHub returned {status}',
  '检查更新失败：无法识别最新版本号，请稍后重试或打开下载页。':
    'Update check failed: could not read the latest version. Try again or open Releases.',
  '新版本没有提供 SHA-256 校验文件，已停止自动安装。请到发布页手动下载。':
    'The new release has no SHA-256 checksum; auto-install stopped. Download manually from Releases.',
  '更新包校验文件格式不正确，已停止安装。':
    'The checksum file has an invalid format; installation stopped.',
  '正在下载更新': 'Downloading update',
  '正在校验发布信息': 'Verifying release information',
  '下载更新失败：GitHub 返回 {status}': 'Update download failed: GitHub returned {status}',
  '更新包体积异常，已停止下载。': 'The update package size is abnormal; download stopped.',
  '正在下载更新 {percent}%': 'Downloading update {percent}%',
  '正在校验更新包': 'Verifying update package',
  '更新包 SHA-256 校验失败，已删除下载内容。':
    'Update package SHA-256 verification failed; the download was removed.',
  '正在解压更新包': 'Extracting update package',
  '更新包结构不完整': 'The update package structure is incomplete',
  '更新已下载并校验，重启后完成安装':
    'Update downloaded and verified; restart to finish installing'
}

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : match
  )
}

export function translate(
  locale: Locale,
  key: string,
  params?: Record<string, string | number>
): string {
  const template = locale === 'en-US' ? (EN[key] ?? key) : key
  return interpolate(template, params)
}
