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
    const releaseTitle = `Release ${version} - 视频多图参考打通 · 画布真生成 · 全模型断点修复`;
  const releaseBody = `## DeepSeek WineToken 插件 ${version}

本版把视频多图参考全线打通，并修复漫剧画布的假生成与全模型审计查出的全部实锤断点。

### 1. 视频多图参考打通
- 创作工坊视频区：MiniMax H3 新增「首帧画面 / 全能参考」双模式，参考模式最多 9 张图、可拖拽排序；Omni 1.2 Flash 参考图最多 3 张；
- 服务端 hailuo 插件与 Flow 中转同步升级，多图载荷带体积守卫：参考图自动压缩（长边 2048）+ 总量 40MB 上限，超限前端直接拦截。

### 2. 漫剧画布真生成
- ReactFlow 画布的视频、图片、分镜节点此前是占位假生成，本版全部接入真实生成链：视频节点带模型选择与参考图条，图片与分镜节点与工坊同链，角色设定（DNA）与头像参考生效；
- 旧画布视频生成同步改走共享执行器，多图参考不再只取第一张。

### 3. 全模型审计断点修复
- 对话工具：参考图按模型能力分流，支持的走编辑链，不支持的明确报错，不再静默按文生图扣费；
- Nano Banana 2.1 放开参考图与 2K/4K 画质；
- 画布视频比例全链路透传，选竖屏就出竖屏；4:3 / 3:4 尺寸纠正为真比例；
- Grok 视频补齐画幅参数、分辨率口径修正；画布各节点下拉选项按所选模型能力收敛，清单外选项不再可选；
- 旧画布图片节点多图与单张模型拆批对齐工坊；Studio 首帧模式空提示词前端拦截；余额预检公式修正；清理已下架的幽灵模型。

### 4. 其他
- 自动化测试 188/188 全部通过；零新增运行依赖。

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
