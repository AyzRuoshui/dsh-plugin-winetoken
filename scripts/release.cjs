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
  const releaseTitle = `Release ${version} - 漫剧画布换 React Flow 引擎`;
  const releaseBody = `## DeepSeek WineToken 插件 ${version}

本版将漫剧画布的底层引擎整体换成 React Flow（节点画布标准库），交互手感全面升级，旧工程自动无损迁移。

### 1. 画布换引擎：React Flow
- 拖拽、缩放、框选、连线、小地图全部改由 React Flow 原生驱动，操作跟手度与大画布流畅度显著提升；
- 6 类自定义节点：角色 / 分镜 / 图片生成 / 视频生成 / 文本 / 分组，节点上直接调比例、画质、时长、张数与提示词；
- 连线即输入的全能参考保持不变：视频节点按上游图片数量自动切换文生视频 / 首帧参考 / 全能参考。

### 2. 新增：双击添加节点
- 双击画布空白处弹出添加菜单（图片 / 视频 / 文本 / 分镜 / 角色），在双击位置直接建节点；与双击节点、连线编辑做了冲突阻断，不会误触；
- 底部工具栏同步改挂画布浮动面板，小地图换成原生组件。

### 3. 旧工程无损迁移 + 旧画布可回退
- 旧版工程打开时自动转换为新格式（原子写盘 + 备份 + 回读校验），角色、分镜、候选图、资产引用零丢失；
- 保留旧画布作为回退：设置 localStorage 的 WINETOKEN_CANVAS_ENGINE=legacy 即可切回；新引擎初始化异常时自动回退。

### 4. 工程状态
- 自动化测试 143/143 全绿（新增迁移契约、边注入、视图层契约用例）；发布脱敏门禁 0 违规；零 Emoji 工业风。

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

> 说明：模型调用会在中转站产生额度消耗，请按自身额度使用。
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
