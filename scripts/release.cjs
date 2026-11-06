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
  const releaseTitle = `Release ${version} - AI 漫剧画布交互对标 LibTV (节点工作流 / 组织力 / AI 拆镜)`;
  const releaseBody = `## DeepSeek WineToken 插件 ${version}

本版本把 AI 漫剧画布从"静态卡片墙"升级为**可缩放、可组织、万物皆节点的无限画布工作流**，交互层完整对标 LibTV。存储 schema 由 2.1.0 增量演进至 2.2.0，旧工程文件零迁移、向后兼容。

### 1. 画布手感 (对标 LibTV 快捷键全集)
- **无限视口**：Ctrl+滚轮 / 触控板捏合定点缩放 (20%~300%)、普通滚轮 / Shift+滚轮 / Space / 中键多通道平移、V / H 工具状态机、\`Ctrl+0\` 一键适应画布总览；
- **专业选择集**：橡皮筋框选、Shift 加减选、\`Ctrl+A\` 全选、多选批量移动（单次手势单快照）、\`Del\` 批量删除；
- **对齐吸附**：8px 网格磁吸 + 6px 阈值对齐参考线（青色辅助线）；
- **统一快捷键管理器**：所有快捷键单点注册，输入框 / contentEditable 聚焦时统一失效，消除三处分散 keydown 的互相踩踏。

### 2. 节点范式 (万物皆节点，边是数据)
- 新增 \`canvasItems[]\` / \`edges[]\` 数据模型（schema 2.1.0 增量字段）：图片 / 文本节点、分镜生成图自动作为独立图片节点落画布并 \`panel → image\` 自动连边、提示词随节点保存；
- **连线**：\`Ctrl+L\` 点击连线模式、绿色锚点拖出连线、SVG 数据驱动贝塞尔边、边可选中 / 删除、建边去重；
- **新建**：\`Tab\` / 双击空白弹出节点类型菜单（分镜 / 角色 / 图片 / 文本）；
- **复制三件套**：\`Ctrl+D\` 复制节点和其间连线、\`Alt+拖动\` 克隆节点、\`Ctrl+Alt+拖动\` 创建副本（保留对外连线）；
- **批量生成**：\`Ctrl+Enter\` 对所选分镜逐个入队（350ms 受控间隔）。

### 3. 组织力 (承接"很长的画布")
- 新增 \`groups[]\`（schema 2.2.0 增量字段）：\`Ctrl/Alt+G\` 成组 / 解组、\`Ctrl+Alt+G\` 合并分镜组，组虚线底框 + 可点击标题，拖组成员整组随动；
- \`Alt+Shift+F\` 整理画布：\`layoutCanvas()\` 纯函数按镜号分列自动排布 + 执行后自动 fit；
- \`Ctrl+F\` 节点搜索：镜号 / 景别 / 提示词 / 台词 / 角色名 / 节点文本 / 组名模糊定位居中；
- **AABB 视口虚拟化**：离屏节点显示裁剪，支撑 100+ 节点长画布。

### 4. AI 剧本拆镜自动铺图
- 工具栏「AI拆镜」：粘贴剧本 → 调用对话模型结构化拆解 → \`parseStoryboardJSON()\` 稳健解析（剥围栏 / 容寒暄 / 脏数据降级）→ 分镜卡阵列自动铺上画布并适应视图；
- 未实测真实 LLM 调用（遵守额度约束，待放行验收）。

### 5. 修订与稳定性
- 修正 super 用户身份显示为独立「SUPER」（权益仍 ≡ SVIP 8 折），定价逻辑不变；
- 撤销栈覆盖节点 / 连线 / 组，30 步快照栈；边随节点删除自动清理；
- 画布新手引导扩为 5 步，快捷键速查面板补「节点与连线」「组织」两组；
- 自动化测试扩充至 **23 项全绿**（新增对齐参考线、自动布局、剧本 JSON 解析、旧工程 2.0.0→2.2.0 迁移回归等）。

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
4. 提示安装成功后，在弹出的重载提示中点击 **「重载窗口」** 即可畅享全新体验！

> 说明：画布交互可自由测试；\`Ctrl+Enter\` 批量生成、生图 / 生视频、AI 拆镜的真实模型调用会在中转站产生额度消耗，请按自身额度使用。
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
