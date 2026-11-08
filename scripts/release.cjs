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
  const releaseTitle = `Release ${version} - 手机端界面适配与画布右键菜单改造`;
  const releaseBody = `## DeepSeek WineToken 插件 ${version}

本版聚焦两处交互打磨：**手机端显示适配** 与 **漫剧画布右键菜单**。

### 1. 手机端适配：账户中心卡片不再越界出屏
- 账户中心弹层在窄屏 / 手机视口（≤640px）下自动切换为**视口居中固定面板**（左右各留边、垂直居中、超高可滚动），彻底解决卡片超出屏幕左边界、内容被裁切的问题；
- 桌面端行为完全不变（仍为锚定余额胶囊的 320px 弹层）；窗口拖窄即可预览手机布局；
- 新手引导卡宽度按视口钳制，手机上定位不再越界。

### 2. 漫剧画布：新建节点菜单改右键呼出
- 呼出方式由"双击空白处"改为**右键空白处**（对标桌面软件右键菜单惯例），画布任何位置右键均不再弹出浏览器原生菜单；
- **点击 / 右按菜单外任意处自动收起**，不再赖着不走；
- 在另一处空白右键，菜单直接移动到新位置；\`Tab\` 快捷键与 \`Esc\` 收起保留。

### 3. 工程状态
- 全部源码 \`node --check\` 通过；
- 自动化测试 **23 / 23 全绿**；交互改造静态断言 **15 / 15 全过**；
- 发布脱敏门禁 **0 违规**。全程未发起任何真实生成调用。

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
