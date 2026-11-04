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
  const releaseTitle = `Release ${version} - 完美对齐 DSH 大模型 Tools 规范与 Cordis 依赖注入，彻底打通灵宝等模型原生生图/生视频技能`;
  const releaseBody = `## 🚀 DeepSeek Harness WineToken 插件 ${version}

### 🎨 核心重磅更新：彻底打通大模型原生创作工坊技能调用 (Tool Calling)

1. **[完全对齐 DSH Tools 官方底层规范 (output.schema)]**
   - 官方底层 \`@deepseek-ai/dsh-tools\` 强制执行 \`assertSupportedJsonSchema(output.schema)\` 硬断言校验；
   - 本次更新为 \`winetoken_generate_image\`（AI 绘图）与 \`winetoken_generate_video\`（AI 视频生成）补全了标准 JSON Schema 输出规范与 \`isConcurrencySafe\` 并发标记，工具注册 100% 顺畅通过底层校验！

2. **[Cordis 插件依赖注入 (inject: ['tools', 'systemPrompt'])]**
   - 严格遵循 Cordis 容器标准，在模块导出声明静态依赖，确保 \`ctx.tools\` 与 \`ctx.systemPrompt\` 准备就绪后再行注入，100% 杜绝时序竞态问题。

3. **[注入会话级动态 System Prompt 认知引导]**
   - 通过 \`ctx.systemPrompt.section\` 注入专属技能指令，彻底消除大模型（如王者荣耀灵宝、DeepSeek、GLM 等）预训练自认“我是文本模型无法生图”的认知惯性，引导大模型在用户提出绘画、设计、头像或视频需求时 100% 积极触发创作工坊！

4. **[端到端闭环渲染与持久化沉淀]**
   - 大模型调用创作工坊生成的图片与视频，直接在对话流中以内联高保真卡片/HTML5 播放器渲染，并自动沉淀至左侧「创作工坊」历史库。

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
