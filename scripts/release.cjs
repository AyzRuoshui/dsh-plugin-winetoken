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
    const releaseTitle = `Release ${version} - 新增 Google Flow 双模型：Nano Banana 2.1 生图 + Omni 1.2 Flash 视频`;
  const releaseBody = `## DeepSeek WineToken 插件 ${version}

本版新增两个 Google Flow 模型，与 v2.5.13 的 Muse 双模型并列：Nano Banana 2.1 生图（¥0.03/张）与 Omni 1.2 Flash 视频（¥0.08/秒），工坊、画布与工具三处同步可选。

### 1. Nano Banana 2.1 生图
- 工坊生图目录与生图工具说明同步上架：谷歌 Gemini 3.1 Flash Image，指令遵循与文字渲染强，支持文生图与带图编辑、五种画幅；
- 按张计费 ¥0.03，会员 ¥0.024。

### 2. Omni 1.2 Flash 视频
- 工坊视频目录、画布视频节点与视频工具枚举同步上架：原生带音频，720P 横竖屏，时长 3~15 秒任意整数秒（工具时长枚举同步放宽至 3~15）；
- 走 /v1/videos 任务协议，画幅经 size 透传中转层选横竖屏，首帧经 metadata 显式映射；按秒计费 ¥0.08，会员 ¥0.064。

### 3. 其他
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
