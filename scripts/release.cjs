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
  const releaseTitle = `Release ${version} - 漫剧 AI 画布全景工作台上线：角色锚点锁定五官、条漫拼版导出与探照灯引导`;
  const releaseBody = `## DeepSeek Harness WineToken 插件 ${version}

### 全新特性：漫剧 AI 画布全景工作台 (AI Comic Canvas)

针对漫剧开发者在传统单图创作中“换镜头角色崩脸”、“多格排版反复切外部软件”、“试错扣费成本高”三大核心痛点，正式推出开箱即用的原生漫剧 AI 画布工作台。

#### 1. 60FPS Direct DOM Transform 无限视口引擎
- 采用硬件加速矩阵变换，彻底解耦 React 渲染树与高频平移缩放；
- **灵活操控**：支持 Space + 鼠标左键/中键任意平移漫游，滚轮光标定点阻尼缩放（20% ~ 300%）；
- **视口浮岛**：右下角常驻缩放百分比、步进控制与一键复位 100% 居中视野。

#### 2. 角色定妆与贝塞尔拓扑锚点卡群
- **角色 DNA 锁定**：独立主角资产卡，支持设定固定外貌、发型、服饰等 DNA 提示词；
- **定妆照本地直传**：支持点击角色方框直接上传本地照片（PNG / JPG / WEBP），支持一键清除；
- **拓扑流光连线**：自动生成 SVG 三次贝塞尔虚线流光，直观呈现角色与目标分镜归属；
- **跨镜头特征流转**：分镜生成时自动绑定角色定妆照垫图与外貌 DNA，彻底攻克角色崩脸难题。

#### 3. 分镜镜头控制与幽灵暂存层
- **专业景别一键切**：特写 (CU)、中景 (MS)、全景 (WS) 自动注入专业电影镜头语言；
- **内置四格漫画模版**：一键载入起承转合经典四格镜头结构，零门槛快速开机；
- **零消耗优先调度**：分镜绘制默认优先调用商汤 SenseNova 4K 限免模型，杜绝滥扣费；
- **幽灵暂存层 (InvokeAI Staging Layer)**：生成新分镜后作为金色发光候选层展示，支持对比后“保留”或“放弃”，不冲垮既有好图。

#### 4. 台词气泡与 1080P 条漫长图导出
- **台词对白气泡**：每个分镜格内置台词输入框；
- **纯原生 HTML5 Canvas 离屏拼版**：一键将全部分镜画面与半透明圆角漫画对白气泡拼接，导出标准 1080P 漫画长图，零依赖外部剪辑软件。

#### 5. 新手探照灯引导系统
- **SVG evenodd 反向遮罩**：原生动态抠孔探照灯，沉浸式 3 步核心引导；
- **跳过与持久化记忆**：支持 Esc、一键跳过与“不再自动弹出”持久化，顶栏随时保留重唤入口；
- **原生工业风视觉**：100% 杜绝 Emoji 表情包，统一采用 16px 单色矢量线框图标，自适应黑白主题。

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
