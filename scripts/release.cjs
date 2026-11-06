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
  const releaseTitle = `Release ${version} - 修复新版桌面端保存密钥失败与模型列表不自动同步`;
  const releaseBody = `## DeepSeek WineToken 插件 ${version}

修复新用户在**新版 DeepSeek 桌面端（全沙箱模式）**下安装后无法保存密钥（报 \`保存异常: require is not defined\`）、模型列表不自动同步的问题。两个症状同根因：新版 dsh-desktop 渲染进程为全沙箱（\`nodeIntegration:false\`），插件此前写宿主凭据文件的方式在该环境下必然失败。

### 1. 保存密钥接入 DeepSeek 官方通道
- 接入桌面端内置的 **凭据 Remote 服务**（\`ctx.remote.credentials.set / unset / describe\`）——与 DeepSeek 自家设置页相同的机制，客户端经认证 RPC 调用、宿主本地 provider 落盘 \`~/.dsh/.credentials.yaml\`；
- 写入通道优先级：**官方 Remote 通道 → 直写磁盘（旧版桌面端，行为不变）→ 仅本地生效降级**；彻底移除"保存异常: require is not defined"式误导报错。

### 2. 模型列表真·自动同步
- 宿主插件新增**凭据文件监视器**：密钥经任意通道落盘后自动触发模型同步引擎（1.8s 去抖 + 密钥快照幂等，杜绝循环触发）；
- 新用户保存密钥后，官方聊天模型列表**自动**从 19 个离线基线更新为线上全量清单，全程无感。

### 3. 降级语义明示
- 双通道皆不可达的极端环境下，保存仍保证**创作工坊生图 / 生视频 / 漫剧画布 / 账单**全链路可用（走本地存储），并如实提示边界，不再让人误以为"全坏了"；
- 老版本桌面端用户行为完全不变。

### 4. 工程状态
- 全部源码 \`node --check\` 通过；
- 自动化测试 **23 / 23 全绿**；沙箱兼容静态断言 **16 / 16 全过**；
- 发布脱敏门禁 **0 违规**。全程未发起任何真实生成调用（凭据通道依据 dsh-desktop 0.2.2 应用包静态分析与官方 Remote 协议核实）。

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
