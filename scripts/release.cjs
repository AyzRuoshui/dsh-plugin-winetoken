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
  console.error('❌ 缺少 GITHUB_TOKEN');
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
  const releaseTitle = `Release ${version} - 根治总累计调用与套餐已用口径矛盾，恢复并强化大模型原生 Tool Calling 技能`;
  const releaseBody = `## 🚀 DeepSeek Harness WineToken 插件 ${version}

### 💎 账目精确度与大模型技能重大升级

1. **[彻底根治总累计调用与套餐已用数据口径矛盾]**
   - **服务端账轨精准对齐**：修正服务端 \`/api/subscription/status\` 计算逻辑。在会员订阅期内，业务语义上的“总累计调用”严格对齐并大于等于套餐当期真实消耗（\`max(token_used, sub_amount_used)\`），彻底根除“总累计调用 (¥0.11) 反而低于单个会员套餐已用 (¥0.17)”的账目悖论；
   - **客户端多维透明外显**：账户中心卡片在展示真实总累计调用的同时，若当前为子密钥调用，智能追加显示 \`(本Key: ¥XX.XX)\`，两套账本分毫不差、清晰透明。

2. **[完整恢复并强化大模型 Tool Calling 生图/生视频技能]**
   - **工具定义规范对齐**：完整恢复 \`src/tool.js\`，完全符合 DSH 官方 \`@deepseek-ai/dsh-tools\` 微内核标准，配备严密的 \`output.schema\`、\`output.render\` 渲染投影与 \`isConcurrencySafe\` 并发保护；
   - **系统提示词动态引导**：通过 \`ctx.systemPrompt.section\` 注入技能认知，解除通用模型“我没有生图能力”的预训练认知偏见，让大模型在聊天中自主调用创作工坊直出高质量作品！

3. **[纯净生态与配置安全]**
   - 坚决杜绝霸道篡改用户默认模型配置（\`agent-default-model\` 已永久物理移除）；
   - \`src/sync.js\` 深度 JSON 幂等性比对，无变动 0 写盘，100% 保护第三方插件注释（如 \`# qq-bridge\`）。

---

### 🔌 安装与使用方法 (DSH 客户端直接操作 · 推荐)

1. 打开 **DeepSeek Harness** 客户端，进入左侧 **「插件」** 页面；
2. 点击右上角 **「+ 添加插件」**，选择 **「安装第三方插件」**；
3. 粘贴安装地址：
   - **国内免魔法高速镜像（强烈推荐，解决 ETIMEDOUT 超时）**：
     \`\`\`text
     https://ghproxy.net/https://github.com/AyzRuoshui/dsh-plugin-winetoken/archive/refs/heads/main.tar.gz
     \`\`\`
   - **GitHub 官方直链**：
     \`\`\`text
     https://github.com/AyzRuoshui/dsh-plugin-winetoken/archive/refs/heads/main.tar.gz
     \`\`\`
4. 点击确认，DSH 即可通过内置包管理器秒级完成安全增量安装，已有插件 100% 完好无损！
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
    console.log(`✅ [发布成功] Release: ${data.html_url}`);
  } catch (e) {
    console.error('❌ 发布失败:', e.message);
  }
}

createRelease();
