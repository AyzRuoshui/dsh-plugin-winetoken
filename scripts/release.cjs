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
  const releaseTitle = `Release ${version} - 全链路真实费率精准对齐、模型全称规范化与视频工坊纯净化`;
  const releaseBody = `## DeepSeek Harness WineToken 插件 ${version}

### 核心特性与架构升级

本次更新全面规范了多模态模型命名、彻底校准了各模型标价与底层 New-API 生产数据库实际扣费表达式的一致性，并净化了视频模型列表。

#### 1. 全链路模型费率 100% 对齐 New-API 真实扣费
- **纠正历史低标误差**：彻底纠正此前客户端与 Manifest 中的标价偏差，严格对齐底层生产数据库扣费表达式；
- **生图模型费率对齐**：
  - GPT-Image 2.5 Flare：基准 ¥0.30/张 (VIP ¥0.27, SVIP/SUPER ¥0.24)；
  - GPT-Image 2.5 Sunburst：基准 ¥0.40/张 (VIP ¥0.36, SVIP/SUPER ¥0.32)；
  - GPT-Image 2 (经典高清)：基准 ¥0.20/张 (VIP ¥0.18, SVIP/SUPER ¥0.16)；
  - Google Imagen 3：基准 ¥0.15/张 (VIP ¥0.14, SVIP/SUPER ¥0.12)；
  - Grok Imagine 2.0 旗舰：基准 ¥0.50/张 (VIP ¥0.45, SVIP/SUPER ¥0.40)；
  - 商汤 SenseNova U1.5 Lite：官方限免 ¥0.00；
- **视频模型费率对齐**：
  - MiniMax H3：基准 ¥0.15/秒 (5秒 ¥0.75，VIP ¥0.70，SVIP/SUPER ¥0.60)；
  - Grok Imagine 视频旗舰：基准 ¥0.20/秒 (5秒 ¥1.00，VIP ¥0.90，SVIP/SUPER ¥0.80)。

#### 2. 模型名称规范化与视频工坊纯净化
- **还原 GPT-Image 家族全称**：规范为 \`GPT-Image 2.5 Flare\`、\`GPT-Image 2.5 Sunburst\`、\`GPT-Image 2 (经典高清)\`，杜绝前缀被随意省略；
- **剔除误配纯文本模型**：从视频模型清单与客户端兜底中彻底剔除商汤纯文本大模型（sensenova-6.8-flash）；
- **去除冗余后缀**：视频模型规范为 \`MiniMax H3\`，彻底移除 \`(海螺视频)\` 冗余后缀；
- **多级容灾与动态清洗**：\`normalizeImageModel\` 与 \`normalizeVideoModel\` 强化数据清洗，杜绝老旧本地存储脏数据回流。

#### 3. 工坊单列全宽响应式卡片与漫剧画布费率展示
- 工坊基底模型卡片采用单列全宽流式排版，模型全称、特性说明与会员实时生效费率一目了然，彻底消除名称截断与重叠；
- 漫剧画布顶栏模型选择器实时拼接当前会员折扣单价与限免标签，选型成本清晰透明。

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
    console.log(`[发布成功] Release: ${data.html_url}`);
  } catch (e) {
    console.error('[发布失败]', e.message);
  }
}

createRelease();
