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
  const releaseTitle = `Release ${version} - 视频工坊首帧 / 尾帧独立双槽位`;
  const releaseBody = `## DeepSeek WineToken 插件 ${version}

响应创作者反馈：视频工坊此前把多张参考图混在一个槽位栏里，模型无法分辨哪张是开场、哪张是收尾（且多出的图会被静默丢弃）。本版将视频画面帧拆成**独立首帧 / 尾帧双槽位**，语义在界面上定死，并按模型族以显式字段上行，让模型明确识别帧角色。

### 1. 视频画面帧双槽位
- 视频工坊左侧参考栏改为 **「首帧 · 开场画面 → 尾帧 · 收尾画面」** 两张独立卡片：各自上传 / 拖拽 / 更换 / 删除，尾帧为可选项；
- 状态行实时提示「首尾帧驱动 · 模型明确识别开场与收尾」，提交按钮按 文生 / 首帧 / 尾帧 / 首尾帧 四态显示。

### 2. 上行协议按模型族显式映射（依据中转站 New-API 内置插件源码核实）
- **MiniMax-H3（海螺）**：以 \`metadata.first_frame_image\` / \`metadata.last_frame_image\` 显式标注帧角色，不再依赖「多图数组按序猜帧」；
- **grok-imagine-video-1.5**：以 \`image\`（首帧）+ \`last_frame\`（尾帧）上行；并规避了顶层 \`images\` 数组会被解读为参考图集（reference_to_video，限制分辨率）的协议陷阱；
- 兼容保留 \`image\` 字段，旧版首帧行为不变；两个现役视频模型均原生支持尾帧，**服务端零改动**。

### 3. 旧素材无缝迁移
- 图像工坊 → 视频工坊：参考图 1 / 2 自动迁移为首帧 / 尾帧；反向切回时若参考库为空则反向回填，创作素材不丢失；
- 重复上传同一槽位直接覆盖（15MB 上限不变），杜绝多图歧义。

### 4. 图像模式与画布不受影响
- 图像工坊 5 槽位多参考垫图体系（别名、拖拽指代、语义解耦编译）原样保留；漫剧画布分镜生图链路未触碰。

### 5. 工程状态
- 全部源码 \`node --check\` 通过；
- 自动化测试 **23 / 23 全绿**；
- 首尾帧功能静态断言 **23 / 23 全过**（含协议字段、UI 文案、脱敏自检）；
- 发布脱敏门禁 **0 违规**。全程未发起任何真实生成调用（帧字段核实依据 New-API rc.48 源码与无效 Key 路由探针，零额度消耗）。

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
