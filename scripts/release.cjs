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
  const releaseTitle = `Release ${version} - 修复 cordis.patch.yml 空列表写入损坏与安全备份`;
  const releaseBody = `## DeepSeek WineToken 插件 ${version}

本版为稳定性修复版本，解决特定场景下 \`cordis.patch.yml\` 被追加损坏的问题，并增加覆写前一次性原始备份机制。

### 1. 修复：空补丁文件 \`[]\` 不再损坏 cordis.patch.yml
- 当 \`cordis.patch.yml\` 仅包含空流式列表 \`[]\`（或仅含注释与 \`[]\` / \`[ ]\`）时，合并引擎现将其识别为空文档并生成标准根级块列表，不再于 \`[]\` 下方错误追加 \`- id: llm-pi-ai\` 导致 YAML 损坏；
- 合法的块级序列文件保持原有增量合并行为，完整保留其他 provider 与用户注释并保持幂等。

### 2. 防护：不支持的补丁文件结构原样保留并告警
- 在未找到顶层 \`- id: llm-pi-ai\` 需走文末追加分支时，仅当首个有效行以 \`- \` 开头（块级序列根节点）才执行追加；
- 对于映射根节点、流式映射、非空流式列表、标量、缩进序列或多文档 \`---\` 等不支持格式，保持原文件内容完全不变并输出 \`console.warn\` 告警。

### 3. 保护：覆写前一次性生成 cordis.patch.yml.bak 备份
- \`updateCordisPatch\` 在覆写已存在且内容实际发生变更的 \`cordis.patch.yml\` 之前，若同目录尚无 \`cordis.patch.yml.bak\`，自动将原有内容保存为一次性备份；
- 后续定时同步不会覆盖已有备份；文件尚不存在或内容未发生变更时不创建备份。

### 4. 工程状态
- 自动化测试全部通过；零 Emoji 工业风；零新增运行依赖。

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
