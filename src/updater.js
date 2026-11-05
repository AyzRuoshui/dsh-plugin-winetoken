// -*- coding: utf-8 -*-
/**
 * WineToken 版本安全检查器 (Safe Version Checker)
 * 彻底消除供应链任意代码覆写风险 (SEC-01)，仅通过官方接口核验版本并提供升级提示，绝不静默覆盖本地磁盘代码
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const REPO_OWNER = 'AyzRuoshui';
const REPO_NAME = 'dsh-plugin-winetoken';
const PLUGIN_ROOT = path.resolve(__dirname, '..');

function fetchJSON(url) {
  return new Promise((resolve) => {
    https.get(url, {
      headers: {
        'User-Agent': 'WineToken-DSH-VersionChecker',
        'Accept': 'application/vnd.github+json'
      },
      timeout: 8000
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(fetchJSON(res.headers.location));
      }
      if (res.statusCode !== 200) {
        return resolve(null);
      }
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (_) {
          resolve(null);
        }
      });
    }).on('error', () => resolve(null))
      .on('timeout', function() {
        this.destroy();
        resolve(null);
      });
  });
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

let isChecking = false;

async function checkAndUpdate(options = {}) {
  if (isChecking) return;
  isChecking = true;

  try {
    const pkgPath = path.join(PLUGIN_ROOT, 'package.json');
    if (!fs.existsSync(pkgPath)) return;
    const localPkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const currentVersion = localPkg.version || '0.0.0';

    // 仅通过 GitHub 官方 API 检查最新 Releases 版本
    const ghRelease = await fetchJSON(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`);
    const latestTag = ghRelease?.tag_name || null;

    if (!latestTag) {
      if (!options.quiet) console.log('[WineToken Updater] 未能获取远程版本信息');
      return;
    }

    const remoteVersion = latestTag.replace(/^v/, '');
    const hasUpdate = compareSemver(remoteVersion, currentVersion) > 0;

    if (!hasUpdate) {
      if (!options.quiet) console.log(`[WineToken Updater] 当前已是最新版本 (本地: v${currentVersion}, 远程: ${latestTag})`);
      return;
    }

    console.log(`[WineToken Updater] 检测到新版本: ${latestTag} (当前本地: v${currentVersion})。请前往插件中心手动升级。`);

    // 记录版本状态供前端感知并提示，绝不静默覆盖本地业务文件
    const statusData = {
      hasUpdate: true,
      currentVersion,
      latestVersion: remoteVersion,
      checkedAt: Date.now(),
      releaseUrl: ghRelease.html_url || `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/tag/${latestTag}`
    };

    try {
      const statusFile = path.join(PLUGIN_ROOT, 'src', 'update_status.json');
      fs.writeFileSync(statusFile, JSON.stringify(statusData, null, 2), 'utf8');
    } catch (_) {}
  } catch (err) {
    if (!options.quiet) console.warn('[WineToken Updater] 检查版本异常:', err.message);
  } finally {
    isChecking = false;
  }
}

module.exports = { checkAndUpdate };
