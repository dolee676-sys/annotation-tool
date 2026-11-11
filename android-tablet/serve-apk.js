const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, 'build');
const apkPath = path.join(root, 'zhujie-tablet.apk');
const hashPath = path.join(root, 'zhujie-tablet.apk.sha256');

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function renderPage() {
  const stat = fs.statSync(apkPath);
  const size = (stat.size / 1024).toFixed(0);
  let sha = '';
  try {
    sha = fs.readFileSync(hashPath, 'utf8').trim().split(/\s+/)[0];
  } catch (error) {
    sha = '未生成';
  }
  let latest = {};
  try {
    latest = JSON.parse(fs.readFileSync(path.join(root, 'latest.json'), 'utf8'));
  } catch (error) {
    latest = {};
  }
  const version = latest.versionName || '0.1.1';
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>注解 · 平板版安装</title>
<style>
  :root { --paper:#f6f2ea; --surface:#fffdf8; --ink:#221f1a; --muted:#847a6b; --accent:#9a4b16; --line:rgba(34,31,26,.12); }
  * { box-sizing:border-box; }
  body { margin:0; min-height:100vh; background:radial-gradient(900px 500px at 50% -10%, #fffdf8, #f1ebe0); color:var(--ink);
    font-family:"Segoe UI","Microsoft YaHei UI","PingFang SC",system-ui,sans-serif; display:flex; justify-content:center; padding:40px 18px; }
  .card { width:min(560px,100%); background:var(--surface); border:1px solid var(--line); border-radius:22px;
    box-shadow:0 24px 70px rgba(48,38,25,.16); padding:28px 28px 26px; }
  .brand { display:flex; align-items:center; gap:12px; margin-bottom:18px; }
  .mark { width:46px; height:46px; border-radius:13px; background:#221f1a; color:#f6f2ea; display:grid; place-items:center;
    font-family:"Songti SC",serif; font-size:23px; }
  h1 { font-family:"Songti SC","SimSun",serif; font-size:26px; margin:0 0 4px; font-weight:600; }
  .sub { font-size:12px; color:var(--muted); }
  .meta { display:flex; gap:8px; flex-wrap:wrap; margin:16px 0 20px; }
  .chip { font-size:10.5px; color:var(--muted); border:1px solid var(--line); border-radius:999px; padding:4px 9px; }
  .download { display:block; text-align:center; text-decoration:none; background:var(--accent); color:#fff8ef;
    font-size:15px; padding:15px; border-radius:14px; margin:8px 0 6px; }
  .download small { display:block; font-size:10.5px; opacity:.75; margin-top:3px; }
  ol { margin:18px 0 0; padding-left:20px; font-size:13px; line-height:1.9; color:#3a352d; }
  ol b { color:var(--ink); }
  .note { margin-top:18px; padding:12px 14px; background:#faf6ee; border:1px solid var(--line); border-radius:12px;
    font-size:11.5px; line-height:1.75; color:var(--muted); }
  .sha { margin-top:14px; font-family:Consolas,monospace; font-size:9.5px; color:#a19787; word-break:break-all; }
  .back { margin-top:18px; font-size:11px; color:var(--muted); }
  .back a { color:var(--accent); }
</style>
</head>
<body>
  <main class="card">
    <div class="brand">
      <div class="mark">注</div>
      <div><h1>注解 · 平板版</h1><div class="sub">只给自己用 · 不发布 · 不上架</div></div>
    </div>
    <div class="meta">
      <span class="chip">版本 ${version}</span>
      <span class="chip">${size} KB</span>
      <span class="chip">已签名</span>
      <span class="chip">Android 8+</span>
    </div>
    <a class="download" href="/zhujie-tablet.apk">下载 APK<small>点这里开始下载，约 ${size} KB</small></a>
    <ol>
      <li>下载完成后，在通知栏或文件管理器里点开 <b>zhujie-tablet.apk</b>。</li>
      <li>ColorOS 提示“未知来源应用”时，允许一次，然后继续安装。</li>
      <li>打开「注解」→ 设置 → 选服务商、模型，粘贴你的 API Key，保存。</li>
      <li>在任意应用里选中文字，系统菜单里会出现 <b>注解 / 提问</b>。</li>
    </ol>
    <div class="note">
      平板版没有本机 Ollama，也没有英文界面；历史和 Key 只保存在这台平板。<br>
      如果浏览器下载不了，用数据线把 APK 拷到平板的 <b>Download</b> 目录再点开。
    </div>
    <div class="sha">SHA-256 ${escapeHtml(sha)}</div>
  </main>
</body>
</html>`;
}

const server = http.createServer((request, response) => {
  const url = request.url.split('?')[0];
  if (url === '/' || url === '/index.html') {
    try {
      const html = renderPage();
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(html);
    } catch (error) {
      response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('还没有生成 APK。');
    }
    return;
  }
  if (url === '/latest.json') {
    const manifest = path.join(root, 'latest.json');
    if (!fs.existsSync(manifest)) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('not found');
      return;
    }
    response.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    fs.createReadStream(manifest).pipe(response);
    return;
  }
  if (url === '/zhujie-tablet.apk') {
    if (!fs.existsSync(apkPath)) {
      response.writeHead(404);
      response.end('not found');
      return;
    }
    const stat = fs.statSync(apkPath);
    response.writeHead(200, {
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Length': stat.size,
      'Content-Disposition': 'attachment; filename="zhujie-tablet.apk"',
      'Cache-Control': 'no-store'
    });
    fs.createReadStream(apkPath).pipe(response);
    return;
  }
  response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end('not found');
});

server.listen(8766, '0.0.0.0', () => {
  let ip = '127.0.0.1';
  try {
    const interfaces = require('os').networkInterfaces();
    const candidates = [];
    Object.keys(interfaces).forEach((name) => {
      interfaces[name].forEach((item) => {
        if (item.family === 'IPv4' && !item.internal) candidates.push(item.address);
      });
    });
    ip = candidates.find((value) => value.startsWith('10.')) || candidates[0] || ip;
  } catch (error) {
    // keep localhost
  }
  console.log('install page: http://' + ip + ':8766/');
});
