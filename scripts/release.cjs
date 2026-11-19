// -*- coding: utf-8 -*-
const fs = require('fs');
const path = require('path');
const https = require('https');

const REPO_OWNER = 'AyzRuoshui';
const REPO_NAME = 'dsh-plugin-winetoken';
const GITHUB_TOKEN = process.argv[2] || process.env.GITHUB_TOKEN || '';

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
  const releaseTitle = `Release ${version} - 漫剧画布布局与连线修复 + GPT 6.2 模型换代`;
  const releaseBody = `## DeepSeek WineToken 插件 ${version}

本版修复漫剧画布在 DSH 真机验收中发现的两个布局缺陷，并完成 GPT 模型换代。

### 1. 漫剧画布：小窗口布局修复
- 底部工具栏与右下角栏目（快捷键 / AI拆镜 / 教程）在窄窗口下不再互相遮挡：新增三档响应式（宽屏维持原样；中屏工具栏左对齐、右下栏目转纯图标；窄屏工具栏上移错层并转纯图标）；
- 工具栏按钮文字不再被挤成竖排（强制不换行、不收缩）。

### 2. 漫剧画布：节点连线修复
- 分镜卡拖到角色卡上方、下方或左侧后连线不再消失或断裂：连线层解除负坐标裁剪，并按节点相对位置智能选择连线锚点；
- 卡片位于右侧的常规布局下，连线锚点与观感保持不变。

### 3. 模型换代：GPT 6.2 上架
- 新增 GPT-6.2 Astra 与 GPT-6.2 Sol（1M 上下文 / 128K 最大输出 / 图文输入），替代 GPT-6 Astra 与 GPT-6.1 Sol；
- 站内已同步完成换代计价与下架，插件内置表与服务器清单保持一致。

### 4. 工程状态
- 自动化测试 131/131 全绿（新增连线象限回归用例）；发布脱敏门禁 0 违规；零 Emoji 工业风。

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
