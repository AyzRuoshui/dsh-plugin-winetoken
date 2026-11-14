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
  const releaseTitle = `Release ${version} - 画布对标 infinite-canvas 全面升级`;
  const releaseBody = `## DeepSeek WineToken 插件 ${version}

本版按 basketikun/infinite-canvas 的做法重构漫剧 AI 画布，交互与能力全面对标无限画布工作台，并接入 DSH 原生画布协作工具。

### 1. 画布架构与交互
- 多工程管理：新建 / 切换 / 重命名 / 回收站恢复 / 工程导入导出，旧单文件工程零迁移接入；
- 小地图：按节点类型着色的缩略图、视口矩形、点击或拖拽快速定位；
- 视口缩放范围对齐上游 5%~500%；全部写盘原子化 + 双备份 + 物理回读强校验；
- 保留三级水合与 WAL 任务队列，切 Tab / 刷新不丢草稿与资产。

### 2. 节点即生成器
- 连线成为生成输入：上游图片节点作参考图、文本节点补充提示词、参数节点覆盖模型与尺寸；
- 图片节点可直接编辑提示词并「重跑」，生成结果落本地资产库，节点只持引用键；
- 视频节点：新建 / 重跑 / 取消，3 秒长轮询（最长 120 秒）与状态机，上游图片连线作首帧，产物本地落盘；
- 提示词库：收藏 / 搜索 / 插入 / 删除 / 导入导出，快捷键面板与新手引导同步补齐。

### 3. DSH 原生画布协作工具
- 新增 winetoken_canvas_get_storyboard（只读）、winetoken_canvas_add_panel（写入不扣费）、winetoken_canvas_generate（付费入队）；
- 宿主工具经磁盘工程文件桥读写画布，生成任务只写 WAL 存根、由画布前端执行，杜绝宿主与前端双花扣费；
- 沿用 sensitive 权限确认、会话级熔断器与结构化返回。

### 4. 工程状态
- 全量源码 node --check 通过；
- 自动化测试 113 / 113 全绿（含脏环境破坏性契约测试）；
- 宿主桩加载探针通过；发布脱敏门禁 0 违规；零 Emoji 工业风；
- 本次为本地实现与自动化验证闭环，真实视频生成等模型调用请在 DSH 客户端内按需使用（会消耗额度）。

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
