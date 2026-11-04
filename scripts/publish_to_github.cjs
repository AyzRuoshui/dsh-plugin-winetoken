// -*- coding: utf-8 -*-
/**
 * 基于 GitHub REST API 的无 Git CLI 远程仓库提交与全量发布工具
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const REPO_NAME = 'dsh-plugin-winetoken';
const ROOT_DIR = path.resolve(__dirname, '..');
const DEFAULT_TOKEN = process.env.GITHUB_TOKEN || '';

function requestGithub(token, endpoint, method = 'GET', data = null, retries = 3) {
  return new Promise((resolve, reject) => {
    const postBody = data ? JSON.stringify(data) : null;
    const options = {
      hostname: 'api.github.com',
      path: endpoint,
      method: method,
      headers: {
        'Authorization': `Bearer ${token.trim()}`,
        'User-Agent': 'WineToken-Publisher-Node',
        'Accept': 'application/vnd.github+json',
        ...(postBody ? {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postBody)
        } : {})
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(body || '{}'));
          } catch (e) {
            resolve(body);
          }
        } else {
          reject(new Error(`GitHub API [${method} ${endpoint}] 返回 HTTP ${res.statusCode}: ${body}`));
        }
      });
    });

    req.on('error', (err) => {
      if (retries > 0) {
        console.log(`    ⚠️ 网络重试中 (${endpoint}, 剩余 ${retries} 次)...`);
        setTimeout(() => {
          requestGithub(token, endpoint, method, data, retries - 1).then(resolve).catch(reject);
        }, 1500);
      } else {
        reject(err);
      }
    });

    if (postBody) req.write(postBody);
    req.end();
  });
}

function getAllFiles(dir, baseDir = '') {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    if (
      file === 'node_modules' ||
      file === '.git' ||
      file === '.tmp' ||
      file === 'package-lock.json' ||
      file === '.package-lock.json'
    ) continue;
    const fullPath = path.join(dir, file);
    const relPath = path.join(baseDir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      results = results.concat(getAllFiles(fullPath, relPath));
    } else {
      results.push(relPath);
    }
  }
  return results;
}

async function publish(token) {
  console.log('='.repeat(60));
  console.log('[GitHub 发布引擎] 开始校验 Token...');

  const user = await requestGithub(token, '/user');
  console.log(`[认证成功] 当前 GitHub 用户: ${user.login} (${user.name || 'No Name'})`);

  const filesToCommit = getAllFiles(ROOT_DIR);
  console.log(`[文件扫描] 准备上传 ${filesToCommit.length} 个文件到 GitHub 仓库...`);

  const treeItems = [];
  for (const relPath of filesToCommit) {
    const fullPath = path.join(ROOT_DIR, relPath);
    const content = fs.readFileSync(fullPath, 'utf-8');
    const blob = await requestGithub(token, `/repos/${user.login}/${REPO_NAME}/git/blobs`, 'POST', {
      content: content,
      encoding: 'utf-8'
    });

    treeItems.push({
      path: relPath.replace(/\\/g, '/'),
      mode: '100644',
      type: 'blob',
      sha: blob.sha
    });
    console.log(`  ✓ 上传: ${relPath}`);
  }

  const ref = await requestGithub(token, `/repos/${user.login}/${REPO_NAME}/git/refs/heads/main`).catch(() => 
    requestGithub(token, `/repos/${user.login}/${REPO_NAME}/git/refs/heads/master`)
  );
  const parentCommitSha = ref.object.sha;
  const branchName = ref.ref.replace('refs/heads/', '');

  const newTree = await requestGithub(token, `/repos/${user.login}/${REPO_NAME}/git/trees`, 'POST', {
    tree: treeItems
  });

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
  const commitMsg = process.argv[3] || `feat: v${pkg.version} - built-in studio workspace & accurate model specs (context/multimodal)`;

  const newCommit = await requestGithub(token, `/repos/${user.login}/${REPO_NAME}/git/commits`, 'POST', {
    message: commitMsg,
    tree: newTree.sha,
    parents: [parentCommitSha]
  });

  await requestGithub(token, `/repos/${user.login}/${REPO_NAME}/git/refs/heads/${branchName}`, 'PATCH', {
    sha: newCommit.sha,
    force: true
  });

  console.log('='.repeat(60));
  console.log(`🎉 [代码提交成功] Commit SHA: ${newCommit.sha}`);
  console.log(`   仓库链接: https://github.com/${user.login}/${REPO_NAME}`);
  console.log('='.repeat(60));
}

const tokenArg = process.env.GITHUB_TOKEN || (process.argv[2]?.startsWith('ghp_') ? process.argv[2] : DEFAULT_TOKEN);
publish(tokenArg).catch(err => {
  console.error('\n❌ 发布失败:', err.message);
  process.exit(1);
});
