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
  const releaseTitle = `Release ${version} - 模型阵容同步与参数规格全面校准`;
  const releaseBody = `## DeepSeek WineToken 插件 ${version}

本版将插件内置模型阵容与 winetoken.asia 线上阵容全量同步，并按各厂商官方文档逐项校准参数规格（上下文窗口 / 最大输出 / 推理档位 / 多模态）。

### 1. 模型阵容同步
- 内置对话模型与线上阵容对齐：新增 Gemini 3.8 Flash（low / medium / high 三档）、Claude Fable 5.2、混元 Hy4 与 Hy4 Flash、Kimi K3.1 Pro 等，下线 9 款过期条目；
- 生图 5 款、生视频 2 款与线上保持一致。

### 2. 参数规格校准（按各厂商官方文档）
- Claude Opus 5.5 / Fable 5.2：1M 上下文 / 128K 最大输出；
- GLM-5.2 / 5.3 / 5.3-Flash：1M 上下文 / 128K 最大输出；
- DeepSeek V4 Pro 与 V4.1 Flash：1M 上下文 / 384K 最大输出；
- GPT-6 Astra / Sol：1M 上下文 / 128K 最大输出；Grok 4.7：500K 上下文；
- 清除无官方依据的 max 推理档位，Gemini 保留其真实三档。

### 3. 多模态标记校准
- 纯文本与图文输入按官方规格逐项对齐：GPT-6.1 Sol 补齐图文输入；GLM-5.2 / 5.3 与 DeepSeek V4 Pro 确认为纯文本；
- 站内 Kimi 系列上下文统一 1M。

### 4. 工程状态
- 模型规格四处配置（patch 配置 / 规格库 / 兜底表 / 同步默认值）全量对齐一致；
- 自动化测试全绿；发布脱敏门禁 0 违规；零 Emoji 工业风。

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
