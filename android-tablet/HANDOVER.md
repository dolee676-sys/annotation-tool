# 注解 · 安卓平板端 · 交接文档

> 给接手本项目的 AI / 开发者的上手指南。个人自用项目，不上架应用商店。
> 制作：piona · MIT · 仓库：https://github.com/dolee676-sys/annotation-tool

## 目录
1. 一句话与现状
2. 目录结构
3. 构建方式（无 Gradle）
4. 版本号规则（先读）
5. 运行时架构与数据流
6. 关键文件职责
7. WebView 前端（assets/js）
8. 原生桥接 API
9. 数据与隐私
10. 发布流程（tools）
11. 已知取舍与限制（务必先读）
12. 安全红线
13. 调试技巧
14. 版本历史（简表）
15. 未完成 / 可继续的方向
16. 署名与许可

---

## 1. 一句话与现状
「注解」是一个划词 AI 阅读助手：在任意应用里选中文字 → 出现「注/问」→ 结合上下文解释或问答，调用用户自己配置的 OpenAI 兼容模型。本目录是 **Android 平板端**（原生 Java 壳 + WebView 前端），个人自用、不上架、无账号、无云同步。

- 包名 `com.piona.zhujie`；当前线上版本 0.1.38 / versionCode 1016。
- 分发：仓库 `android-release/` 目录 + GitHub Releases（tag `android-v<ver>`）；README 里 `zhujie-tablet-latest.apk` 是稳定下载链接。
- 源码：本目录 `android-tablet/`（已上传 GitHub）。

## 2. 目录结构
```
android-tablet/
├─ build.sh                     # 构建脚本（aapt2/javac/d8/zipalign/apksigner）
├─ serve.js / serve-apk.js      # 本机静态/APK 服务（方便平板同 WiFi 下载，非应用代码）
├─ tools/
│  ├─ make-latest.js            # 生成 build/latest.json（url/sha256/size/notes）
│  ├─ pack.ps1                  # 把 dex + assets 塞进 aapt2 产出的 base.apk
│  ├─ push-android-release.js   # 发布 APK+latest.json，并创建 GitHub Release
│  ├─ push-source.js            # 上传本目录源码到 GitHub（排除 build/keystore/node_modules）
│  ├─ read-docx.ps1             # 工具：把 docx 提取为文本（评审报告用）
│  └─ qr/                       # 生成二维码用的 qrcode 依赖（仅 package.json/lock）
├─ app/
│  ├─ AndroidManifest.xml
│  ├─ src/com/piona/zhujie/*.java   # 原生壳（见第 6 节）
│  ├─ assets/                   # WebView 前端（html/css/js/img）
│  └─ res/                      # mipmap 图标、values、xml/accessibility_service.xml
└─ keystore/                    # 签名私钥与密码（禁止上传，已 gitignore）
```

## 3. 构建方式（无 Gradle）
`bash build.sh`，7 步：
1. `aapt2 compile` 编译资源 → `aapt2 link` 链接 APK（**--version-code/--version-name 在这里注入，会覆盖 Manifest**）。
2. `javac` 编译 Java（`--release 11`，classpath 指向 `android.jar`）。
3. `d8` 转 dex。
4. `pack.ps1` 把 dex 与 assets 打进 APK。
5. `zipalign -p 4` 对齐。
6. `apksigner` 用 `keystore/zhujie.jks` 签名（v1+v2+v3；v1 在 minSdk≥24 时非必需但会附带）。
7. 复制出 `build/zhujie-tablet-<ver>.apk` 并生成 `build/latest.json`。

依赖：本机 Android SDK（build-tools 35.0.0、platforms/android-35）。`build.sh` 顶部：
```
SDK="${ANDROID_HOME:-D:/dev/sdk/android-sdk}"   # 换机器要改
BT="$SDK/build-tools/35.0.0"
PLATFORM="$SDK/platforms/android-35/android.jar"
```
首次构建会自动 `openssl rand` 生成 keystore 与 `keystore/password.txt`；**两者都不可上传**。

## 4. 版本号规则（先读）
- versionCode 必须**单调递增**。本项目从 1000 起手工递增：1000=0.1.22, 1001=0.1.23, … 1016=0.1.38。
- **唯一来源是 `build.sh` 的 `VERSION_CODE`/`VERSION_NAME`**。Manifest 里也写了一份，但 `aapt2 link --version-code` 会覆盖它，所以以 build.sh 为准（Manifest 那份仅为人读，改不改不影响产物）。
- 升级安装要求新包 versionCode > 已装，否则系统提示「版本一致/降级」被拒。

## 5. 运行时架构与数据流
1. **无障碍取词**（SelectionService）：监听 `TYPE_VIEW_TEXT_SELECTION_CHANGED`、窗口/内容变化等 → 读取选区 → 屏幕上方弹「注/问」chip（TYPE_ACCESSIBILITY_OVERLAY）→ 点按后 `showOverlay` 展示内嵌 `panel.html` 的面板。
2. **「划」抓取**：屏幕边缘悬浮球 → 进入选区层 → 拖选 → `takeScreenshot`（API 30+）→ `ScreenOcr` 调 Qwen-VL 识别文字 → 得到文字后弹 chip。
3. **复制取词**：剪贴板监听（默认开，可在设置关）→ 复制文字后弹 chip。
4. **面板**：`panel.html` + `Bridge`，做注解/提问、流式回答、停止、重试、收藏、钉住。
5. **主界面**：`index.html` + `app.js`，含阅读器、记录（历史/收藏/用量）、设置（模型/取词/通用/关于四组）、更新。
6. **AI 调用**：WebView JS 通过 `Bridge.chat` 调原生 `AiClient`（HttpURLConnection，避开浏览器 CORS），流式回传；`core.js` 的 `chat()` 走 `invoke('chat', ...)`。
7. **更新**：`Updater` 拉 `latest.json`（api.github.com + raw 两个源）→ 下载（多源：raw / Release 资产 / jsdelivr，SHA-256 校验）→ versioned 缓存文件（`zhujie-update-<code>.apk`）→ `UpdateFileProvider` 交给系统安装。

## 6. 关键文件职责（app/src/com/piona/zhujie）
- `SelectionService.java`：无障碍服务（1.6k 行，上帝类）。选区监听、周期扫描、剪贴板、chip、悬浮面板、截屏、OCR、选区层、取词总开关。改动风险最高。
- `AiClient.java`：原生 HTTP 聊天，OWNER 映射按 WebView 取消；`baseUrlError` 限制公网明文 HTTP。
- `Bridge.java`：主界面/面板的 JS↔原生桥（设置、聊天、历史、收藏、用量、更新、剪贴板、开浏览器等）。
- `OverlayBridge.java`：悬浮面板（SelectionService 里的 WebView）的桥。
- `Store.java`：SharedPreferences 封装；`settings` 用 Android Keystore AES-GCM 加密（失败回退明文、解密失败读为空，刻意不锁死）；history/favorites/usage 明文 JSON，有上限。
- `PanelActivity.java` / `AnnotateActivity.java` / `AskActivity.java`：系统选中菜单（PROCESS_TEXT）入口；`singleTop`，`onNewIntent` 已处理二次传入。
- `MainActivity.java`：主界面承载（WebView）。启动时同步取词总开关对应的组件启用状态。
- `Updater.java`：更新检查/下载/安装；多源、SHA-256、版本/包名/签名校验、拒绝降级、版本化缓存、版本对照提示。
- `UpdateFileProvider.java`：把缓存 APK 以 content:// 暴露给安装器；按 URI 文件名读取并对文件名做白名单校验。
- `SafeWebViewClient.java`：只信任 `file:///android_asset/`，http(s) 交系统浏览器，其余 scheme 拒绝。
- `ScreenOcr.java`：Qwen-VL 截图识别。
- `SelectionLayerView.java` / `PanelDragHandle.java`：拖选层 / 面板拖拽。

## 7. WebView 前端（app/assets/js）
- `core.js`：桥接入口 `invoke()`（优先 `window.AndroidBridge`，否则内置 `Mock` 便于浏览器预览）；设置读写；`chat/cancel`；`record`（写历史/用量）；`addFavorite`+AI 标题概括；`threadHtml()` 统一会话渲染（问题+历史+当前回答）；价目倍率。
- `app.js`：主界面逻辑（阅读器、记录、设置四组、更新状态机、取词总开关）。
- `panel.js` / `capture.js`：悬浮面板 / 划抓取页。
- `presets.js`：服务商、模型列表、价目；`prompt.js`：默认提示词。
- `marked.min.js` / `purify.min.js`：Markdown 渲染 + 净化（本地内置，无 CDN）。

## 8. 原生桥接 API（Bridge / OverlayBridge 主要方法）
getSettings/saveSettings、chat/cancel/cancelOwner、getHistory/addHistory、getFavorites/addFavorite/removeFavorite/updateFavorite、getUsage/addUsage、copy、openUrl、openMain、getVersion、checkUpdate/downloadUpdate/installUpdate、openAccessibilitySettings/openAppInfo、isAccessibilityEnabled/isAccessibilityConnected、isCaptureEnabled/enableCapture（划气泡）、isCaptureMaster/setCaptureMaster（取词总开关）、panelInit 等。新增桥方法记得两端同步（Java `@JavascriptInterface` + JS 调用）。

## 9. 数据与隐私
- 所有设置、历史、收藏、用量只存本机 `SharedPreferences`（`zhujie_store`）。不上传任何数据到作者服务器。
- 仅把「你选中的文字 / 截图」发给你自己配置的模型服务商（用途在界面已披露）。
- 取词总开关 `captureEnabled`：关闭时停用 chip/划/扫描/剪贴板，并禁用系统选中菜单的注解/提问活动组件；开启恢复。
- 隐私红线见第 12 节。

## 10. 发布流程（tools，需要 GH_TOKEN）
1. 改 `build.sh` 的 VERSION_CODE/VERSION_NAME 并 `bash build.sh`。
2. `node tools/push-android-release.js`：把 `build/zhujie-tablet-<ver>.apk`、`zhujie-tablet-latest.apk`、`latest.json` 推到 `android-release/`，并创建/更新 Release（tag `android-v<ver>`，`make_latest=false` 以免顶掉桌面端的 Latest）。
3. `node tools/push-source.js`：上传本目录源码到 GitHub（自动排除 build/keystore/node_modules/apk/log）。注意：上传前务必确认没有把 keystore、密码、个人 Key、个人局域网 IP 带进去。
4. GH_TOKEN 从 `git credential fill` 取，切勿打印/提交。

## 11. 已知取舍与限制（务必先读）
- **个人自用**：不上架；无单元测试、无 CI、无崩溃上报、无回滚机制（本目录此前未纳入 git，本次为基线）。
- **版本号双写**：以 build.sh 为准（见第 4 节），Manifest 那份不影响产物。
- **copyChip 默认开**：为「复制即取词」的 OneNote 流程；可在设置关。
- **Keystore 回退**：加密失败退化为明文；解密失败时读取为空（密文不删，下次保存覆盖）。设置页已如实说明。
- **网络**：`raw.githubusercontent.com` 国内不稳；更新已做多源兜底（raw/Release/jsdelivr）+「手动下载」按钮。旧版本更新器可能卡灰，需手动装一次新版。
- **iOS 未做**：iOS 不允许第三方全局取词/悬浮窗；如需，走 Share Extension + 原生壳（需 Mac/CI + 签名）。
- **minSdk 26**；「划」截图 OCR 需 Android 11+（API 30）。

## 12. 安全红线
- **绝不提交**：`keystore/`（zhujie.jks / password.txt）、任何 API Key、个人数据、个人局域网 IP。
- WebView 只加载 `file:///android_asset/`；外链交系统浏览器；CSP `script-src` 不含 `unsafe-inline`。
- 更新包校验：SHA-256 + versionCode + 包名 + 签名，拒绝降级/异签名。
- `baseUrlError`：公网只允许 https；http 仅放行 localhost/局域网。

## 13. 调试技巧
- 构建后看 `build/verify.txt`（apksigner 校验）。
- `apksigner verify --verbose --min-sdk-version 21 <apk>` 可显示 v1（默认按 minSdk 26 会显示 v1:false，属正常）。
- 真机：`adb logcat | grep -i zhujie`；或看应用内 toast/状态行。
- `serve.js` / `serve-apk.js`：本机起静态/APK 服务，平板同 WiFi 可下载；脚本会自动选 10.x 网卡。

## 14. 版本历史（简表）
- 0.1.22 起版本码改为 1000+（修复「已安装更高版本」）。
- 0.1.23–0.1.25：安全加固（WebView 白名单、更新签名校验、baseUrlError）、IME 回车、跨窗口取消、错误重试、停止生成、深色模式。
- 0.1.27–0.1.28：Keystore 加密设置、超长截断提示、读屏 aria、扫描降频→再回调、关于页署名/Star。
- 0.1.29–0.1.30：面板二次划词刷新、未配置提示可点、切服务商保留 Key、CSP 去内联。
- 0.1.31–0.1.32：提问显示问题+多轮会话；设置四组化；去面板阴影、识别中提示、chip 去预览。
- 0.1.33–0.1.34：收藏卡片化+AI 标题；模型不被强制改回、提示词不覆盖、收藏概括计量、OCR 地址校验。
- 0.1.35–0.1.38：更新包版本化缓存/URI、多源兜底、版本对照、取词总开关（含系统菜单入口）、下载看门狗与「手动下载」。

## 15. 未完成 / 可继续的方向
- 历史搜索 / 单条删除 / 导出备份；失败记录分区。
- OCR 独立「识图 Key」入口（现固定用通义千问 Key）。
- 下载取消；改用 PackageInstaller Session 拿真实安装失败码。
- 无障碍事件收窄（注意别破坏 OneNote/浏览器的取词）；48dp 触控；`prefers-reduced-motion`。
- 把源码接入常规 git 提交 + CI（javac 构建 + 10 条纯函数测试）；补齐 THIRD_PARTY 依赖清单。

## 16. 署名与许可
制作 piona；MIT License；仓库 https://github.com/dolee676-sys/annotation-tool 。
