# 贡献指南

感谢你愿意改进「注解」。提交 PR 前请先确认下面几点。

## 开发环境

- Windows 10/11
- Node.js ≥ 18（CI 使用 Node 20）
- npm

```bash
npm install
npm run dev
```

npm 11 可能会拦截安装脚本，需要先允许 Electron 和原生依赖：

```bash
npm approve-scripts electron esbuild selection-hook
```

国内下载 Electron 较慢时可以指定镜像：

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install
```

## 提交前检查

```bash
npm run typecheck
npm run build
npm run selftest
```

`npm run selftest` 会用一个本地 mock 模型跑通：划词 → 注解/提问 → 用量和历史记录。截图输出在 `selftest/`。

## 代码结构

- `src/main/`：Electron 主进程、取词、模型请求、用量与历史
- `src/preload/`：类型化 IPC 桥
- `src/renderer/`：React 界面
- `src/shared/`：共享类型、服务商预设、费用估算

## 注意事项

- 不要提交 `settings.json`、`history.jsonl`、`usage.jsonl`、API Key 或任何本机数据。
- 截图请使用演示数据；`selftest` 默认会用演示应用列表生成设置页截图。
- 本项目使用 MIT 许可，提交即表示同意以相同许可发布。
- 涉及第三方项目时，只借鉴思路，不要复制 AGPL/GPL 代码。
