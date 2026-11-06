// -*- coding: utf-8 -*-
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
  const releaseTitle = `Release ${version} - 画布清晰度 / AI拆镜模型选择 / 工具栏排版修订`;
  const releaseBody = `## DeepSeek WineToken 插件 ${version}

v2.1.0 之后的交互修订版，聚焦三处实机反馈：**画布放大发糊、AI拆镜不能选模型、窄窗口顶部按钮文字换行**。存储结构与 v2.1.0 完全一致（schema 2.2.0），旧工程零迁移、向后兼容。

### 1. 画布放大后文字/图片发糊 (交互体验修复)
- **根因**：缩放层原先用 \`translate3d(...) scale()\` + \`willChange: transform\`，会促使 Chromium 把整个画布层预先栅格化为一张固定分辨率的合成纹理，随后的 \`scale\` 放大只是在拉伸这张纹理；层内图片还额外加了 \`translateZ(0)\`，二次锁定分辨率——表现就是"画布像一张被放大的图片"、明显低于四周 UI 的清晰度。
- **修复**：缩放层改回 2D \`translate\`，移除 \`willChange\` 与层内图片 / 灯箱的 \`translateZ(0)\` + \`backfaceVisibility\`，让浏览器在缩放时按目标分辨率重新栅格化文字。放大到 166% 及以上，卡片文字与 UI 保持同等清晰度。

### 2. AI 剧本拆镜支持自选模型
- 弹窗新增「拆解模型」下拉，与生图模型共用 Manifest 动态对话模型列表（SWR 热更新）；选中项写入 localStorage，下次打开自动记住。
- \`runAiSplit\` 由原来"永远取列表第一个"改为：优先使用所选模型 → 未选或该模型已下线则退回列表首个 → Manifest 为空时用生产兜底模型。
- 移除会触发发布脱敏门禁的受限免费通道兜底写法。

### 3. 顶部工具栏窄窗口排版
- 整条工具栏 \`flex-wrap: nowrap\` + \`overflow-x: auto\`（隐藏滚动条的横向滚动兜底）；
- 全部按钮与分隔线 \`flex-shrink: 0\` + 文字 \`white-space: nowrap\`，中文不再被压缩成两行；
- 模型选择器宽度收紧（460→300 / 380→230），降低窄窗口挤压。

### 4. 工程状态
- 全部源码 \`node --check\` 通过；
- 自动化测试 **23 / 23 全绿**；
- 发布脱敏门禁 32 文件 **0 违规**。

---

### 安装与使用方法 (DSH 客户端直接操作 · 推荐)

1. 打开 **DeepSeek** 客户端，进入左侧 **「插件」** 页面；
2. 点击右上角 **「+ 添加插件」**，选择 **「安装第三方插件」**；
3. 粘贴安装地址：
   \`\`\`
   https://github.com/AyzRuoshui/dsh-plugin-winetoken/archive/refs/tags/${version}.tar.gz
   \`\`\`
   国内加速下载地址：
   \`\`\`
   https://ghproxy.net/https://github.com/AyzRuoshui/dsh-plugin-winetoken/archive/refs/tags/${version}.tar.gz
   \`\`\`
4. 提示安装成功后，在弹出的重载提示中点击 **「重载窗口」** 即可。

> 说明：画布交互可自由测试，不消耗额度；\`Ctrl+Enter\` 批量生成、生图 / 生视频、AI 拆镜的真实模型调用会在中转站产生额度消耗，请按自身额度使用。
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
