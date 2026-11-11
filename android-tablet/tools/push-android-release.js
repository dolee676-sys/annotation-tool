const fs = require('fs');

const repo = 'dolee676-sys/annotation-tool';
const token = process.env.GH_TOKEN;
if (!token) {
  console.error('NO_TOKEN');
  process.exit(1);
}
const api = 'https://api.github.com';
const uploads = 'https://uploads.github.com';
const authHeaders = {
  Authorization: 'Bearer ' + token,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'zhujie-android-release'
};

async function gh(path, method = 'GET', body) {
  const response = await fetch(api + path, {
    method,
    headers: authHeaders,
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(method + ' ' + path + ' -> ' + response.status + ' ' + text.slice(0, 300));
  }
  return text ? JSON.parse(text) : null;
}

async function releaseByTag(tag) {
  const response = await fetch(api + '/repos/' + repo + '/releases/tags/' + tag, {
    headers: authHeaders
  });
  if (response.status === 404) {
    return null;
  }
  const text = await response.text();
  if (!response.ok) {
    throw new Error('releaseByTag ' + tag + ' -> ' + response.status + ' ' + text.slice(0, 300));
  }
  return JSON.parse(text);
}

async function uploadAsset(releaseId, name, source, contentType) {
  const data = fs.readFileSync(source);
  const url = uploads + '/repos/' + repo + '/releases/' + releaseId
    + '/assets?name=' + encodeURIComponent(name);
  const response = await fetch(url, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': contentType },
    body: data
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error('upload ' + name + ' -> ' + response.status + ' ' + text.slice(0, 300));
  }
  return JSON.parse(text);
}

(async () => {
  const args = process.argv.slice(2);
  const releaseOnly = args.includes('--release-only');
  const extra = args.filter((a) => a !== '--release-only');
  const latest = JSON.parse(fs.readFileSync('android-tablet/build/latest.json', 'utf8'));
  const apkName = 'zhujie-tablet-' + latest.versionName + '.apk';
  const tag = 'android-v' + latest.versionName;

  if (!releaseOnly) {
    const ref = await gh('/repos/' + repo + '/git/ref/heads/main');
    const head = ref.object.sha;
    const commit = await gh('/repos/' + repo + '/git/commits/' + head);
    const files = [
      ['android-release/' + apkName, 'android-tablet/build/' + apkName],
      ['android-release/zhujie-tablet-latest.apk', 'android-tablet/build/' + apkName],
      ['android-release/latest.json', 'android-tablet/build/latest.json']
    ];
    for (let i = 0; i + 1 < extra.length; i += 2) {
      files.push([extra[i], extra[i + 1]]);
    }
    const tree = [];
    for (const [target, source] of files) {
      const content = fs.readFileSync(source).toString('base64');
      const blob = await gh('/repos/' + repo + '/git/blobs', 'POST', {
        content,
        encoding: 'base64'
      });
      tree.push({ path: target, mode: '100644', type: 'blob', sha: blob.sha });
      console.log('blob', target, blob.sha);
    }
    const newTree = await gh('/repos/' + repo + '/git/trees', 'POST', {
      base_tree: commit.tree.sha,
      tree
    });
    if (newTree.sha !== commit.tree.sha) {
      const newCommit = await gh('/repos/' + repo + '/git/commits', 'POST', {
        message: 'release: 安卓平板版 ' + latest.versionName,
        tree: newTree.sha,
        parents: [head]
      });
      await gh('/repos/' + repo + '/git/refs/heads/main', 'PATCH', {
        sha: newCommit.sha,
        force: false
      });
      console.log('PUSHED', newCommit.sha);
    } else {
      console.log('FILES_ALREADY_CURRENT');
    }
  }

  let release = await releaseByTag(tag);
  if (!release) {
    release = await gh('/repos/' + repo + '/releases', 'POST', {
      tag_name: tag,
      target_commitish: 'main',
      name: '注解 平板版 ' + latest.versionName,
      body: latest.notes || '',
      make_latest: 'false'
    });
    console.log('RELEASE_CREATED', release.id, tag);
  } else {
    console.log('RELEASE_EXISTS', release.id, tag);
  }

  const existing = (release.assets || []).map((a) => a.name);
  const assets = [
    [apkName, 'android-tablet/build/' + apkName, 'application/vnd.android.package-archive'],
    ['latest.json', 'android-tablet/build/latest.json', 'application/json']
  ];
  for (const [name, source, type] of assets) {
    if (existing.includes(name)) {
      console.log('ASSET_EXISTS', name);
      continue;
    }
    const asset = await uploadAsset(release.id, name, source, type);
    console.log('ASSET_UPLOADED', name, asset.size);
  }

  console.log('RELEASE_URL', release.html_url);
  console.log('APK', 'https://raw.githubusercontent.com/' + repo + '/main/android-release/' + apkName);
  console.log('LATEST', 'https://raw.githubusercontent.com/' + repo + '/main/android-release/zhujie-tablet-latest.apk');
  console.log('MANIFEST', 'https://raw.githubusercontent.com/' + repo + '/main/android-release/latest.json');
})().catch((error) => {
  console.error(String(error).slice(0, 1000));
  process.exit(1);
});