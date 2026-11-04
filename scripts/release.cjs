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
  const releaseTitle = `Release ${version} - 工坊基底模型全宽卡片重构与漫剧画布模型实时费率展示`;
  const releaseBody = `## DeepSeek Harness WineToken 插件 ${version}

### 核心特性与架构升级

本次更新针对创作者在模型选择与费率感知上的实际痛点，全面重构了工坊左侧基底模型卡片排版，并优化了漫剧画布顶栏模型选择器。

#### 1. 工坊基底模型卡片全宽流式重构 (Single Column Fluid Cards)
- **彻底消除截断与重叠**：废除狭窄双列网格布局，升级为单列全宽响应式卡片流；
- **全称与特性一览无余**：完整展示各模型完整全称（如 \`Flare 2.5 闪电绘图\`、\`商汤 SenseNova U1.5 Lite\`、\`MiniMax H3 (海螺视频)\` 等），绝不再出现两三个字加省略号（\`...\`）的尴尬截断，彻底解决模型名称挤压嵌入隔壁卡片的排版缺陷；
- **自适应高亮折后费率**：卡片右侧直接高亮呈现当前会员身份的生效价格（如 SVIP/VIP 专属折扣价、限免 ¥0.00 标示），并展示模型特性简述，方便创作者快速比对性能与成本。

#### 2. 漫剧画布顶栏模型选择器费率对齐与防遮挡优化
- **实时拼接生效价格**：分镜生成模型下拉菜单中，为每款模型完整展示全称、Tag 标签与当前会员真实费率（如 \`Flare 2.5 闪电绘图 [超快极速] — SVIP ¥0.07/张\`，\`商汤 SenseNova U1.5 Lite [限免4K] — 限免 ¥0.00\`）；
- **自适应视口宽度与间距优化**：扩展选择器容器可用宽度并优化内边距，消除收起态选中文本被右侧原生小箭头遮挡截断的问题，选型体验清晰流畅。

---

### 安装与使用方法 (DSH 客户端直接操作 · 推荐)

1. 打开 **DeepSeek Harness** 客户端，进入左侧 **「插件」** 页面；
2. 点击右上角 **「+ 添加插件」**，选择 **「安装第三方插件」**；
3. 粘贴安装地址：
   - **国内免魔法高速镜像（推荐，解决网络超时）**：
     \`\`\`text
     https://ghproxy.net/https://github.com/AyzRuoshui/dsh-plugin-winetoken/archive/refs/tags/${version}.tar.gz
     \`\`\`
   - **GitHub 官方直链**：
     \`\`\`text
     https://github.com/AyzRuoshui/dsh-plugin-winetoken/archive/refs/tags/${version}.tar.gz
     \`\`\`
4. 点击确认，DSH 即可通过内置包管理器秒级完成安全增量安装，已有配置与历史数据 100% 完好无损！
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
