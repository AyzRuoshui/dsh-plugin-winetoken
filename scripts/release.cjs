// -*- coding: utf-8 -*-
const fs = require('fs');
const path = require('path');
const https = require('https');

const REPO_OWNER = 'AyzRuoshui';
const REPO_NAME = 'dsh-plugin-winetoken';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";

const rootDir = path.resolve(__dirname, '..');
const pkgPath = path.join(rootDir, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const version = `v${pkg.version}`;

console.log(`[Release] Preparing GitHub Release for ${version}...`);

if (!GITHUB_TOKEN) {
  console.error('[错误] 缺少 GITHUB_TOKEN');
  process.exit(1);
}

function requestGithub(endpoint, method = 'GET', data = null) {
  return new Promise((resolve, reject) => {
    const postBody = data ? JSON.stringify(data) : null;
    const options = {
      hostname: 'api.github.com',
      path: endpoint,
      method: method,
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN.trim()}`,
        'User-Agent': 'WineToken-DSH-Release-Agent',
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
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

    req.on('error', reject);
    if (postBody) req.write(postBody);
    req.end();
  });
}

async function createRelease() {
    const releaseTitle = `Release ${version} - 视频轮询上限提升至 300 秒：修复生成假超时`;
  const releaseBody = `## DeepSeek WineToken 插件 ${version}

本版修复视频生成「假超时」：真实渲染常需 2 分钟以上，旧版 120 秒轮询上限会提前放弃并误报超时（任务其实仍在云端渲染、出片与扣费都正常）。

### 1. 轮询上限提升至 300 秒
- 创作工坊（Studio）与漫剧画布的视频轮询上限由 40 次 × 3 秒（120 秒）提升至 100 次 × 3 秒（300 秒），覆盖 MiniMax H3 等模型的真实渲染时长（实测 131 秒）；
- 界面进度文案同步更新为最长 300 秒，不再出现任务未完成就报「轮询超时」；
- 轮询期间的任务状态、扣费与结果获取逻辑不变。

### 2. 工程状态
- 自动化测试 160/160 全部通过；零 Emoji 工业风；零新增运行依赖。

---

### 安装与使用方法 (DSH 客户端直接操作 · 推荐)

1. 打开 **DeepSeek** 客户端，进入左侧 **「插件」** 页面；
2. 点击右上角 **「+ 添加插件」**，选择 **「安装第三方插件」**；
3. 粘贴安装地址：
   \`\`\`
   https://github.com/AyzRuoshui/dsh-plugin-winetoken/archive/refs/tags/${version}.tar.gz
   \`\`\`
   国内加速下载地址：
   \`\`\`
   https://ghproxy.net/https://github.com/AyzRuoshui/dsh-plugin-winetoken/archive/refs/tags/${version}.tar.gz
   \`\`\`
4. 提示安装成功后，在弹出的重载提示中点击 **「重载窗口」** 即可。

> 说明：模型调用会在中转站产生额度消耗，请按自身额度使用。
`;

  try {
    const data = await requestGithub(`/repos/${REPO_OWNER}/${REPO_NAME}/releases`, 'POST', {
      tag_name: version,
      target_commitish: 'main',
      name: releaseTitle,
      body: releaseBody,
      draft: false,
      prerelease: false
    });
    console.log(`[发布成功] Release: ${data.html_url}`);
  } catch (e) {
    console.error('[发布失败]', e.message);
  }
}

createRelease();
