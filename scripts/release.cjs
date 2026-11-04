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
  const releaseTitle = `Release ${version} - 修复创作工坊长图与竖屏遮挡操作栏缺陷，加固自适应舞台与安全体系`;
  const releaseBody = `## 🚀 DeepSeek Harness WineToken 插件 ${version}

### 🎨 创作工坊核心交互与布局缺陷修复

1. **[创作工坊舞台-操作栏解耦与自适应修复]**
   - 彻底修复 **2:3 竖屏** 与 **9:16 极限长图** 下，图片底边与外发光阴影溢出覆盖底部悬浮操作按钮栏（保存图片、复制提示词、复用参数、图生图等）的严重遮挡问题；
   - 采用现代化舞台容器模式（\`flex: 1, minHeight: 0\`），告别 \`68vh\` 虚高限高，由容器严格按可用物理空间等比收缩图片。

2. **[多模态画廊全宽高比极致贴合]**
   - 无论 16:9 横屏、1:1 方屏、2:3 竖图还是 9:16 长图，均在工作区舞台内部严格居中展示，绝不超出边界；
   - 悬浮操作栏增加独立层叠上下文与物理保护（\`flexShrink: 0, zIndex: 2\`），并在窄屏/小窗口下自适应居中换行。

3. **[会员特权体系稳定运行]**
   - **SUPER** 会员专属青色徽章与特权通道（8 折特权与无限量专属免费特权通道）稳定运行；
   - **SVIP** 与 **VIP** 双账轨高精度计费状态机深度加固，无闪烁、无漂移。

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
