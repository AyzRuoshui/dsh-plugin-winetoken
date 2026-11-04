const fs = require('fs');
const path = require('path');
const https = require('https');

const REPO_OWNER = 'AyzRuoshui';
const REPO_NAME = 'dsh-plugin-winetoken';
const PLUGIN_ROOT = path.resolve(__dirname, '..');

const CORE_FILES = [
  'package.json',
  'cordis.patch.yml',
  'icon.svg',
  'locale/zh.json',
  'locale/en.json',
  'src/index.js',
  'src/client.js',
  'src/updater.js',
  'src/parser.js',
  'src/sync.js',
  'README.md'
];

function fetchRaw(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'WineToken-DSH-Updater',
        'Accept': '*/*'
      }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(fetchRaw(res.headers.location));
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

function fetchJSON(url) {
  return fetchRaw(url).then(buf => JSON.parse(buf.toString('utf8'))).catch(() => null);
}

function compareSemver(v1, v2) {
  const p1 = (v1 || '').replace(/^v/, '').split('.').map(Number);
  const p2 = (v2 || '').replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const a = p1[i] || 0;
    const b = p2[i] || 0;
    if (a > b) return 1;
    if (a < b) return -1;
  }
  return 0;
}

let isUpdating = false;

async function checkAndUpdate(options = {}) {
  if (isUpdating) return;
  isUpdating = true;

  try {
    const pkgPath = path.join(PLUGIN_ROOT, 'package.json');
    if (!fs.existsSync(pkgPath)) return;
    const localPkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const currentVersion = localPkg.version || '0.0.0';

    // 1. 获取最新版本信息 (GitHub Releases API 优先，CDN 备用)
    let latestTag = null;
    const ghRelease = await fetchJSON(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`);
    if (ghRelease && ghRelease.tag_name) {
      latestTag = ghRelease.tag_name;
    } else {
      const cdnPkg = await fetchJSON(`https://fastly.jsdelivr.net/gh/${REPO_OWNER}/${REPO_NAME}@main/package.json`);
      if (cdnPkg && cdnPkg.version) {
        latestTag = `v${cdnPkg.version}`;
      }
    }

    if (!latestTag) {
      if (!options.quiet) console.log('[WineToken Updater] Could not fetch remote version.');
      return;
    }

    const remoteVersion = latestTag.replace(/^v/, '');
    if (compareSemver(remoteVersion, currentVersion) <= 0) {
      if (!options.quiet) console.log(`[WineToken Updater] Already up to date (current: v${currentVersion}, latest: ${latestTag}).`);
      return;
    }

    console.log(`[WineToken Updater] New version detected: ${latestTag} (current: v${currentVersion}). Starting background update...`);

    // 2. 依次下载核心文件到临时备份区
    const tempDir = path.join(PLUGIN_ROOT, '.tmp_update_' + Date.now());
    fs.mkdirSync(tempDir, { recursive: true });

    const downloadSuccess = [];
    for (const relFile of CORE_FILES) {
      const urls = [
        `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/main/${relFile.replace(/\\/g, '/')}`,
        `https://fastly.jsdelivr.net/gh/${REPO_OWNER}/${REPO_NAME}@main/${relFile.replace(/\\/g, '/')}`
      ];

      let content = null;
      for (const url of urls) {
        try {
          content = await fetchRaw(url);
          if (content && content.length > 0) break;
        } catch (_) {}
      }

      if (!content) {
        throw new Error(`Failed to download required file: ${relFile}`);
      }

      const tempFilePath = path.join(tempDir, relFile);
      fs.mkdirSync(path.dirname(tempFilePath), { recursive: true });
      fs.writeFileSync(tempFilePath, content);
      downloadSuccess.push(relFile);
    }

    // 3. 所有文件下载校验成功后，执行覆盖更新
    for (const relFile of downloadSuccess) {
      const srcFile = path.join(tempDir, relFile);
      const destFile = path.join(PLUGIN_ROOT, relFile);
      fs.mkdirSync(path.dirname(destFile), { recursive: true });
      fs.copyFileSync(srcFile, destFile);
    }

    // 4. 清理临时下载目录
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_) {}

    // 5. 记录更新状态供 client 端感知
    const statusData = {
      updated: true,
      fromVersion: currentVersion,
      toVersion: remoteVersion,
      updatedAt: Date.now()
    };
    try {
      fs.writeFileSync(path.join(PLUGIN_ROOT, 'src', 'update_status.json'), JSON.stringify(statusData, null, 2), 'utf8');
    } catch (_) {}

    console.log(`[WineToken Updater] Successfully auto-updated to v${remoteVersion}. Files replaced safely.`);
  } catch (err) {
    console.warn('[WineToken Updater] Background auto-update skipped or failed:', err.message);
  } finally {
    isUpdating = false;
  }
}

module.exports = { checkAndUpdate };
