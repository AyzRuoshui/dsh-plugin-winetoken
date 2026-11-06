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
        } else if (res.statusCode >= 500 && retries > 0) {
          console.log(`    ⚠️ GitHub 服务器 5xx 波动 (${endpoint})，1.5 秒后自动重试 (剩余 ${retries} 次)...`);
          setTimeout(() => {
            requestGithub(token, endpoint, method, data, retries - 1).then(resolve).catch(reject);
          }, 1500);
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
    // 强制安全脱敏过滤白名单/黑名单：严格禁止将内部交接文档、私有凭据或临时产物上传至公开仓库
    if (
      file === 'node_modules' ||
      file === '.git' ||
      file === '.tmp' ||
      file === '.agents' ||
      file === 'ENGINEERING_REVIEW_REPORT.md' ||
      file === 'PHASED_IMPLEMENTATION_PLAN.md' ||
      file === 'CANVAS_INTERACTION_PARITY_PLAN.md' ||
      file === 'package-lock.json' ||
      file === '.package-lock.json' ||
      file === 'HANDOVER.md' ||
      file === 'PLUGIN_HANDOVER.md' ||
      file === 'AGENT.md' ||
      file === 'agent.md' ||
      file === '.gitignore' ||
      file.endsWith('.bak') ||
      file.startsWith('.credentials') ||
      file.startsWith('.env')
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

/**
 * 强制自动化脱敏门禁审计（发布铁律）
 */
function runSecurityAudit(filesToCommit) {
  console.log('[安全门禁] 正在执行全量待发布文件强制脱敏审计...');
  const sensitivePatterns = [
    { name: '敏感凭据模式 (password/secret)', pattern: /(?:password|passwd|secret)\s*[:=]\s*['"][^'"]{4,}['"]/i },
    { name: '生产环境公网 IP', pattern: /\b(?:152\.32\.|36\.163\.)\d+\.\d+\b/ },
    { name: '内部 API Key (sk-...)', pattern: /sk-[a-zA-Z0-9]{32,}/ },
    { name: '受限免费通道模型', pattern: /deepseek[a-zA-Z0-9._-]*-free\b/i },
    { name: '开发者个人系统绝对路径', pattern: /[C-Z]:\\Users\\[a-zA-Z0-9_.-]+/i },
    { name: '内部交接文档漏入', pattern: /(?:HANDOVER|AGENT\.md)/i }
  ];

  let violations = [];

  for (const relPath of filesToCommit) {
    const normPath = relPath.replace(/\\/g, '/');
    // 文件名黑名单校验
    if (/HANDOVER/i.test(normPath) || /AGENT\.md/i.test(normPath) || /\.credentials/i.test(normPath)) {
      violations.push({ file: relPath, rule: '禁止上传内部交接文档或凭据' });
      continue;
    }
    // 脚本自身定义门禁规则，跳过自审内容
    if (normPath === 'scripts/publish_to_github.cjs') {
      continue;
    }

    const fullPath = path.join(ROOT_DIR, relPath);
    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      for (const rule of sensitivePatterns) {
        if (rule.pattern.test(content)) {
          violations.push({ file: relPath, rule: rule.name });
        }
      }
    } catch (_) {}
  }

  if (violations.length > 0) {
    console.error('\n' + '!'.repeat(70));
    console.error('[发布拦截] 触发强制脱敏门禁违规！严禁将敏感数据推送到开源仓库：');
    violations.forEach(v => {
      console.error(`  - 文件: ${v.file} 触发规则: [${v.rule}]`);
    });
    console.error('!'.repeat(70) + '\n');
    throw new Error('强制脱敏审查未通过，发布已紧急中止！');
  }

  console.log('[安全门禁] 脱敏审计通过：0 处敏感凭据、0 处密码、0 处红线模型。');
}

async function publish(token) {
  console.log('='.repeat(60));
  console.log('[GitHub 发布引擎] 开始校验 Token...');

  const user = await requestGithub(token, '/user');
  console.log(`[认证成功] 当前 GitHub 用户: ${user.login} (${user.name || 'No Name'})`);

  const filesToCommit = getAllFiles(ROOT_DIR);
  console.log(`[文件扫描] 准备上传 ${filesToCommit.length} 个文件到 GitHub 仓库...`);

  // 发布前硬性执行脱敏审计，任何违规立即抛错中止发布
  runSecurityAudit(filesToCommit);

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
  const commitMsg = process.argv[3] || `fix: v${pkg.version} - Grok Imagine protocol adaptation (aspect_ratio for image, 720p/1080p for video)`;

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
  console.log(`[代码提交成功] Commit SHA: ${newCommit.sha}`);
  console.log(`   仓库链接: https://github.com/${user.login}/${REPO_NAME}`);
  console.log('='.repeat(60));
}

const tokenArg = process.env.GITHUB_TOKEN || (process.argv[2]?.startsWith('ghp_') ? process.argv[2] : DEFAULT_TOKEN);
publish(tokenArg).catch(err => {
  console.error('\n[错误] 发布失败:', err.message);
  process.exit(1);
});
