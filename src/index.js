const { existsSync, readFileSync } = require('fs');
const { homedir } = require('os');
const { join } = require('path');

const name = 'dsh-plugin-winetoken';
const inject = ['tools', 'systemPrompt'];

/**
 * WineToken Harness Host Plugin (CommonJS)
 * 纯原生生命周期随 DSH 容器存亡，开机静默同步最新模型
 */
function apply(ctx) {
  console.log('[WineToken Plugin] Host plugin loaded inside DeepSeek Harness Cordis container.');

  // 1. 注入大模型创作工坊原生 Skill (AI 绘图与视频生成 Tool Calling)
  try {
    const { registerWineTokenTools } = require('./tool.js');
    registerWineTokenTools(ctx);
  } catch (err) {
    console.warn('[WineToken Plugin] 注册 Tools 失败:', err.message);
  }

  // 2. 读取 API Key
  const credentialsPath = join(homedir(), '.dsh', '.credentials.yaml');
  let apiKey = process.env.WINETOKEN_API_KEY || '';
  if (!apiKey && existsSync(credentialsPath)) {
    try {
      const credContent = readFileSync(credentialsPath, 'utf8');
      const m = credContent.match(/WINETOKEN_API_KEY:\s*([^\r\n#]+)/);
      if (m && m[1]) apiKey = m[1].trim();
    } catch (_) {}
  }

  if (!apiKey) {
    console.log('[WineToken Plugin] No API Key found, skipping startup model sync.');
    return;
  }

  // 延后 2 秒在后台静默检查模型 (优先对接 Manifest 热更新中枢，断网自动回退)
  setTimeout(async () => {
    try {
      const { syncWithHarness } = require('./sync.js');
      const fs = require('fs');

      // 1. 优先尝试拉取高精度 Manifest (包含精准 tags、上下文、视觉/推理标记与 Super 隔离)
      try {
        const mfRes = await fetch('https://www.winetoken.asia/api/subscription/models/manifest', {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout ? AbortSignal.timeout(6000) : undefined
        });
        if (mfRes.ok) {
          const mfData = await mfRes.json();
          if (mfData && mfData.ok && Array.isArray(mfData.chatModels) && mfData.chatModels.length > 0) {
            // 写入本地持久化缓存 ~/.dsh/storages/winetoken_manifest.json
            try {
              const storagesDir = join(homedir(), '.dsh', 'storages');
              if (!existsSync(storagesDir)) fs.mkdirSync(storagesDir, { recursive: true });
              fs.writeFileSync(join(storagesDir, 'winetoken_manifest.json'), JSON.stringify(mfData, null, 2), 'utf8');
            } catch (_) {}

            // 将 chatModels 映射为 DSH 标准 Provider 模型列表
            const models = mfData.chatModels.map(m => {
              const item = {
                id: m.id,
                name: m.name || m.id,
                contextWindow: m.contextWindow || 65536,
                maxTokens: m.maxTokens || 8192,
                input: m.vision ? ['text', 'image'] : ['text']
              };
              if (m.reasoning) {
                item.reasoningEfforts = { low: 'low', medium: 'medium', high: 'high', max: 'max' };
              }
              return item;
            });

            syncWithHarness(models, { quiet: true, apiKey });
            console.log(`[WineToken Plugin] Manifest dynamic sync: ${models.length} chat models active.`);
            return;
          }
        }
      } catch (mfErr) {
        // Manifest 接口若遇超时，平滑回退至 v1/models
      }

      // 2. 回退机制：通过 /v1/models 检查
      const res = await fetch('https://www.winetoken.asia/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` }
      });
      if (!res.ok) return;

      const data = await res.json();
      if (!data.data || !Array.isArray(data.data)) return;

      const { parseModels } = require('./parser.js');
      const models = parseModels(data.data);
      if (models && models.length > 0) {
        syncWithHarness(models, { quiet: true, apiKey });
        console.log(`[WineToken Plugin] Startup model verification: ${models.length} reasoning models active.`);
      }
    } catch (err) {
      console.warn('[WineToken Plugin] Background model check skipped:', err.message);
    }
  }, 2000);

  // 延后 5 秒在后台静默检查插件更新 (方案 A：完全无感自更新)
  setTimeout(() => {
    try {
      const { checkAndUpdate } = require('./updater.js');
      checkAndUpdate({ quiet: true });
    } catch (_) {}
  }, 5000);

  // 运行期间每 4 小时静默轮询一次更新
  setInterval(() => {
    try {
      const { checkAndUpdate } = require('./updater.js');
      checkAndUpdate({ quiet: true });
    } catch (_) {}
  }, 4 * 3600 * 1000);
}

module.exports = { name, inject, apply };
