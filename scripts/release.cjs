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
  const releaseTitle = `Release ${version} - 现代化 AI 漫剧画布创作工坊、双账轨资产闭环与架构全面重构加固`;
  const releaseBody = `## DeepSeek Harness WineToken 插件 ${version}

### 核心特性与架构升级

本次更新是 WineToken 插件的里程碑重大升级（v2.0.0），全面落实工程架构审查规范，消除多项关键隐患，并重磅带来现代化 AI 漫剧画布全景创作工坊！

#### 1. 现代化 AI 漫剧画布全景创作工坊 (Comic Canvas Studio)
- **无限视口漫游**：基于 Direct DOM Transform 硬件加速，支持 20%~300% 极速平滑平移缩放、光标定点阻尼缩放与视口一键复位；
- **分镜卡片自由拖拽排版**：卡片顶栏注入拖拽手柄，支持 8px 流式网格磁吸对齐，三次贝塞尔拓扑流光连线随卡片移动实时重算吸附；
- **角色 DNA 锚定与一致性绑定**：多角色资产库与参考图绑定，彻底解决跨分镜角色“换脸”与服装画风漂移问题；
- **WAL 异步任务队列与跨 Tab 水合保活**：引入 Write-Ahead Log 本地离线任务队列驱动与全局单例水合，彻底杜绝切 Tab 或刷新导致丢图与状态丢失 (CANVAS-01, CANVAS-02)；
- **30 步命令模式撤销/重做堆栈**：支持全局 \`Ctrl+Z\` 撤销与 \`Ctrl+Y\` 重做，删除分镜卡片增加原生二次确认拦截与状态压栈 (CANVAS-04)；
- **条漫长图自适应导出**：离屏 Canvas 渲染导出高清条漫长图，台词对白多行自适应折行断句，杜绝溢出重叠 (CANVAS-05)。

#### 2. 创作工坊与双账轨计费闭环
- **工坊视频模式全链路打通**：工坊视频点击生成接入真实云端网络请求与 120 秒异步长轮询，终结虚假存根弹窗 (BILLING-01, BILLING-05)；
- **前置余额校验与受控并发**：批量出图前自动核验账户总可用额度，采用受控并发池（Concurrency Limit=2）杜绝透支双花与并发击穿 (BILLING-03)；
- **双账轨账本显示对齐**：清晰隔离服务端【钱包永久余额】与【周期套餐配额】，30 秒定时静默轮询。

#### 3. 架构安全加固与微内核生命周期防护
- **彻底消除 TDZ 暂存死区崩溃风险**：优化常量提升顺序，防御启动阶段 ReferenceError 崩溃 (ARCH-01)；
- **移除进程误杀逻辑**：配置校验异常改为优雅降级返回，坚决禁止调用 \`process.exit(1)\` 误杀宿主桌面进程 (ARCH-03)；
- **会话级滑动窗口熔断器**：大模型 Tool Calling 注入 \`SessionCircuitBreaker\`，连续 2 次失败触发 30 秒熔断保护，杜绝模型纠错死循环消耗用户资产 (TOOL-01)；
- **安全打开文件与凭据脱敏**：重构 \`openFile\` 增加白名单扩展名校验与安全路径规整，消除命令行注入隐患 (SEC-03)；修复 API Key 脱敏边界 (SEC-06)；
- **只读版本检查与防覆写**：废除后台第三方静默代码覆写逻辑，彻底杜绝供应链 RCE 风险 (SEC-01)。

#### 4. 自动化测试防线与代码库净化
- **全量单元测试套件**：建立 \`tests/\` 自动化测试集（覆盖 WAL 任务队列、几何数学计算、原子工程落盘、熔断器状态机与安全防误杀），\`npm test\` 全部通过；
- **死代码全量清除**：移除历史残留僵尸文件，清理彩色 Emoji 图标，对齐工业级纯文本交付规范。

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
4. 点击确认，DSH 即可通过内置包管理器秒级完成安全增量安装，已有配置与历史数据 100% 完好无损！
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
