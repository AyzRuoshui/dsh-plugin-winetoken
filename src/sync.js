// -*- coding: utf-8 -*-
/**
 * WineToken 自动模型同步引擎 (DeepSeek Harness 专属插件)
 * 支持一次性填写 API Key、开机自启更新、纯原生零破坏增量合并
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');

const {
  DSH_HOME,
  CREDENTIALS_FILE,
  CORDIS_PATCH_FILE,
  DEFAULT_BASE_URL,
  resolveApiKey,
  saveApiKey,
  saveCredentialsRef
} = require('./credentials.js');

const {
  mergeProviderIntoPatchContent,
  cleanWineTokenFromPatchContent,
  inspectPatchState,
  getBaselineModels,
  sanitizeModelDisplayName
} = require('./patch-engine.js');

const BASE_DIR = __dirname;
const CONFIG_PATH = path.join(BASE_DIR, 'config.json');

const { parseModelList } = require('./parser');

const EFFORT_KEYS = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'];

// 服务器 Manifest 下发的档位是第一数据源：只保留合法档位键与字符串值，非法/缺失返回 null 走本地兜底
function sanitizeServerEfforts(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  for (const k of EFFORT_KEYS) {
    if (typeof raw[k] === 'string' && raw[k]) out[k] = raw[k];
  }
  return Object.keys(out).length ? out : null;
}

function buildManifestModels(chatModels) {
  return (Array.isArray(chatModels) ? chatModels : [])
    .filter(m => m && typeof m.id === 'string' && m.enabled !== false)
    .map(m => {
      const item = {
        id: m.id,
        name: sanitizeModelDisplayName(m.name, m.id),
        contextWindow: m.contextWindow || 131072,
        maxTokens: m.maxTokens || 16384,
        input: m.vision ? ['text', 'image'] : ['text']
      };
      const serverEfforts = sanitizeServerEfforts(m.reasoningEfforts);
      if (serverEfforts) {
        item.reasoningEfforts = serverEfforts;
      } else if (m.reasoning) {
        // 旧版服务器/本地缓存无档位字段时的兜底：deepseek 家族四档 (含 max)，其余三档
        item.reasoningEfforts = m.id.includes('deepseek')
          ? { low: 'low', medium: 'medium', high: 'high', max: 'max' }
          : { low: 'low', medium: 'medium', high: 'high' };
      }
      return item;
    });
}

function resolveLlmPiAiEntry(ctx) {
  const editor = ctx && typeof ctx.get === 'function' ? ctx.get('configEditor') : null;
  if (!editor || typeof editor.entries !== 'function') return null;
  return editor.entries().find(entry => entry && entry.options && entry.options.id === 'llm-pi-ai') || null;
}

async function applyProviderModelsWithConfigEditor(ctx, models) {
  if (!ctx || typeof ctx.get !== 'function') return false;
  const editor = ctx.get('configEditor');
  const entry = resolveLlmPiAiEntry(ctx);
  if (!editor || typeof editor.edit !== 'function' || !entry || !entry.fiber) return false;

  const sanitizedModels = Array.isArray(models)
    ? models.map(m => (m && typeof m === 'object' ? { ...m, name: sanitizeModelDisplayName(m.name, m.id) } : m))
    : models;

  await editor.edit(entry, (current) => {
    const providers = { ...(current.providers || {}) };
    const existing = providers.winetoken || {};
    providers.winetoken = {
      ...existing,
      displayName: 'WineToken (全平台推理模型)',
      api: 'openai-completions',
      baseURL: DEFAULT_BASE_URL,
      apiKeyEnv: 'WINETOKEN_API_KEY',
      defaultContextWindow: 1000000,
      defaultMaxTokens: 128000,
      models: sanitizedModels
    };
    return { ...current, providers };
  });
  return true;
}

/**
 * 原生请求 WineToken 网关模型列表
 */
function fetchModels(baseUrl, apiKey) {
  return new Promise((resolve, reject) => {
    const url = baseUrl.endsWith('/') ? baseUrl + 'models' : baseUrl + '/models';
    const client = url.startsWith('https:') ? https : http;
    const req = client.get(url, {
      headers: {
        'Authorization': 'Bearer ' + apiKey.trim(),
        'User-Agent': 'WineToken-DSH-Plugin/2.1.8',
        'Accept': 'application/json'
      },
      timeout: 10000
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (json && json.data && Array.isArray(json.data)) {
            resolve(json.data);
          } else if (Array.isArray(json)) {
            resolve(json);
          } else {
            reject(new Error('网关返回数据异常: ' + body.slice(0, 100)));
          }
        } catch (e) {
          reject(new Error('解析网关模型列表失败: ' + e.message));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('请求网关模型超时'));
    });
  });
}

/**
 * 读取或初始化插件配置 (支持从凭据文件与环境变量自动反查兜底)
 */
function loadConfig() {
  let cfg = {
    apiKey: '',
    baseUrl: DEFAULT_BASE_URL,
    providerId: 'winetoken',
    providerDisplayName: 'WineToken (全平台推理模型)',
    syncIntervalMinutes: 1,
    filterNonChatModels: true
  };

  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const saved = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      cfg = { ...cfg, ...saved };
    } catch (e) {
      console.warn('警告: 读取 config.json 失败，使用默认配置:', e.message);
    }
  }

  // 支持命令行参数覆盖: --key sk-xxx, --url https://...
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--key' && args[i + 1]) {
      cfg.apiKey = args[i + 1];
      i++;
    } else if (args[i] === '--url' && args[i + 1]) {
      cfg.baseUrl = args[i + 1];
      i++;
    }
  }

  // 凭据反查兜底：若 config.json 中 apiKey 为空，自动从环境变量与 ~/.dsh/.credentials.yaml 探测
  if (!cfg.apiKey || !cfg.apiKey.trim()) {
    const resolved = resolveApiKey({ autoAlias: true });
    if (resolved && resolved.hasKey) {
      cfg.apiKey = resolved.apiKey;
    }
  }

  return cfg;
}

/**
 * 解析定时同步轮询间隔 (分钟)
 * 优先级: syncIntervalMinutes > 兼容旧 syncIntervalHours > 默认 5 分钟; 最小 1 分钟
 */
function resolveSyncIntervalMinutes(cfg) {
  const source = cfg || {};
  const minutes = Number(source.syncIntervalMinutes);
  if (Number.isFinite(minutes) && minutes > 0) {
    return Math.max(1, Math.floor(minutes));
  }
  const legacyHours = Number(source.syncIntervalHours);
  if (Number.isFinite(legacyHours) && legacyHours > 0) {
    return Math.max(1, Math.round(legacyHours * 60));
  }
  return 1;
}

/**
 * 保存配置回文件 (严格对 apiKey 实施脱敏置空，坚守开源代码仓库安全红线)
 */
function saveConfig(cfg) {
  try {
    const safeConfig = { ...cfg, apiKey: '' };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(safeConfig, null, 2), 'utf-8');
  } catch (e) {
    console.error('保存 config.json 失败:', e.message);
  }
}

/**
 * 更新 ~/.dsh/.credentials.yaml (复用 credentials 中枢安全实现)
 */
function updateCredentials(apiKey, envKeyName = 'WINETOKEN_API_KEY') {
  return saveCredentialsRef(envKeyName, apiKey);
}

function writeFileAtomic(targetPath, content) {
  const dir = path.dirname(targetPath);
  const tmpPath = path.join(dir, `.${path.basename(targetPath)}.tmp.${process.pid}.${Date.now()}`);
  try {
    fs.writeFileSync(tmpPath, content, 'utf-8');
    fs.renameSync(tmpPath, targetPath);
  } catch (_) {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch (_ignored) {}
    fs.writeFileSync(targetPath, content, 'utf-8');
  }
}

/**
 * 更新 ~/.dsh/profiles/desktop/cordis.patch.yml
 * 采用原生 PatchEngine 实施增量合并，100% 保护用户现有 provider (如 zhaizhu) 与已有注释
 */
function updateCordisPatch(providerConfig, options = {}) {
  const targetPatchFile = (options && options.patchFile) || CORDIS_PATCH_FILE;
  const desktopProfileDir = path.dirname(targetPatchFile);
  if (!fs.existsSync(desktopProfileDir)) {
    fs.mkdirSync(desktopProfileDir, { recursive: true });
  }

  let originalContent = '';
  let hasExistingFile = false;
  if (fs.existsSync(targetPatchFile)) {
    try {
      originalContent = fs.readFileSync(targetPatchFile, 'utf-8');
      hasExistingFile = true;
    } catch (e) {
      console.warn('读取 cordis.patch.yml 失败:', e.message);
    }
  }

  const targetConfig = {
    id: providerConfig.id || 'winetoken',
    displayName: providerConfig.displayName || 'WineToken (全平台推理模型)',
    api: 'openai-completions',
    baseURL: providerConfig.baseURL || DEFAULT_BASE_URL,
    apiKeyEnv: providerConfig.apiKeyEnv || 'WINETOKEN_API_KEY',
    defaultContextWindow: providerConfig.defaultContextWindow || 1000000,
    defaultMaxTokens: providerConfig.defaultMaxTokens || 128000,
    models: providerConfig.models || []
  };

  const newContent = mergeProviderIntoPatchContent(originalContent, targetConfig);

  // 严格幂等性检查：若无文本改动，绝对不重新写盘
  if (newContent === originalContent) {
    console.log(`[模型同步] Provider [${targetConfig.id}] 模型与配置未变更，保持只读跳过写盘 (保护 YAML 用户注释)。`);
    return true;
  }

  // 覆写已存在且内容实际发生变更的 cordis.patch.yml 前，仅在 .bak 不存在时写入一次性备份
  const backupFile = `${targetPatchFile}.bak`;
  if (hasExistingFile && !fs.existsSync(backupFile)) {
    try {
      fs.accessSync(desktopProfileDir, fs.constants.W_OK);
      fs.writeFileSync(backupFile, originalContent, 'utf-8');
      console.log(`[模型同步] 已创建一次性原始备份: ${backupFile}`);
    } catch (bakErr) {
      console.warn(`[模型同步] 创建备份失败 (${backupFile}):`, bakErr.message);
    }
  }

  writeFileAtomic(targetPatchFile, newContent);
  console.log(`[模型注入] 已成功增量注入/更新 Provider [${targetConfig.id}] (共 ${targetConfig.models.length} 个模型) 到 cordis.patch.yml`);
  return true;
}

/**
 * 确保用户层 cordis.patch.yml 中包含基线静态模型 (结构完整性判定 + 脏残留自愈)
 */
function ensureBaselineProviderInPatch(options = {}) {
  try {
    const targetPatchFile = (options && options.patchFile) || CORDIS_PATCH_FILE;
    let originalContent = '';
    if (fs.existsSync(targetPatchFile)) {
      originalContent = fs.readFileSync(targetPatchFile, 'utf-8');
    }

    // 仅当结构完整、单一且无重复/游离注释/空骨架时跳过，避免覆盖动态同步后的在线模型清单
    if (originalContent) {
      const state = inspectPatchState(originalContent);
      if (state.isCleanSingleWineToken) {
        return true;
      }
    }

    const baselineModels = getBaselineModels();
    updateCordisPatch({
      id: 'winetoken',
      displayName: 'WineToken (全平台推理模型)',
      baseURL: DEFAULT_BASE_URL,
      apiKeyEnv: 'WINETOKEN_API_KEY',
      models: baselineModels
    }, { patchFile: targetPatchFile });
    return true;
  } catch (err) {
    console.warn('[WineToken Sync] 注入基线模型异常:', err.message);
    return false;
  }
}

/**
 * 从 cordis.patch.yml 安全清除所有 WineToken 注入段与游离注释（幂等、无变更不备份不写盘）
 */
function cleanupCordisPatchFile(options = {}) {
  const patchFile = (options && options.patchFile) || CORDIS_PATCH_FILE;
  const dryRun = Boolean(options && options.dryRun);
  const backup = !options || options.backup !== false;

  if (!fs.existsSync(patchFile)) {
    return {
      exists: false,
      changed: false,
      status: 'already_clean',
      dryRun,
      patchFile,
      backupFile: null,
      stats: null
    };
  }

  const originalContent = fs.readFileSync(patchFile, 'utf-8');
  const cleanResult = cleanWineTokenFromPatchContent(originalContent);

  if (!cleanResult.changed) {
    return {
      exists: true,
      changed: false,
      status: 'already_clean',
      dryRun,
      patchFile,
      backupFile: null,
      stats: cleanResult.stats,
      content: cleanResult.content
    };
  }

  if (dryRun) {
    return {
      exists: true,
      changed: true,
      status: 'cleaned',
      dryRun: true,
      patchFile,
      backupFile: null,
      stats: cleanResult.stats,
      content: cleanResult.content
    };
  }

  let createdBackup = null;
  const backupFile = `${patchFile}.bak`;
  if (backup && !fs.existsSync(backupFile)) {
    try {
      fs.accessSync(path.dirname(patchFile), fs.constants.W_OK);
      fs.writeFileSync(backupFile, originalContent, 'utf-8');
      createdBackup = backupFile;
    } catch (bakErr) {
      console.warn(`[WineToken Cleanup] 创建备份失败 (${backupFile}):`, bakErr.message);
    }
  }

  writeFileAtomic(patchFile, cleanResult.content);
  const s = cleanResult.stats;
  console.log(
    `[WineToken Cleanup] 已清理 ${patchFile} (managed=${s.managedBlocksRemoved}, comments=${s.commentsRemoved}, pluginEntries=${s.pluginEntriesRemoved}, providers=${s.providersRemoved}, emptyLlmEntries=${s.emptyLlmEntriesRemoved})`
  );

  return {
    exists: true,
    changed: true,
    status: 'cleaned',
    dryRun: false,
    patchFile,
    backupFile: createdBackup,
    stats: cleanResult.stats,
    content: cleanResult.content
  };
}

/**
 * 主执行流程
 */
async function runSync(options = {}) {
  console.log('='.repeat(60));
  console.log(`[WineToken 同步引擎] 任务触发时间: ${new Date().toLocaleString()}`);

  const cfg = loadConfig();
  if (options && options.forceNoKey) {
    cfg.apiKey = '';
  }
  if (!cfg.apiKey || !cfg.apiKey.trim()) {
    console.warn('[WineToken Sync] 未检测到 API Key，先确保注入基线静态模型...');
    ensureBaselineProviderInPatch();
    console.warn('[WineToken Sync] 未配置 apiKey，已安全跳过在线同步流程 (杜绝误杀宿主进程 ARCH-03)');
    return { success: false, reason: 'MISSING_API_KEY' };
  }

  // 保存最新的参数
  saveConfig(cfg);

  try {
    console.log(`[网络连接] 正在请求 WineToken 网关: ${cfg.baseUrl}...`);
    const rawModels = await fetchModels(cfg.baseUrl, cfg.apiKey);
    console.log(`[网络响应] 网关返回模型原始条目: ${rawModels.length} 个`);

    // 解析与规格推断
    const parsedModels = parseModelList(rawModels, cfg.filterNonChatModels);
    console.log(`[规格推断] 成功解析可对话推理模型: ${parsedModels.length} 个 (过滤非对话模型: ${rawModels.length - parsedModels.length} 个)`);

    // 统计推理与多模态
    const reasoningCount = parsedModels.filter(m => !!m.reasoningEfforts).length;
    const visionCount = parsedModels.filter(m => Array.isArray(m.input) && m.input.includes('image')).length;
    console.log(`[能力统计] 推理/思维链模型: ${reasoningCount} 个 | 多模态视觉模型: ${visionCount} 个`);

    // 1. 更新凭据文件
    const envKeyName = 'WINETOKEN_API_KEY';
    updateCredentials(cfg.apiKey, envKeyName);

    // 2. 增量更新 cordis.patch.yml
    updateCordisPatch({
      id: cfg.providerId || 'winetoken',
      displayName: cfg.providerDisplayName || 'WineToken 聚合平台',
      baseURL: cfg.baseUrl,
      apiKeyEnv: envKeyName,
      models: parsedModels
    });

    console.log('='.repeat(60));
    console.log('[OK] [同步成功] 模型已全部自动映射并生效！DeepSeek Harness HMR 机制将实时刷新界面。');
    return true;
  } catch (err) {
    console.error('[WARN] [同步失败]:', err.message);
    return false;
  }
}

/**
 * 供插件生命周期或外部模块直接调用的注入接口
 */
function syncWithHarness(parsedModels, options = {}) {
  const cfg = loadConfig();
  const envKeyName = 'WINETOKEN_API_KEY';
  if (options.apiKey) {
    updateCredentials(options.apiKey, envKeyName);
  }
  const providerConfig = {
    id: cfg.providerId || 'winetoken',
    displayName: cfg.providerDisplayName || 'WineToken 聚合平台',
    baseURL: cfg.baseUrl || DEFAULT_BASE_URL,
    apiKeyEnv: envKeyName,
    models: parsedModels
  };

  if (options.ctx) {
    applyProviderModelsWithConfigEditor(options.ctx, parsedModels)
      .then(used => {
        if (!used) updateCordisPatch(providerConfig);
      })
      .catch(err => {
        console.warn('[WineToken Sync] configEditor 写入失败，回退增量补丁:', err.message);
        updateCordisPatch(providerConfig);
      });
    return true;
  }

  updateCordisPatch(providerConfig);
  return true;
}

// 如果直接运行该脚本
if (require.main === module) {
  runSync();
}

module.exports = {
  buildManifestModels,
  runSync,
  syncWithHarness,
  updateCordisPatch,
  ensureBaselineProviderInPatch,
  cleanupCordisPatchFile,
  loadConfig,
  resolveSyncIntervalMinutes
};
