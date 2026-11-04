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
  const releaseTitle = `Release ${version} - 上线 SUPER 专属青色特权系统、免流模型展台与全平台八折特惠`;
  const releaseBody = `## 🚀 DeepSeek Harness WineToken 插件 ${version}

### 💎 上线 SUPER 专属青色特权系统与无限免流模型

1. **[SUPER 专属青色特权标识体系]**
   - 底部状态栏胶囊与创作工坊顶栏为 **SUPER** 分组用户引入专属青色（Cyan）高贵微光徽章与 Crown 图标；
   - 账户中心卡片升级为青色特权展台，精准彰显用户尊贵身份。

2. **[无额度特权设计 · 告别套餐余额包袱]**
   - 彻底遵循特权分组逻辑：SUPER 用户无固定配额额度限制，账户中心与底栏 100% 隐藏普通套餐余额、配额与进度条；
   - 顶栏直接连接并呈现「钱包永久保底余额」与「总累计真实调用」。

3. **[双重核心特权展台全量落地]**
   - **特权一**：**无限量 \`deepseek-v4.1-flash-free\`**（专属免流绿色通道，0 Quota 消耗免费畅享）；
   - **特权二**：**全平台所有模型享 8 折特权（与 SVIP 同级 0.8x）**；
   - 服务端 New-API 计费网关双向锁定 \`GroupRatio\`，创作工坊动态定价精准对齐 8 折。

4. **[零闪烁缓存与持久化]**
   - 本地状态持久化全面适配 \`isSuper\` 标识，客户端冷启动 0 秒恢复青色特权状态，杜绝界面初次加载闪烁。

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
