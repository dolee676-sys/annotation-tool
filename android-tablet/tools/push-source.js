const fs = require('fs');
const path = require('path');

// 把 android-tablet/ 源码上传到 GitHub（排除 build/keystore/node_modules 等敏感或冗余内容）。
const repo = 'dolee676-sys/annotation-tool';
const token = process.env.GH_TOKEN;
if (!token) {
  console.error('NO_TOKEN');
  process.exit(1);
}
const api = 'https://api.github.com';
const authHeaders = {
  Authorization: 'Bearer ' + token,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'zhujie-source-push'
};

async function gh(p, method = 'GET', body) {
  const response = await fetch(api + p, {
    method,
    headers: authHeaders,
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(method + ' ' + p + ' -> ' + response.status + ' ' + text.slice(0, 300));
  }
  return text ? JSON.parse(text) : null;
}

const ROOT = path.resolve(__dirname, '..', '..'); // tools -> android-tablet -> repo root
const SRC = path.join(ROOT, 'android-tablet');
const EXCLUDE = [
  /(^|\/)build\//,
  /(^|\/)keystore\//,
  /(^|\/)node_modules\//,
  /\.apk$/i,
  /\.log$/i,
  /\.jks$/i,
  /(^|\/)password\.txt$/i,
  /(^|\/)HANDOVER\.md$/i
];

function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = path.relative(ROOT, full).split(path.sep).join('/');
    if (EXCLUDE.some((re) => re.test(rel))) continue;
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      walk(full, out);
    } else {
      out.push({ full, rel });
    }
  }
}

(async () => {
  const files = [];
  walk(SRC, files);
  const ref = await gh('/repos/' + repo + '/git/ref/heads/main');
  const head = ref.object.sha;
  const commit = await gh('/repos/' + repo + '/git/commits/' + head);
  const tree = [];
  for (const file of files) {
    const content = fs.readFileSync(file.full).toString('base64');
    const blob = await gh('/repos/' + repo + '/git/blobs', 'POST', { content, encoding: 'base64' });
    tree.push({ path: file.rel, mode: '100644', type: 'blob', sha: blob.sha });
    console.log('blob', file.rel);
  }
  const newTree = await gh('/repos/' + repo + '/git/trees', 'POST', {
    base_tree: commit.tree.sha,
    tree
  });
  const newCommit = await gh('/repos/' + repo + '/git/commits', 'POST', {
    message: 'source: 安卓平板端源码 + 交接文档 (HANDOVER.md)',
    tree: newTree.sha,
    parents: [head]
  });
  await gh('/repos/' + repo + '/git/refs/heads/main', 'PATCH', {
    sha: newCommit.sha,
    force: false
  });
  console.log('PUSHED', newCommit.sha);
  console.log('FILES', files.length);
})().catch((error) => {
  console.error(String(error).slice(0, 1000));
  process.exit(1);
});
