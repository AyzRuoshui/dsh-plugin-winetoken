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
  const releaseTitle = `Release ${version} - 根除用量统计数值漂移闪烁，对齐 cordis.patch.yml 规范与大模型生图调用闭环`;
  const releaseBody = `## 🚀 DeepSeek Harness WineToken 插件 ${version}

### 🛠️ 关键修复与体验优化

1. **[彻底消除用量统计数据闪烁与漂移 (0.13 -> 0.11)]**
   - 根因定位：原先在数据更新时，先拉取粗粒度的单月总流水将已用赋值为 0.13，随后高精度双账轨接口返回真实的周期实际消耗 0.11，导致用户肉眼可见“一闪变化”；
   - 彻底废除提前赋值逻辑，统一以 Tokyo VPS 高精度双账轨接口（\`/api/subscription/status\`）为唯一真实来源，100% 消除视觉闪烁漂移。

2. **[对齐 Cordis 补丁规范与 Tool Calling 全链路畅通]**
   - 补全 \`- insert:\` 容器规范，确保插件 Host 侧可靠启动；
   - 严格对齐 \`@deepseek-ai/dsh-tools\` 底层 \`output.schema\` 校验规范与 \`isConcurrencySafe\` 标记；
   - 注入动态系统提示词，引导大模型主动调用生图与生视频技能。

3. **[后台自更新引擎升级 (updater.js)]**
   - 补齐 \`src/tool.js\` 与 \`src/history.js\` 到核心文件清单；
   - 引入国内免魔法高速镜像（\`ghproxy.net\`），国内网络秒级无感自更新。

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
