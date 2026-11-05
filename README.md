# 注解 · 划词 AI 助手

[![CI](https://github.com/dolee676-sys/annotation-tool/actions/workflows/ci.yml/badge.svg)](https://github.com/dolee676-sys/annotation-tool/actions/workflows/ci.yml)

> 制作人：piona · MIT License · [GitHub 仓库](https://github.com/dolee676-sys/annotation-tool)

在任意应用里选中一段文字，旁边会出现「注解 / 提问」小框；点开就是 AI 解析或问答。支持本机模型和云端模型，并记录每次调用的 token、费用和历史。

[下载最新版](https://github.com/dolee676-sys/annotation-tool/releases/latest) · [第一次配置](#第一次使用配置-ai) · [常见问题](#常见问题)

![注解面板](selftest/panel.png)

## 下载安装（推荐）

> 适用于 Windows 10/11 64 位。绿色免安装版，解压即用。
>
> 下载最新版：[Releases](https://github.com/dolee676-sys/annotation-tool/releases/latest)。

1. 打开 [Releases](https://github.com/dolee676-sys/annotation-tool/releases)，下载 `zhujie-win-x64.zip`。
2. 解压到 `D:\Apps\zhujie`（或任意目录）。
3. 进入解压后的 `win-unpacked` 文件夹，双击 `注解.exe`。
4. 如果 Windows 提示“已保护你的电脑”，点「更多信息」→「仍要运行」。当前版本未做代码签名，这是正常提示。
5. 首次启动会自动打开设置窗口；关闭设置后程序留在右下角托盘，双击托盘图标可再次打开。
6. 想放桌面：右键 `注解.exe` → 发送到 → 桌面快捷方式。

注意：

- 解压后请保留整个文件夹，不要只复制 `注解.exe`，同目录的 `resources` 等文件是程序运行必需的。
- 程序放哪个盘都行；配置、历史、用量默认在 `%APPDATA%\zhujie`。
- 升级：退出应用，替换程序文件夹即可，数据会保留。
- 卸载：退出应用，删除程序文件夹、桌面快捷方式，再删除 `%APPDATA%\zhujie`。

## 第一次使用：配置 AI

应用默认是「仅本机」模式。**如果你没有安装 Ollama / LM Studio，请选「云端 AI」**，否则会提示没有可用模型。

### 推荐：免费云端模型（智谱 GLM-4-Flash）

1. 设置窗口 → 左侧「模型服务」。
2. 点「云端 AI」。
3. 服务商选「智谱 GLM」。
4. 点「没有 Key？去 智谱 GLM 获取」，注册/登录后创建一个 API Key。
5. 回到应用，把 Key 粘贴到「API Key」。
6. 模型选 `glm-4-flash`（旁边有「免费」标识）。
7. 点「保存并测试」。显示连接正常即可使用。

![选择服务商](selftest/models-cloud.png)

### 或者：本机模型（完全免费、不联网）

1. 安装 Ollama，并下载一个模型，例如 `qwen2.5:7b`。
2. 应用里选「本机模型」→「Ollama」。
3. 点「检测本机模型并启用」。

本机模式只访问 `127.0.0.1`，选中的文字不会离开电脑。

### 其他云端服务商

DeepSeek、通义千问、Kimi、OpenAI 都在列表里。选服务商、粘贴 API Key、选模型、点「保存并测试」即可。费用和免费额度以服务商页面为准。

> 云端模式会把选中的文字发送给对应服务商，不要用于敏感内容。带「免费」标识的模型由服务商提供免费额度，具体额度和有效期可能变化。

选择模型时，旁边会显示消耗倍率：以 `deepseek-chat` 为 1×，按每百万 tokens 的输入+输出价格估算。数字越小越省，本机模型显示「免费」。倍率只用于横向比较，实际费用以「用量统计」和服务商账单为准。

## 怎么用

### 划词注解 / 提问

1. 在浏览器、PDF、Word、编辑器等应用里选中一段文字。
2. 文字旁边会出现「注解」「提问」两个按钮。
3. 点「注解」直接生成解析；点「提问」输入问题，AI 会结合选中的文字回答。
4. 回答完可以继续问。最近 4 轮问答会一起发送，所以“第二点再展开”“用一句话总结”这类指代会保留上下文。

![提问](selftest/panel-ask-answer.png)

### 面板操作

- 点「注解」后面板会立即出现，上下文在后台读取，不需要先等面板加载。
- 右上角钉子：钉住后点面板外面不会关闭；再点一次取消钉住。
- 未钉住时，点面板外面或按 `Esc` 关闭。
- 顶部可以切换模型；右上角可以复制内容、重新生成。
- 面板默认 600×640，可拖拽、可继续拉伸。

### 结合上下文

默认读取选中位置前后各 300 字，把选中部分标成【选中】后一起发送。

- 不截屏，只读取当前应用向 Windows 无障碍接口暴露的文本。
- 有些应用/浏览器/PDF 阅读器不暴露文本，此时面板会显示「未读取到上下文」，并自动只发送选中文字。
- 同一应用失败后 2 分钟内不再重试，避免连续等待。
- 可以在「注解提示词」页关闭上下文，或把前后字数改成 100–1000。

### 超长选中

「注解提示词」页可以设置「单次发送上限」，默认 2000 字。选中文字超过上限时只发送前面的部分，面板会明确显示「已截断，仅发送前 N 字」。

![超长选中提示](selftest/panel-truncated.png)

### 历史、用量、应用范围

- **历史记录**：保存每次注解/提问的选中文字、问题、回答、模型和费用；可搜索、复制、单条删除或清空。满 1000 条后可以压缩成一份综合摘要，保留最近 200 条。
- **用量统计**：按模型、应用、天统计 tokens、费用和耗时；本机模型费用为 0。
- **应用范围**：默认所有应用；也可以只允许指定应用。设置里能搜索已安装和正在运行的应用。

![历史已满](selftest/history-full.png)

![综合摘要](selftest/history-compressed.png)

## 常见问题

### 选中文字没有出现小框

- 确认托盘菜单里的「划词注解已开启」。
- 检查「应用范围」是否选成了「仅指定应用」，并且没有勾选当前应用。
- 全屏独占游戏或部分全屏视频上，置顶小框可能不可见。
- 以管理员身份运行的应用，可能需要用管理员身份启动「注解」。

### 点开提示没有可用模型

- 去「模型服务」按上面的步骤配置一个模型。
- 选了「云端 AI」：需要填 API Key 并点「保存并测试」。
- 选了「本机模型」：需要先启动 Ollama / LM Studio，并下载至少一个模型。

### 为什么显示「未读取到上下文」

有些应用没有向 Windows 无障碍接口暴露选中文本，属于正常回退。不影响注解和提问，只是少发送了前后文。

### 费用怎么算

本机模型免费。云端按服务商实际账单计费；应用内按内置价目估算，供参考。「用量统计」页能看到每次请求的 tokens 和估算费用。

### Windows 提示不安全 / SmartScreen

当前版本没有代码签名，属于正常提示。点「更多信息」→「仍要运行」即可。请只从本仓库 Releases 下载，不要用来路不明的压缩包。

### 数据在哪里，怎么备份或卸载

- 配置、历史、用量：`%APPDATA%\zhujie`。
- 备份：复制这个文件夹。
- 卸载：退出应用，删除程序文件夹和桌面快捷方式，再删除 `%APPDATA%\zhujie`。
- 历史对话和摘要是明文文件，没有额外加密。如果电脑多人共用，请自行保护用户目录。

### 怎么更新

退出应用，下载新版压缩包，解压替换程序文件夹即可；`%APPDATA%\zhujie` 里的配置和历史会保留。

## 进阶设置

- **模型服务**：切换本机/云端、更换模型、查看免费标识与消耗倍率。
- **注解提示词**：修改注解风格、开关上下文、调整上下文长度和单次发送上限。
- **应用范围**：全部应用 / 仅指定应用，支持搜索进程名。
- **历史记录**：搜索、复制、删除；满 1000 条后压缩成综合摘要。
- **关于**：开机启动、查看数据目录。

## 从源码运行（开发者）

> 普通用户不需要看这一节。下载绿色版即可使用。

要求：Node.js ≥ 20、Windows 10/11；单元测试和 CI 使用 Node 24。

```bash
npm install
npm run dev
```

如果 npm 11 拦截安装脚本：

```bash
npm approve-scripts electron esbuild selection-hook
```

国内网络下载 Electron 较慢时：

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install
```

常用命令：

```bash
npm run typecheck   # 主进程 + 渲染进程类型检查
npm test            # 单元测试与 LLM 客户端错误分支测试
npm run build       # 生产构建到 out/
npm run selftest    # 用本地 mock 模型跑通全链路，截图写入 selftest/
npm run dist        # electron-builder 打包
```

### 打包与安装到本机

```bash
npm run build
npx electron-builder --win --dir --x64 --config.win.signAndEditExecutable=false
powershell -ExecutionPolicy Bypass -File scripts/install-shortcut.ps1
# 如需改安装位置：
# powershell -ExecutionPolicy Bypass -File scripts/install-shortcut.ps1 -InstallDir 'D:\Apps\zhujie'
```

`signAndEditExecutable=false` 是为了绕开本机 Windows 无法创建符号链接、导致签名工具解压失败的问题。打包版未做代码签名，首次运行可能触发 SmartScreen。

### 项目结构

```text
src/main/index.ts        应用生命周期、IPC 编排、流式请求与用量落库
src/main/selection.ts    全局取词、鼠标/键盘钩子、物理像素 → DIP
src/main/windows.ts      小框 / 注解面板 / 设置窗口 / 托盘
src/main/ai.ts           Ollama 原生 + OpenAI 兼容流式客户端、token 统计
src/main/settings.ts     配置持久化、应用白名单、密钥加密
src/main/usage.ts        JSONL 用量记录
src/main/history.ts      JSONL 历史对话与综合摘要
src/main/compress.ts     历史分批归纳与最终综合摘要
src/main/security.ts     本地页面信任判断（导航 / IPC 共用）
src/shared/presets.ts    服务商预设、免费模型标识
src/shared/pricing.ts    内置人民币价目与费用估算
src/preload/index.ts     设置窗口的 IPC 桥
src/preload/panel.ts     注解面板的最小权限 IPC 桥
src/preload/chip.ts      划词小框的最小权限 IPC 桥
src/renderer/            React 界面（单入口按 hash 分流）
src/shared/types.ts      主进程 / 渲染进程共享契约
tests/core.test.ts       纯函数、提示词与导航安全单元测试
tests/ai.test.ts         OpenAI / Ollama 解析、401、坏行、中止测试
```

### 安全边界

- 小框、注解面板、设置窗口分别使用独立的 preload：小框只有 `chipClick`，面板只有 `panel:*` 与复制，只有设置窗口能读写配置、历史和用量。
- 三个窗口都启用 `sandbox`、`contextIsolation`，关闭 `nodeIntegration`。
- 拦截 `will-navigate` / `will-redirect` / `will-frame-navigate`：非应用自身页面的导航一律阻止，http/https 链接交给系统浏览器打开。
- 所有 IPC handler 校验发送方 URL，非本地应用页面直接拒绝。
- 生产构建 CSP 使用 `connect-src 'self'`，并禁用 `object`、`base`、`frame`。

### 数据与隐私

- 配置：`%APPDATA%\zhujie\settings.json`
- 用量：`%APPDATA%\zhujie\usage.jsonl`（最多保留 20000 条，超出后按批整理）
- 历史对话：`%APPDATA%\zhujie\history.jsonl`（最多 1000 条）
- 历史综合摘要：`%APPDATA%\zhujie\history-summaries.json`（最多 50 份）
- API Key：Electron `safeStorage` 加密后写入配置；渲染进程只能看到“是否已保存”，拿不到明文
- 默认「仅本机」：只允许 `localhost` / `127.0.0.1` / `::1` 的地址；关闭后才会访问你配置的云端接口
- 无账号、无遥测、无云同步
- 历史对话和摘要是明文 JSONL/JSON，只保存在本机

### 验证记录

<details>
<summary>开发验证记录（2026-11-04 ~ 11-05，点开）</summary>

- `npm run typecheck`：通过
- `npm test`：13 项通过（价目、消耗倍率、免费标识、选区标记、多轮追问、系统提示词、导航信任、旧用量 latencyMs 守卫、OpenAI SSE、Ollama NDJSON、401、坏行、中止、模型列表）
- `npm run build`：通过（主进程 / 3 个 preload / 渲染进程）
- `npm run selftest`：通过
  - 模拟划词 → 小框 → 面板 → 流式输出 → 入库
  - 注解 2 次、提问 2 次，共 4 次请求 / 1600 tokens；`turns=2`，验证追问带上了上一轮回答
  - 历史压缩：模拟 1000 条 → 压缩最早 800 条 → 保留 200 条、生成 1 份摘要
  - 历史上限：文件 1004 行，压缩后重写为 200 行
  - 安全边界：面板 preload 只暴露面板能力；设置窗口不暴露面板/小框能力；面板导航到本地非应用页面后 URL 仍停留在 `#panel`
  - 超长选中：上限 100 字时面板显示「已截断，仅发送前 100 字」
  - 取词服务状态 `running`
- 小框透明：去掉外阴影后，桌面级像素采样确认按钮外区域与背景一致，不再有矩形暗框
- 打包版：安装到 `D:\Apps\zhujie` 后执行 `--selftest`，exit=0、requests=7、history=201、压缩 800→200；日志见 `selftest/package-selftest.txt`

未验证：真实 Ollama / LM Studio 推理、真实第三方应用中的系统级鼠标点击、NSIS 安装包、macOS / Linux。

</details>

### 参考项目与许可证

本项目以 MIT 发布。调研与使用情况如下：

| 项目 | 许可证 | 用法 |
| --- | --- | --- |
| [0xfullex/selection-hook](https://github.com/0xfullex/selection-hook) | MIT | **直接依赖**：全局划词取词、坐标、应用名、鼠标键盘钩子 |
| [zcx960/AIA-selection-assistan](https://github.com/zcx960/AIA-selection-assistan) | MIT | 交互与窗口定位思路参考；未整体照搬 |
| [Cherry Studio](https://github.com/CherryHQ/cherry-studio) | AGPL-3.0 | 产品形态调研；未复用代码 |
| [pot-desktop](https://github.com/pot-app/pot-desktop) | GPL-3.0 | 划词翻译交互调研；仓库已归档，未复用代码 |
| [nextai-translator](https://github.com/nextai-translator/nextai-translator) | AGPL-3.0 | 桌面划词产品调研；未复用代码 |
| [STranslate](https://github.com/STranslate/STranslate) | MIT | Windows 划词/OCR 产品调研；未复用代码 |

### 已知限制

- 部分应用不向系统无障碍接口暴露选中文本，此时可能取不到；大部分情况下会自动回退到只发送选中文字。
- 全屏独占游戏或部分全屏视频上，置顶小框可能不可见。
- 首次使用必须先配置模型；没有模型时小框仍会出现，但点开会提示去设置。
- token 数优先取服务端返回的 `usage`；服务端不返回时按字符估算，界面以 `≈` 标记。
- 费用为内置价目估算，实际以服务商账单为准；自定义接口需要自己填写价格。
- 发布包未做 Authenticode 签名，也没有自动更新器；Windows SmartScreen 可能提示。
- 应用扫描基于“有窗口的运行中进程 + 开始菜单快捷方式”，少量带窗口的后台工具/桌面宠物也可能出现；可用「仅指定应用」白名单忽略。
