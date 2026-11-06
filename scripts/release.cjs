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
  const releaseTitle = `Release ${version} - 生图模型清单随 New-API 上下架动态同步`;
  const releaseBody = `## DeepSeek WineToken 插件 ${version}

配合服务端 WBHub manifest 修订，客户端生图模型列表改为**完全跟随中转站 New-API 的上下架状态**，不再依赖写死的静态清单。本次 New-API 下架 3 个旧模型、上架 2 个 GPT-Image 2.6 模型，插件与服务端已同步。

### 1. 模型清单以下发 manifest 为唯一真相
- \`normalizeImageModel\` / \`normalizeVideoModel\` 保留服务端 \`enabled\` 字段，名称 / 标签 / 价格 / 尺寸一律以线上为准，移除写死的改名逻辑；
- \`fetchManifest\` 去掉「静态兜底并集」旧逻辑：服务端标记下架（\`enabled=false\`）的模型不再被本地常量补回，界面即时消失；仅当线上完全没返回该类模型时才用静态兜底（断网保护）；
- \`getSnapshot\` / getter / 订阅回调统一过滤可用模型，旧缓存无 \`enabled\` 字段时兼容视为可用；误入 \`chatModels\` 的生图模型（如 \`gpt-image-2.6-*\`）在消费侧剔除，AI 拆镜下拉不会再把它当对话模型。

### 2. 默认模型与静态兜底同步换新
- 静态兜底清单由 6 个旧模型换为当前在架的 5 个：新增 \`gpt-image-2.6-flare\` / \`gpt-image-2.6-sunburst\`，移除已下架的 \`gpt-image-2.5-flare\` / \`2.5-sunburst\` / \`gpt-image-2\`；
- 2.6 系列定价沿用 2.5 档：Flare ¥0.30/张（会员 ¥0.24）、Sunburst ¥0.40/张（会员 ¥0.32），统一 5 档尺寸；
- Tool Calling 默认生图模型改为从 manifest 缓存动态解析（优先限免），工坊 / 画布初始选中模型也改为取可用清单首个，彻底清除 \`gpt-image-2.5-flare\` 写死引用。

### 3. 服务端联动（本次已部署）
- WBHub \`subscription.py\` 的 \`BASE_IMAGE_MODELS\` 同步换血，并新增「按 \`models.tags\` 含 \`Image\` 自动发现生图模型」逻辑：以后在 New-API 上下架生图模型无需再改代码，也不会再误判成对话模型。

### 4. 工程状态
- 全部源码 \`node --check\` 通过；服务端 \`py_compile\` 通过；
- 自动化测试 **23 / 23 全绿**；
- 线上 manifest 实测：\`imageModels\` 5 个（含 2.6 两个、下架 3 个已消失），\`chatModels\` 0 生图泄漏；
- 发布脱敏门禁 32 文件 **0 违规**。

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
