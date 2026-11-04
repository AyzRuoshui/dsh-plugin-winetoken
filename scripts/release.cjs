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
  const releaseTitle = `Release ${version} - 全链路凭据双向即时对齐、冷启动引导与漫剧画布多角色高清重构`;
  const releaseBody = `## DeepSeek Harness WineToken 插件 ${version}

### 核心特性与架构升级

本次更新全面解决了用户反馈的凭据跨进程孤岛、冷启动缺少引导、漫剧画布角色死锁、模型自由选择与放大模糊问题，全链路体验大幅跃升。

#### 1. 全链路凭据双向中枢 (WineTokenCredentialBridge)
- **打破数据孤岛**：前端 UI 保存 Key 时，原子化同步写入 localStorage、process.env 与宿主 \`~/.dsh/.credentials.yaml\`；
- **100ms 官方微内核热重载**：依托 DSH 原生文件监视器，物理文件落盘 100ms 内官方模型列表瞬间点亮可用，大模型原生 Tool Calling 即刻生效，彻底告别二次配置；
- **反向智能补齐**：若用户在 DSH 官方卡片配置 Key，前端自动跨进程读取并写回 localStorage，实现双向无感对齐。

#### 2. 冷启动主动优雅引导与开箱即填
- **智能首屏延时弹窗**：应用启动 800ms 后检测到未配置 Key 时，平滑唤出账户配置卡片；
- **开箱即填体验**：无 Key 状态下输入框默认自动展开聚焦，文案温和指引，粘贴即可一键保存；
- **单会话防打扰**：采用 sessionStorage 记忆标记，用户关闭后本次会话不再重复强弹；
- **底部胶囊语义对齐**：未配置 Key 时以单色矢量 keyIcon 与“未配置 Key”直观指引。

#### 3. 漫剧 AI 画布多角色编排全面解绑
- **分镜角色随心切换**：分镜卡片顶栏升级为原生角色切换下拉菜单，随时将任一分镜切换给任意配角；
- **角色卡快捷【+添分镜】**：每个角色卡片右上角新增快捷按钮，一键生成专属归属于该角色的新分镜；
- **角色安全删除与级联回退**：角色总数大于 1 时支持删除配角，其绑定的分镜自动安全回退给主角，杜绝空悬 ID；
- **贝塞尔拓扑连线物理对齐**：根据所选角色的物理卡片位置动态计算纵向起始点，连线真正从所选角色引出，告别主角扎堆。

#### 4. 彻底解决放大模糊与 1:1 原画全屏灯箱
- **清除 GPU 纹理二次拉伸限制**：移除造成纹理降采样锁死的硬件加速属性，注入标准亚像素抗锯齿；
- **双击呼出全屏原画灯箱 (Lightbox)**：双击任意分镜图片即可弹出 1:1 沉浸式原图查看器，支持点对点无损放大，细节纤毫毕现。

#### 5. 全模态模型自由选择与卡片网格
- **漫剧画布顶栏模型选择器**：画布顶栏植入生图模型下拉框，动态拉取 Manifest 全量优质生图模型；
- **工坊高质感模型卡片网格**：废弃死板的系统级原生下拉弹窗，升级为高对比度自适应两列卡片网格，点选即生效；
- **双轨状态解耦**：生图与生视频模型状态独立记忆，模式切换不再强制覆盖；
- **智能并集容错算法**：本地 fallback 与线上 Manifest 智能合并，确保商汤 4K 限免与 MiniMax 永不丢失。

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
