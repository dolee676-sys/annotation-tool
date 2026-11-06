# Annotation · AI reading assistant

[简体中文](README.md) | English

[![CI](https://github.com/dolee676-sys/annotation-tool/actions/workflows/ci.yml/badge.svg)](https://github.com/dolee676-sys/annotation-tool/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Windows](https://img.shields.io/badge/Windows-10%2F11-0078D4?logo=windows&logoColor=white)](#download-and-install-windows-1011)

**Select text in any app. AI explains it with the surrounding context. If the selection is a question, it answers first, then explains.**

Works in OneNote, Word, PDF readers, browsers, and editors. Use a local model or your own cloud API key. Costs stay visible.

[**Download for Windows**](https://github.com/dolee676-sys/annotation-tool/releases/latest) · [15-second demo](#demo) · [Why another selection tool?](#why-another-selection-tool) · [First run](#first-run)

> Made by piona · MIT License · [GitHub repository](https://github.com/dolee676-sys/annotation-tool)

## Demo

![Select text → annotate → ask](docs/demo.en.gif)

Real UI demo: select text → annotate → context-aware answer → follow-up. The model shown in the screenshots is a self-test placeholder. The screenshots show the Chinese UI; you can switch to English under Settings → Models → Language.

## Why another selection tool?

Most selection tools send only the selected characters to the model. Annotation reads the surrounding context from the source app, routes the request as a word / question / paragraph, and keeps cost and history locally.

- **Context, not just the selection**: select a term in OneNote, Word, or a PDF and it reads the paragraph around it.
- **Two actions**: Annotate explains term → current context → role. Ask answers the question first, then explains. Both support follow-ups.
- **Local or cloud**: Ollama / LM Studio run locally for free. Cloud providers use your own API key; multipliers, cost, and history stay visible.

### How it compares

| | Annotation | [Jidong](https://microsoftedge.microsoft.com/addons/detail/%E5%8D%B3%E6%87%82-%E5%88%92%E8%AF%8D%E8%A7%A3%E9%87%8A%EF%BC%8C%E7%BB%93%E5%90%88%E4%BD%A0%E7%9A%84%E4%B8%8A%E4%B8%8B%E6%96%87/kodjeigndbhlecbbgdmfemcdopggikfm?hl=zh-CN) | [Pot](https://github.com/pot-app/pot-desktop) | [nextai-translator](https://github.com/nextai-translator/nextai-translator) |
|---|---|---|---|---|
| Works across apps (OneNote/Word/PDF) | Yes | — (web pages only) | Yes | Yes (desktop + browser) |
| Reads source-app context | Yes | Web page context only | — | — |
| Separate annotate / ask modes | Yes | Explain + follow-up | Translation/OCR first | Translation/explain |
| Local models | Yes | — | Plugin/custom setup | OpenAI-compatible endpoint |
| Cost / history / favorites | Yes | History | — | — |
| Platform | Windows | Browser (Edge extension) | Win/mac/Linux | Win/mac + browser |
| License | MIT | Closed source | GPL-3.0 (archived) | AGPL-3.0 |

> Different tools for different jobs. If you only need web translation, Jidong/Pot are lighter. If you read long documents in OneNote/Word and need context plus follow-ups, Annotation fits better. Only publicly confirmed capabilities are listed; a dash does not mean the feature is absent. Based on public information; corrections welcome.
>
> If this saves you time, a star helps others find it. For bugs or ideas, open an [issue](https://github.com/dolee676-sys/annotation-tool/issues).

## Download and install (Windows 10/11)

> Windows 10/11 x64. The release is a portable zip; no installer required.
>
> Download the latest release: **[Releases](https://github.com/dolee676-sys/annotation-tool/releases/latest)**.

1. Download `zhujie-win-x64.zip`.
2. Extract the whole folder to any drive, for example `D:\Apps\zhujie`.
3. Open the extracted `win-unpacked` folder and run `注解.exe` (the executable name is Chinese).
4. If Windows SmartScreen says "Windows protected your PC", click **More info → Run anyway**. The build is currently unsigned; this warning is expected.
5. The settings window opens on first launch. After closing it, the app stays in the system tray; double-click the tray icon to reopen it.
6. Optional: right-click `注解.exe` → Send to → Desktop (create shortcut).

Notes:

- Keep the whole folder. `注解.exe` needs the adjacent `resources` folder.
- Config, history, and usage live in `%APPDATA%\zhujie`; the program can live on any drive.
- Upgrade: quit the app, replace the program folder; data is preserved.
- Uninstall: quit the app, delete the program folder and `%APPDATA%\zhujie`.

## First run

The app starts in **Local only** mode. If you do not have Ollama / LM Studio installed, switch to **Cloud AI**, otherwise no model will be available.

### Option A: Cloud provider

1. Open **Settings → Models**.
2. Choose **Cloud AI**.
3. Pick a provider: DeepSeek, Qwen / Alibaba Cloud Bailian, Kimi, GLM, OpenAI, or any OpenAI-compatible endpoint.
4. Paste your API key, choose a model, then click **Save and test**.
5. Each provider card includes a setup guide (in Chinese) for creating a key and topping up.

> For Alibaba Cloud Bailian, the app filters out models that cannot handle text chat and marks third-party models hosted by Bailian as **"· 百炼版"** (Bailian edition), because they are billed through your Bailian account.

### Option B: Local model

1. Install Ollama or LM Studio.
2. In the app, choose **Local model → Ollama / LM Studio**.
3. Click **Detect local models and enable**.

> Local mode only connects to `127.0.0.1`; selected text never leaves the machine.

## Features

- Cross-app selection chip with **Annotate** and **Ask** actions.
- Context-aware answers, including OneNote document-text fallback.
- Separate word / question / paragraph answer standards.
- Multi-turn follow-ups; the last 4 turns are kept in context.
- History grouped by conversation, favorites, and token/cost statistics.
- Local and cloud providers; per-model cost multipliers; bring your own key.
- Tray app; fullscreen-friendly panel; full Chinese and English UI, including provider guides, history, favorites, usage, and About.
- Update checks from GitHub Releases; downloaded updates are verified with SHA-256.

## Privacy

- **Local mode**: no network requests; selected text stays on the machine.
- **Cloud mode**: the selected text and context are sent to the provider you choose.
- API keys are encrypted with Electron `safeStorage` when available.
- History and usage are stored locally under `%APPDATA%\zhujie`.
- The app does not run a remote server.

## Status and limitations

- Windows 10/11 x64 only.
- The UI can be switched between Chinese and English under Settings → Models → Language.
- The build is unsigned, so SmartScreen may warn on first launch.
- Context capture relies on Windows UI Automation. Some apps (Chromium PDF viewers, elevated windows, remote desktop, exclusive-fullscreen games) may not expose text; the app then sends only the selection.
- Early-stage project. Issues and feedback are welcome.

## Build from source

Requirements: Node.js 24 and Windows.

```bash
npm install
npm run dev
npm run typecheck
npm test
npm run build
npm run dist
```

For provider tutorials and Chinese troubleshooting, see the [Chinese README](README.md).

## License

MIT. See [LICENSE](LICENSE).
