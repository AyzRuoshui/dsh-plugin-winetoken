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
  const releaseTitle = `Release ${version} - 模型列表定时自动同步 (上下架免重启跟随)`;
  const releaseBody = `## DeepSeek WineToken 插件 ${version}

本版聚焦一项核心能力：**模型列表定时自动同步**。

### 1. 模型上下架自动跟随，无需重启
- 插件宿主侧新增定时同步轮询：开机后 2 秒首查，此后默认每 5 分钟自动拉取最新模型清单；
- 运营在中转站上架或下架模型后，DSH 模型选择器将在一个同步周期内自动增删，无需重启 DSH、无需手动操作；
- 模型无变化时零写盘、零扰动（增量引擎文本级幂等比对，完整保护用户自定义 provider 与 YAML 注释）；
- 拉取失败或返回空清单时自动保留现有模型列表，绝不误清空选择器。

### 2. 同步间隔可配置
- \`src/config.json\` 新增 \`syncIntervalMinutes\`（默认 5，最小 1），兼容旧 \`syncIntervalHours\` 配置自动换算；
- 客户端创作工坊与画布的模型列表沿用既有 120 秒 SWR 热刷新，本轮无需任何操作。

### 3. 工程状态
- 全部源码 \`node --check\` 通过；
- 自动化测试 **27 / 27 全绿**（新增 4 项同步间隔契约测试）；
- 发布脱敏门禁 **0 违规**。全程未发起任何真实生成调用。

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
