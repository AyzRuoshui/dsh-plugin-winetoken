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
  const releaseTitle = `Release ${version} - 修复容灾 fallback 分支中 usedCNYNum 未定义的运行时异常`;
  const releaseBody = `## 🚀 DeepSeek Harness WineToken 插件 ${version}

### 🐞 关键运行时异常修复与健壮性加固

1. **[修复容灾 Fallback 分支中 usedCNYNum 未定义崩溃]**
   - 采纳第三方 AI 助手审查指认：在主双账轨状态接口遇网络抖动进入容灾降级分支（旧接口兼容链路）时，补齐了 \`usedCNYNum\` 变量的安全声明与初始化；
   - 优先拉取 \`/dashboard/billing/usage\` 获取真实月度流水并除以 100 换算，网络异常时安全兜底为 0，彻底杜绝 \`ReferenceError: usedCNYNum is not defined\` 运行时报错打断前端轮询。

2. **[总累计调用与套餐已用账目对齐 (继承 v1.5.8)]**
   - 服务端与客户端账本全链路对齐，保障总累计调用始终不低于当期套餐已用，并追加显示本 Key 单独消耗。

3. **[大模型原生 Tool Calling 生图/生视频技能完备 (继承 v1.5.8)]**
   - \`src/tool.js\` 100% 严密合规，支持会话直出生图/生视频并自动存入工坊画廊。

4. **[纯净生态与配置安全]**
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
