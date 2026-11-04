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
  const releaseTitle = `Release ${version} - 支持自定义保存路径(原生另存为)、本地文件直接打开与视频播放增强`;
  const releaseBody = `## DeepSeek Harness WineToken 插件 ${version}

### 核心修复与系统级体验升级

本次更新彻底解决了桌面客户端下媒体保存误弹浏览器的问题，并赋予创作者完全自由的路径选择与本地文件管理能力。

#### 1. 自定义保存路径与 Windows 原生“另存为”对话框
- **自由选择存放位置**：点击“保存到本地”或漫剧画布“导出条漫长图”时，自动唤起 Windows 原生 \`SaveFileDialog\`，支持自由切换任意磁盘盘符（C盘、D盘、外接移动硬盘）、新建文件夹并自定义文件名；
- **零黑框静默运行**：通过 Node.js 子进程静默拉起，完全无控制台黑框闪烁，拉起延迟 < 200ms；
- **智能目录记忆**：自动记忆创作者上次保存选择的目录路径，下次保存自动默认打开该目录，无需反复翻找；
- **置顶保障**：自动注入 TopMost 置顶属性，确保另存为窗口始终位于 Electron 界面最上方，杜绝窗口被遮挡。

#### 2. 彻底脱离外部浏览器，纯底层二进制文件落盘
- **根除误弹浏览器缺陷**：彻底废弃 Web 前端跨域 \`<a download>\` 被 Chromium 强制拦截唤起 Edge/Chrome 的问题，采用 Node.js 24 原生二进制流直接物理写入磁盘；
- **保存后自动定位**：保存成功后自动在 Windows 文件资源管理器中高亮选中该文件，且操作栏按钮自适应变为 \`[定位文件]\`，便于秒级查找。

#### 3. 点击画面直接以系统默认应用打开
- **以本地文件查看**：在工坊主舞台直接点击画面大图，直接唤起 Windows 系统默认看图工具（如照片、查看器或用户关联的看图软件）；若尚未保存则自动在后台缓存后秒级调起打开；
- **操作栏快捷入口**：提供原生的 \`[以文件打开]\`、\`[保存到本地 / 定位文件]\` 与 \`[存储目录]\` 按钮。

#### 4. 视频多模态原生播放与漫剧条漫长图导出对齐
- **主舞台原生支持视频**：历史记录中的视频类型自动渲染 HTML5 原生播放控件 (\`<video controls autoPlay loop>\`)，彻底解决视频黑屏与裂图问题；画廊缩略图增加专属视频标识并支持双击以文件打开；
- **漫剧 AI 画布长图原生另存为**：一键拼版后的 1080P 条漫长图同样接入原生另存为窗口，用户可自由挑选保存目录。

---

### 安装与使用方法 (DSH 客户端直接操作 · 推荐)

1. 打开 **DeepSeek Harness** 客户端，进入左侧 **「插件」** 页面；
2. 点击右上角 **「+ 添加插件」**，选择 **「安装第三方插件」**；
3. 粘贴安装地址：
   - **国内免魔法高速镜像（推荐，解决网络超时）**：
     \`\`\`text
     https://ghproxy.net/https://github.com/AyzRuoshui/dsh-plugin-winetoken/archive/refs/tags/${version}.tar.gz
     \`\`\`
   - **GitHub 官方直链**：
     \`\`\`text
     https://github.com/AyzRuoshui/dsh-plugin-winetoken/archive/refs/tags/${version}.tar.gz
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
