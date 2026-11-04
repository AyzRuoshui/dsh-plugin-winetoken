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
  const releaseTitle = `Release ${version} - 重构大模型生图二阶段授权协议，彻底根除失控滥调与批量扣费`;
  const releaseBody = `## 🚀 DeepSeek Harness WineToken 插件 ${version}

### 🛡️ 大模型原生 Tool Calling 防暴走与用户资产保护重构

1. **[确立生图/生视频“二阶段确认协议”]**
   - 彻底废除旧版强催大模型立即抢跑调用的侵入式指令，注入严密的《高能多模态工具调用与付费资产保护铁律》；
   - **第一阶段（构思与征询）**：当用户提出画图/视频意向时，模型被严格禁止直接调用工具，必须先向用户展现画面构思方案（艺术风格、画面主体、光影比例），并征询用户：“AI生图属于付费操作，若您认可上述构思请回复‘确认生成’，我将为您正式制作”；
   - **第二阶段（单次授权出图）**：只有在用户明确回复“确认生成”、“开始画吧”、“立即出图”等肯定指令时，模型方可执行调用。

2. **[四重物理防暴走机制 · 彻底根除失控滥调]**
   - **底层并发封锁**：将生图与生视频工具的 \`isConcurrencySafe\` 强制设为 \`false\`，彻底封禁 DSH 底层调度器的并行调度，从物理上杜绝单轮同时发起多个任务；
   - **参数硬收敛**：Tool Schema 将 \`count\` 锁定为 \`enum: [1]\`；执行代码强制 \`const count = 1;\`，即使极端模型出现幻觉也坚决只生成单张，杜绝批量扣费；
   - **描述词高耗警示**：工具描述明确标注为“高耗付费操作”，严禁未经授权调用。

3. **[创作工坊自适应画廊稳定运行]**
   - 包含 v1.6.1 的现代化舞台-操作栏解耦模式，2:3 竖屏、9:16 长图、1:1 方屏、16:9 横屏全宽高比自适应居中，悬浮操作栏物理保护不被遮挡；
   - **SUPER** 会员专属青色徽章与特权通道稳定运行，双账轨高精度计费状态机深度加固。

---

### 🔌 安装与使用方法 (DSH 客户端直接操作 · 推荐)

1. 打开 **DeepSeek Harness** 客户端，进入左侧 **「插件」** 页面；
2. 点击右上角 **「+ 添加插件」**，选择 **「安装第三方插件」**；
3. 粘贴安装地址：
   - **国内免魔法高速镜像（强烈推荐，解决 ETIMEDOUT 超时）**：
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
