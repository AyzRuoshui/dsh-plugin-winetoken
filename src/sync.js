// -*- coding: utf-8 -*-
/**
 * WineToken 自动模型同步引擎 (DeepSeek Harness 专属插件)
 * 支持一次性填写 API Key、开机自启更新、每小时定时轮询
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');

// DeepSeek Harness 用户配置主路径 (提升至最顶层声明，彻底消除 TDZ 暂存死区崩溃风险)
const DSH_HOME = path.join(process.env.USERPROFILE || process.env.HOME || os.homedir(), '.dsh');
const CREDENTIALS_FILE = path.join(DSH_HOME, '.credentials.yaml');
const CORDIS_PATCH_FILE = path.join(DSH_HOME, 'profiles', 'desktop', 'cordis.patch.yml');
const BASE_DIR = __dirname;
const CONFIG_PATH = path.join(BASE_DIR, 'config.json');

let YAML = null;
try {
  YAML = require('yaml');
} catch (_) {
  try {
    const yamlFallback = path.join(DSH_HOME, 'plugins', 'winetoken-sync', 'node_modules', 'yaml');
    if (fs.existsSync(yamlFallback)) {
      YAML = require(yamlFallback);
    }
  } catch (_) {}
}
const { parseModelList } = require('./parser');

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
        'User-Agent': 'WineToken-DSH-Plugin/1.3.0',
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
 * 读取或初始化插件配置
 */
function loadConfig() {
  let cfg = {
    apiKey: '',
    baseUrl: 'https://www.winetoken.asia/v1',
    providerId: 'winetoken',
    providerDisplayName: 'WineToken 聚合平台 (全推理)',
    syncIntervalHours: 1,
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

  return cfg;
}

/**
 * 保存配置回文件
 */
function saveConfig(cfg) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf-8');
  } catch (e) {
    console.error('保存 config.json 失败:', e.message);
  }
}

/**
 * 更新 ~/.dsh/.credentials.yaml
 */
function updateCredentials(apiKey, envKeyName = 'WINETOKEN_API_KEY') {
  if (!fs.existsSync(DSH_HOME)) {
    fs.mkdirSync(DSH_HOME, { recursive: true });
  }

  const trimmed = (apiKey || '').trim();
  if (!trimmed) return;

  // 凭据格式强校验，彻底阻断换行符注入 YAML 隐患 (SEC-05)
  if (!/^[a-zA-Z0-9_\-\.]{10,128}$/.test(trimmed)) {
    console.warn('[WineToken Sync] API Key 格式非法，拒绝写入凭据');
    return false;
  }

  if (YAML) {
    try {
      let credsDoc = { version: 1, refs: {}, records: {} };
      if (fs.existsSync(CREDENTIALS_FILE)) {
        const content = fs.readFileSync(CREDENTIALS_FILE, 'utf-8');
        const parsed = YAML.parse(content);
        if (parsed && typeof parsed === 'object') {
          credsDoc = parsed;
          if (!credsDoc.refs) credsDoc.refs = {};
        }
      }
      credsDoc.refs[envKeyName] = trimmed;
      const newYaml = YAML.stringify(credsDoc, { indent: 2 });
      fs.writeFileSync(CREDENTIALS_FILE, newYaml, { encoding: 'utf-8', mode: 0o600 });
      console.log(`[凭证更新] 已成功注入 ${envKeyName} 到 ~/.dsh/.credentials.yaml`);
      return;
    } catch (e) {
      console.warn('YAML 解析凭证失败，回退至原生安全正则写入:', e.message);
    }
  }

  // 原生安全正则写入兜底 (零外部依赖，100% 防崩溃)
  try {
    let content = fs.existsSync(CREDENTIALS_FILE) ? fs.readFileSync(CREDENTIALS_FILE, 'utf8') : '';
    if (!content || !content.trim()) {
      content = `version: 1\nrecords: {}\nrefs:\n  ${envKeyName}: ${trimmed}\n`;
    } else {
      const keyRegex = new RegExp(`(^|\\n)([ \\t]*${envKeyName}:\\s*)([^\\r\\n#]*)`, 'm');
      const emptyRefsRegex = /(^|\n)([ \t]*refs:\s*\{\s*\})/m;
      const refsBlockRegex = /(^|\n)([ \t]*refs:\s*(?:\r?\n|$))/m;

      if (keyRegex.test(content)) {
        content = content.replace(keyRegex, `$1  ${envKeyName}: ${trimmed}`);
      } else if (emptyRefsRegex.test(content)) {
        content = content.replace(emptyRefsRegex, `$1refs:\n  ${envKeyName}: ${trimmed}`);
      } else if (refsBlockRegex.test(content)) {
        content = content.replace(refsBlockRegex, `$1refs:\n  ${envKeyName}: ${trimmed}\n`);
      } else {
        content = content.trimEnd() + `\nrefs:\n  ${envKeyName}: ${trimmed}\n`;
      }
    }
    fs.writeFileSync(CREDENTIALS_FILE, content, { encoding: 'utf8', mode: 0o600 });
    console.log(`[凭证更新] 原生引擎已注入 ${envKeyName} 到 ~/.dsh/.credentials.yaml`);
  } catch (e) {
    console.warn('[WineToken] 写入 .credentials.yaml 失败:', e.message);
  }
}

/**
 * 更新 ~/.dsh/profiles/desktop/cordis.patch.yml
 */
function updateCordisPatch(providerConfig) {
  // YAML 模块空指针安全守卫 (ARCH-02)
  if (!YAML || typeof YAML.parse !== 'function' || typeof YAML.stringify !== 'function') {
    console.warn('[WineToken Sync] yaml 模块不可用，跳过补丁写盘');
    return false;
  }

  const desktopProfileDir = path.dirname(CORDIS_PATCH_FILE);
  if (!fs.existsSync(desktopProfileDir)) {
    fs.mkdirSync(desktopProfileDir, { recursive: true });
  }

  let patches = [];

  if (fs.existsSync(CORDIS_PATCH_FILE)) {
    try {
      const content = fs.readFileSync(CORDIS_PATCH_FILE, 'utf-8');
      const parsed = YAML.parse(content);
      if (Array.isArray(parsed)) {
        patches = parsed;
      }
    } catch (e) {
      console.warn('读取 cordis.patch.yml 失败，将新建补丁列表:', e.message);
    }
  }

  // 查找或新建 llm-pi-ai 补丁项
  let llmPatch = patches.find(p => p && p.id === 'llm-pi-ai');
  if (!llmPatch) {
    llmPatch = {
      id: 'llm-pi-ai',
      name: '@deepseek-ai/dsh-llm-pi-ai',
      config: {
        providers: {}
      }
    };
    patches.push(llmPatch);
  }

  if (!llmPatch.config) llmPatch.config = {};
  if (!llmPatch.config.providers) llmPatch.config.providers = {};

  const targetProvider = {
    displayName: providerConfig.displayName,
    api: 'openai-completions',
    baseURL: providerConfig.baseURL,
    apiKeyEnv: providerConfig.apiKeyEnv,
    defaultContextWindow: 262144,
    defaultMaxTokens: 65536,
    models: providerConfig.models
  };

  const currentProvider = llmPatch.config.providers[providerConfig.id];

  // 严格幂等性检查：如果配置与模型列表完全一致，绝对不重新序列化写盘，100% 保护用户自定义注释
  if (currentProvider && JSON.stringify(currentProvider) === JSON.stringify(targetProvider)) {
    console.log(`[模型同步] Provider [${providerConfig.id}] 模型与配置未变更，保持只读跳过写盘 (保护 YAML 用户注释)。`);
    return;
  }

  // 将我们的 Provider 注入
  llmPatch.config.providers[providerConfig.id] = targetProvider;

  // 写回 cordis.patch.yml
  const newYaml = YAML.stringify(patches, { indent: 2 });
  fs.writeFileSync(CORDIS_PATCH_FILE, newYaml, 'utf-8');
  console.log(`[模型注入] 已成功注入/更新 Provider [${providerConfig.id}] (共 ${providerConfig.models.length} 个模型) 到 cordis.patch.yml`);
}

/**
 * 主执行流程
 */
async function runSync() {
  console.log('='.repeat(60));
  console.log(`[WineToken 同步引擎] 任务触发时间: ${new Date().toLocaleString()}`);

  const cfg = loadConfig();
  if (!cfg.apiKey || !cfg.apiKey.trim()) {
    console.warn('[WineToken Sync] 未配置 apiKey，已安全跳过同步流程 (杜绝误杀宿主进程 ARCH-03)');
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

    // 2. 更新 cordis.patch.yml
    updateCordisPatch({
      id: cfg.providerId || 'winetoken',
      displayName: cfg.providerDisplayName || 'WineToken 聚合平台',
      baseURL: cfg.baseUrl,
      apiKeyEnv: envKeyName,
      models: parsedModels
    });

    console.log('='.repeat(60));
    console.log('✅ [同步成功] 模型已全部自动映射并生效！DeepSeek Harness HMR 机制将实时刷新界面。');
    return true;
  } catch (err) {
    console.error('❌ [同步失败]:', err.message);
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
  updateCordisPatch({
    id: cfg.providerId || 'winetoken',
    displayName: cfg.providerDisplayName || 'WineToken 聚合平台',
    baseURL: cfg.baseUrl || 'https://www.winetoken.asia/v1',
    apiKeyEnv: envKeyName,
    models: parsedModels
  });
  return true;
}

// 如果直接运行该脚本
if (require.main === module) {
  runSync();
}

module.exports = {
  runSync,
  syncWithHarness
};
