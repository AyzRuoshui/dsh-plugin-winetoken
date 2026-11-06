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
  const releaseTitle = `Release ${version} - 修复 Grok Imagine 生图/生视频上游 400`;
  const releaseBody = `## DeepSeek WineToken 插件 ${version}

修复用户实测反馈：工坊选择 **Grok Imagine 2.0（生图）** 在非正方形分辨率（如 768x1344）下必报 \`生成失败: xAI upstream returned status 400\`。根因是协议错配：**xAI 原生生图协议没有 \`size\` 参数**（改用固定档 \`aspect_ratio\`），OpenAI 风格的 \`size\` 被中转透传后遭 xAI 拒绝。

### 1. Grok 生图协议适配（工坊 + Tool Calling 双端修复）
- 检测 \`grok-imagine-image\` 模型族：不再发送 \`size\`，改为按所选分辨率**最近比例吸附**成 xAI 原生 \`aspect_ratio\`（1:1 / 9:16 / 16:9 / 3:4 / 4:3 / 2:3 / 3:2 / 21:9 / 5:2 九档，log 距离最近匹配）；
- 1024x1024 → 1:1、768x1344 / 1024x1792 → 9:16、1344x768 / 1792x1024 → 16:9，界面分辨率选项保持不变，行为对用户透明；
- \`src/tool.js\` 的大模型 Tool Calling 生图链路同步修复。

### 2. Grok 视频分辨率档位矫正（同类隐患预防性修复）
- xAI 视频仅接受 **480p / 720p / 1080p**，此前插件在非 1080 档一律发 \`768P\`（xAI 无此档位，尚未被用户踩到即已修复）：现在 Grok 视频族自动发 \`720P\` / \`1080P\`；
- 服务端 manifest 已同步为 Grok 视频补上 1920x1080 / 1080x1920 两档真 1080P 选项（本次已部署，线上已验证）。

### 3. 其他模型不受影响
- MiniMax H3 / GPT-Image 2.6 / Imagen 3 / 商汤限免的上行参数与界面完全不变，协议适配仅对 Grok Imagine 族生效。

### 4. 工程状态
- 全部源码 \`node --check\` 通过；服务端 \`py_compile\` 通过；
- 自动化测试 **23 / 23 全绿**；Grok 适配静态断言 **12 / 12 全过**；
- 服务端部署后实测 manifest：Grok 视频 4 档分辨率就位，生图 5 模型 / 视频 2 模型无其他变动；
- 发布脱敏门禁 **0 违规**。全程未发起任何真实生成调用（协议规格依据 New-API rc.48 内置插件源码与 xAI 官方文档核实）。

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

> 说明：画布交互可自由测试，不消耗额度；\`Ctrl+Enter\` 批量生成、生图 / 生视频、AI 拆镜的真实模型调用会在中转站产生额度消耗，请按自身额度使用。
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
