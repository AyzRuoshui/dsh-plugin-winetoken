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
  const releaseTitle = `Release ${version} - 紧急修复模型不同步、跨进程凭据分裂与商汤尺寸报错 (Hotfix)`;
  const releaseBody = `## DeepSeek Harness WineToken 插件 ${version}

### 紧急更新说明 (Hotfix 2.0.1)

针对社区与创作者反馈的现场 Bug 报告，v2.0.1 紧急闭环解决了以下关键问题：

#### 1. 彻底解决模型列表不同步与提供商丢失问题 (P0)
- **解构 DSH Loader 覆盖机制**：针对用户层 \`cordis.patch.yml\` 整体覆盖 bundle patch 的宿主特性，独立研发 \`src/patch-engine.js\` 纯原生零依赖增量合并引擎；
- **开机即时自愈保底**：无论用户是否配置 Key，插件加载时无条件优先在用户层注入 19 个经典静态基线模型，模型选择器中 WineToken 官方模型 100% 稳定秒现；
- **零破坏已有配置与注释**：增量注入严格保留用户已有的所有自定义 provider（如 \`zhaizhu\` 等）以及原始 YAML 用户注释，通过行级严格缩进判定保证 100% 幂等写盘。

#### 2. 终结跨进程凭据命名空间分裂 (P1)
- **统一凭据解析中枢 (\`src/credentials.js\`)**：全面统一 Tool Calling、开机生命周期、CLI 同步及前端 UI 的凭据探测链路；
- **别名自愈与双向补齐**：自动兼容宿主官方账号设置生成的 \`ZHAIZHU_API_KEY\` 与 \`WINETOKEN_API_KEY\`，识别别名后自动双向补齐同值映射，彻底根除“未检测到 API Key”误判；
- **物理落盘回读强校验**：前端配置 Key 时执行物理落盘回读验证，写入失败时向用户明确报错，彻底消灭假成功提示。

#### 3. 生图尺寸 32 倍数智能对齐 (P2)
- **算法级自动对齐**：生图链路注入 \`normalizeImageSize()\` 算法，自动 clamp 到 \`[512, 4096]\` 且向上/四舍五入对齐至 32 的整数倍；
- **优雅映射经典分辨率**：将经典的 \`1280x720\` / \`720x1280\` 智能映射为标准 32 倍数分辨率 \`1280x768\` / \`768x1280\`，彻底终结商汤日日新 (\`sensenova-u1.5-lite\`) 等严苛引擎的参数报错。

#### 4. 自动化测试防线扩充至 14 项
- 新增 PatchEngine 增量合并与注释保留回归测试；
- 新增统一凭据别名解析与换行符防御回归测试；
- 新增图像尺寸 32 倍数对齐算法回归测试；
- 全部 14 项自动化测试 100% 通过。

---

### 安装与使用方法 (DSH 客户端直接操作 · 推荐)

1. 打开 **DeepSeek Harness** 客户端，进入左侧 **「插件」** 页面；
2. 点击右上角 **「+ 添加插件」**，选择 **「安装第三方插件」**；
3. 粘贴安装地址：
   \`\`\`
   https://github.com/AyzRuoshui/dsh-plugin-winetoken/archive/refs/tags/v2.0.1.tar.gz
   \`\`\`
   国内加速下载地址：
   \`\`\`
   https://ghproxy.net/https://github.com/AyzRuoshui/dsh-plugin-winetoken/archive/refs/tags/v2.0.1.tar.gz
   \`\`\`
4. 提示安装成功后，在弹出的重载提示中点击 **「重载窗口」** 即可畅享全新体验！
`;
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
