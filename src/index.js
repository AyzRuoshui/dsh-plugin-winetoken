const { existsSync, readFileSync } = require('fs');
const { homedir } = require('os');
const { join } = require('path');

const { resolveApiKey } = require('./credentials.js');
const { syncWithHarness, ensureBaselineProviderInPatch } = require('./sync.js');

const name = 'dsh-plugin-winetoken';
const inject = ['tools', 'systemPrompt'];

/**
 * WineToken Harness Host Plugin (CommonJS)
 * 纯原生生命周期随 DSH 容器存亡，开机增量注入基线模型与 SWR 动态 Manifest 热拉取
 */
function apply(ctx) {
  console.log('[WineToken Plugin] Host plugin loaded inside DeepSeek Harness Cordis container.');

  // 1. 注入大模型创作工坊原生 Skill (AI 绘图与视频生成 Tool Calling)
  let unregTools = null;
  try {
    const { registerWineTokenTools } = require('./tool.js');
    unregTools = registerWineTokenTools(ctx);
  } catch (err) {
    console.warn('[WineToken Plugin] 注册 Tools 失败:', err.message);
  }

  // 资源与生命周期注销登记 (CORDIS-01, CORDIS-02)
  const timers = [];
  if (ctx && typeof ctx.on === 'function') {
    ctx.on('dispose', () => {
      console.log('[WineToken Plugin] Cordis 容器卸载/重载，执行资源与定时器安全注销');
      timers.forEach(t => clearTimeout(t));
      timers.length = 0;
      if (typeof unregTools === 'function') {
        unregTools();
      }
    });
  }

  // 2. 无论是否有 Key，开机无条件优先确保用户层 cordis.patch.yml 拥有基线模型 (解决 P0 覆盖问题)
  try {
    ensureBaselineProviderInPatch();
  } catch (baseErr) {
    console.warn('[WineToken Plugin] 开机注入基线模型异常:', baseErr.message);
  }

  // 2.5 凭据文件监视器：密钥出现/变更时自动触发模型同步 (必须在无 Key 提前返回之前安装)
  //     覆盖沙箱版桌面端经由官方 ctx.remote.credentials.set 通道写入的场景
  //     (该通道由 DSH 本地凭据 provider 落盘同一文件)，实现保存后模型列表真正自动同步
  try {
    const fsWatch = require('fs');
    const watchDir = join(homedir(), '.dsh');
    const initialKeyInfo = resolveApiKey({ autoAlias: true });
    let syncDebounce = null;
    let lastKnownKey = (initialKeyInfo && initialKeyInfo.apiKey) || '';

    const triggerResync = () => {
      if (syncDebounce) clearTimeout(syncDebounce);
      syncDebounce = setTimeout(async () => {
        try {
          const info = resolveApiKey({ autoAlias: true });
          const currentKey = (info && info.apiKey) || '';
          if (!currentKey || currentKey === lastKnownKey) return; // 幂等：无变化不同步
          lastKnownKey = currentKey;
          console.log('[WineToken Plugin] 检测到凭据更新 (Remote 通道或外部写入)，自动触发模型同步...');
          const { runSync } = require('./sync.js');
          await runSync({ forceNoKey: false });
        } catch (syncErr) {
          console.warn('[WineToken Plugin] 凭据变更后的自动同步失败:', syncErr && syncErr.message);
        }
      }, 1800);
    };

    if (existsSync(watchDir)) {
      // 监听目录而非文件本身：原子替换/重命名场景下文件级 watcher 会失效
      const credWatcher = fsWatch.watch(watchDir, { persistent: false }, (eventType, filename) => {
        if (filename && String(filename).indexOf('.credentials.yaml') !== -1) {
          triggerResync();
        }
      });
      credWatcher.on('error', () => {});
      if (ctx && typeof ctx.on === 'function') {
        ctx.on('dispose', () => {
          try { credWatcher.close(); } catch (_) {}
        });
      }
    }
  } catch (watchErr) {
    console.warn('[WineToken Plugin] 凭据监视器初始化失败 (不影响其他功能):', watchErr.message);
  }

  // 3. 统一凭据中枢解析 API Key (兼容 WINETOKEN_API_KEY 与 ZHAIZHU_API_KEY 别名)
  const keyInfo = resolveApiKey({ autoAlias: true });
  const apiKey = keyInfo.apiKey;

  if (!apiKey) {
    console.log('[WineToken Plugin] 未检测到 API Key，已保底注入 19 个离线基线模型。配置 WINETOKEN_API_KEY 或 ZHAIZHU_API_KEY 即可激活动态 Manifest 同步。');
    return;
  }

  console.log(`[WineToken Plugin] 成功识别凭据 (来源: ${keyInfo.keyName})，准备启动后台动态模型同步...`);

  // 延后 2 秒在后台静默检查模型 (优先对接 Manifest 热更新中枢，断网自动回退)
  const modelTimer = setTimeout(async () => {
    try {
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
  timers.push(modelTimer);

  // 延后 5 秒在后台安全核验官方版本 (仅提示升级，绝不静默覆盖代码，彻底消除 SEC-01 风险)
  const updateTimer = setTimeout(() => {
    try {
      const { checkAndUpdate } = require('./updater.js');
      checkAndUpdate({ quiet: true });
    } catch (_) {}
  }, 5000);
  timers.push(updateTimer);
}

module.exports = { name, inject, apply };
