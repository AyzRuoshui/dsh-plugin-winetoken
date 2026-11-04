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
  const releaseTitle = `Release ${version} - 彻底废除默认模型篡改，补全模型同步深度幂等性并移除调试探针日志`;
  const releaseBody = `## 🚀 DeepSeek Harness WineToken 插件 ${version}

### 🛡️ 纯净度与生态友好性重大重构

1. **[彻底废除默认模型篡改 (零侵入保证)]**
   - 官方补丁 \`cordis.patch.yml\` 中已彻底移除 \`agent-default-model\` 及所有客户端 UI/主题偏好条目；
   - 坚决捍卫用户主权，绝不霸道篡改用户的默认模型（如 DeepSeek/Claude）与主题配置，只专注注入 WineToken 自身服务！

2. **[模型同步深度幂等性 (保护 YAML 注释)]**
   - \`src/sync.js\` 引入深度 JSON 比对机制：在开机启动与定时同步时，若模型列表与 Provider 配置未发生实际变动，**严格跳过写盘**；
   - 100% 杜绝无脑重新序列化导致的用户自定义 YAML 注释（如 \`# qq-bridge\` 等第三方插件备注）被洗掉的问题。

3. **[物理移除调试探针日志]**
   - 彻底移除了 \`src/index.js\` 中的 \`dsh_probe.log\` 本地探针文件写入，绝不向用户个人主目录产生任何垃圾调试文件。

4. **[已用统计防闪烁与 Tool Calling 全链路合规]**
   - 继承 v1.5.6 的高精度双账轨数据源对齐与 \`output.schema\` 严格断言规范。

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
