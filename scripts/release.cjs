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
  const releaseTitle = `Release ${version} - 离线基线对齐线上 Manifest、模型名称尾部括号清洗与 xhigh/ultra 档位透传`;
  const releaseBody = `## DeepSeek WineToken 插件 ${version}

本版将离线基线阵容与规格库全面对齐线上 Manifest，并在补丁写入与同步链路引入模型名称防御性清洗及扩展思考档位透传支持。

### 1. 离线基线与规格库全面对齐线上 Manifest (共 21 款模型)
- **名称规范化**：统一对齐线上 Manifest 展示名，移除冗余厂商前缀与尾部括号修饰词（含 \`cordis.patch.yml\`、\`getBaselineModels\` 与 \`EXACT_MODEL_SPECS\`）；
- **下架清理**：移除已下架的 \`kimi-k2.8-preview\`、\`step-5-preview\`、\`gemini-3.8-flash\`；
- **新增模型**：加入 \`gpt-5.6-luna\`、\`gpt-5.6-terra\`、\`gpt-6-luna\`（272K 上下文 / 128K 输出 / 视觉多模态）与 \`mimo-v2.6-flash\`（200K 上下文 / 32K 输出 / 纯文本），并完整保留 DeepSeek 384K 输出规格。

### 2. 防御性清洗器：写入补丁前自动剥离尾部括号描述符
- 在 \`serializeProviderYaml\`（\`src/patch-engine.js\`）及 \`buildManifestModels\`（实时 Manifest 同步链路）中统一剥离模型显示名称末尾的 ASCII \`(...)\` 与全角 \`（...）\` 修饰符（含连续或空白分隔的多个括号）；
- 若剥离后导致名称为空，自动回退保留原始名称，防止异常空白显示名写入配置。

### 3. 扩展思考档位透传：支持 \`xhigh\` 与 \`ultra\`
- 同步白名单 \`EFFORT_KEYS\` 新增 \`xhigh\` 与 \`ultra\`，基线解析同步兼容，确保 \`gpt-5.6-terra\` 的 \`ultra\` 及 \`gpt-5.6-luna\` / \`gpt-6-luna\` 的 \`xhigh\` 思考档位在在线同步与离线基线中完整保留。

### 4. 工程状态
- 自动化测试全部通过；零 Emoji 工业风；零新增运行依赖。

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
