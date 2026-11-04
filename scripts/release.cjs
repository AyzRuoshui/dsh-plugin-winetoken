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
  const releaseTitle = `Release ${version} - 创作工坊与大模型 Manifest 动态热更新 (免发版) 及多模态模型热挂载`;
  const releaseBody = `## DeepSeek Harness WineToken 插件 ${version}

### 核心特性与架构升级：动态 Manifest 线上热更新

本次更新彻底解除了创作工坊生图/生视频模型与大模型工具层的静态死锁，构建了端到端全链路免发版动态感知体系。平台上线新模型、下架通道或调整定价时，创作者无需更新插件，客户端无感实时同步。

#### 1. Manifest SWR 增量热更新与三级防御体系
- **Level 1（静态内存基底兜底）**：保留成熟经典模型参数作为底层保底，即使全新离线环境首次安装启动，依然 100% 稳定秒开，零白屏、零报错；
- **Level 2（本地双轨持久化）**：利用本地持久化缓存，应用冷启动 0 秒恢复历史模型与定价，告别数据空白抖动；
- **Level 3（SWR 增量后台热拉取）**：通过全局 Manifest 单例引擎，后台静默拉取网关最新模型元数据（含上下文、视觉/思考链标记、单价与 VIP 折扣），自动归一化并驱动界面响应式刷新；网络波动时静默降级。

#### 2. 创作工坊响应式模型矩阵与自动纠偏
- **响应式 State 驱动**：工坊下拉选择、分辨率单选组、生成时长动态读取最新 Manifest 规格；
- **自动纠偏机制**：当切换模式或模型热更新导致原选中模型不在列表内时，自动纠偏选中第一款可用模型，杜绝死锁与空指针；
- **漫剧 AI 画布动态限免**：单格分镜出图自动识别并选用平台当前最新的 4K 限免直出模型。

#### 3. 大模型工具层（Tool Calling）解绑与参数放宽
- **放宽模型限制**：解除大模型生图（\`winetoken_generate_image\`）与生视频（\`winetoken_generate_video\`）参数对模型 ID 的硬编码锁定，允许线上新增模型顺畅调用；
- **双模态安全确认**：严格遵循二阶段确认协议，强制单次单张出图，杜绝模型并发暴走消耗资产。

#### 4. 宿主生命周期智能同步
- **冷启动 2 秒静默检测**：优先拉取包含精确 Tags、上下文长度与思维链标识的对话推理模型同步至 \`cordis.patch.yml\`；遇网络波动平滑回退，保障系统运行平稳。

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
