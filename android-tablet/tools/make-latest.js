const fs = require('fs');
const crypto = require('crypto');

const apkPath = process.argv[2] || 'build/zhujie-tablet.apk';
const versionCode = process.argv[3] || '0';
const versionName = process.argv[4] || '0.0.0';
const notes = process.argv[5] || '';

const data = fs.readFileSync(apkPath);
const sha256 = crypto.createHash('sha256').update(data).digest('hex');
const manifest = {
  versionCode: Number(versionCode),
  versionName,
  url: 'https://raw.githubusercontent.com/dolee676-sys/annotation-tool/main/android-release/zhujie-tablet-' + versionName + '.apk',
  sha256,
  size: data.length,
  notes
};

fs.writeFileSync('build/latest.json', JSON.stringify(manifest, null, 2) + '\n');
console.log('latest.json ->', versionName, versionCode, data.length, sha256);
