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
  const releaseTitle = `Release ${version} - 彻底清除全量历史脚本 (install.ps1/patch_asar/test脚本) & 覆盖上传脱敏配置`;
  const releaseBody = `## 🚀 DeepSeek Harness WineToken 插件 ${version}

### 🔒 核心安全性与仓库文件彻底净化 (Complete Repository Sanitization)

1. **[彻底拔除所有历史废弃脚本]**
   - 彻底从 GitHub 远程 Tree 中物理清除历史遗留的 \`install.ps1\`、\`scripts/patch_asar.cjs\`、\`scripts/test_balance_endpoints.ps1\` 与 \`src/run_silent.vbs\`，线上公开仓库已 100% 绝对纯净；
   - 杜绝任何因为使用旧脚本覆写 \`package.json\` 导致已有插件丢失的风险。

2. **[覆盖上传全量脱敏配置文件]**
   - 修复发布流程中对 \`src/config.json\` 的忽略问题，正式上传已彻底置空的配置文件 (\`"apiKey": ""\`)；
   - 源码库 100% 脱敏，绝无任何硬编码密钥或测试凭证。

3. **[多插件无缝共存与增量合并安全保证 (Zero Plugin Loss)]**
   - 官方推荐使用 DSH 客户端自带的「安装第三方插件」界面原生安装，官方内置包管理器会自动以只追加（Append Only）模式安全注册；
   - 本地提供官方安全增量安装工具 \`scripts/safe_install.cjs\`，深度保留用户已安装的所有第三方插件（dependencies 与 bundles），绝对不清空、不覆盖用户的现有插件配置！

---

### 🔌 安装与使用方法 (DSH 客户端直接操作 · 推荐)

1. 打开 **DeepSeek Harness** 客户端，进入左侧 **「插件」** 页面；
2. 点击右上角 **「+ 添加插件」**，选择 **「安装第三方插件」**；
3. 直接粘贴免 Git 极速归档包链接（HTTP 直连解包，无需本机安装 Git）：
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
