// -*- coding: utf-8 -*-
/**
 * WineToken 统一凭据中枢 (Universal Credentials Resolver)
 * 解决跨进程、多别名 (WINETOKEN_API_KEY / ZHAIZHU_API_KEY) 及宿主设置命名空间分裂问题
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const DSH_HOME = path.join(process.env.USERPROFILE || process.env.HOME || os.homedir(), '.dsh');
const CREDENTIALS_FILE = path.join(DSH_HOME, '.credentials.yaml');
const CORDIS_PATCH_FILE = path.join(DSH_HOME, 'profiles', 'desktop', 'cordis.patch.yml');
const DEFAULT_BASE_URL = 'https://www.winetoken.asia/v1';

// 支持的凭据别名列表 (按优先级排序)
const KNOWN_KEY_ALIASES = [
  'WINETOKEN_API_KEY',
  'ZHAIZHU_API_KEY'
];

/**
 * 解析 .credentials.yaml 中的 refs 映射表 (容错解析，避免强依赖外部 YAML 库)
 */
function readCredentialsRefs() {
  const refs = {};
  if (!fs.existsSync(CREDENTIALS_FILE)) return refs;

  try {
    const content = fs.readFileSync(CREDENTIALS_FILE, 'utf8');
    // 匹配 refs 块下的所有键值对 (支持空格与缩进)
    const lines = content.split(/\r?\n/);
    let inRefs = false;
    for (const line of lines) {
      if (/^[ \t]*refs:\s*(?:$|#)/.test(line)) {
        inRefs = true;
        continue;
      }
      if (inRefs) {
        // 如果遇到顶层新键 (非缩进)，退出 refs 块
        if (/^[a-zA-Z0-9_\-]+:/.test(line)) {
          break;
        }
        const m = line.match(/^[ \t]+([a-zA-Z0-9_\-]+):\s*([^\r\n#]+)/);
        if (m) {
          const k = m[1].trim();
          const v = m[2].trim().replace(/^['"]|['"]$/g, '');
          refs[k] = v;
        }
      }
    }
  } catch (err) {
    console.warn('[WineToken Credentials] 读取 .credentials.yaml 异常:', err.message);
  }
  return refs;
}

/**
 * 从 cordis.patch.yml 中解析可能包含的 WineToken / Zhaizhu 相关 provider 的配置
 */
function inspectProvidersFromPatch() {
  const results = {
    apiKeyEnvs: [],
    baseURL: null
  };
  if (!fs.existsSync(CORDIS_PATCH_FILE)) return results;

  try {
    const content = fs.readFileSync(CORDIS_PATCH_FILE, 'utf8');
    // 查找 winetoken 或 zhaizhu 的 provider 块
    const lines = content.split(/\r?\n/);
    let inTargetProvider = false;
    let providerIndent = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const matchProvider = line.match(/^([ \t]+)(winetoken|zhaizhu):\s*$/i);
      if (matchProvider) {
        inTargetProvider = true;
        providerIndent = matchProvider[1].length;
        continue;
      }

      if (inTargetProvider) {
        const currentIndent = (line.match(/^[ \t]*/) || [''])[0].length;
        // 如果缩进回退，说明退出了当前 provider 块
        if (line.trim().length > 0 && currentIndent <= providerIndent) {
          inTargetProvider = false;
          continue;
        }

        const matchEnv = line.match(/^[ \t]+apiKeyEnv:\s*([^\r\n#]+)/);
        if (matchEnv) {
          const envName = matchEnv[1].trim().replace(/^['"]|['"]$/g, '');
          if (envName && !results.apiKeyEnvs.includes(envName)) {
            results.apiKeyEnvs.push(envName);
          }
        }

        const matchBase = line.match(/^[ \t]+baseURL:\s*([^\r\n#]+)/);
        if (matchBase && !results.baseURL) {
          results.baseURL = matchBase[1].trim().replace(/^['"]|['"]$/g, '').replace(/\/+$/, '');
        }
      }
    }
  } catch (err) {
    console.warn('[WineToken Credentials] 解析 cordis.patch.yml providers 异常:', err.message);
  }
  return results;
}

/**
 * 统一解析有效的 API Key
 * 按优先级探测：环境变量 -> credentials.yaml (WINETOKEN_API_KEY / ZHAIZHU_API_KEY) -> patch 动态 provider -> 自动补齐别名
 */
function resolveApiKey(options = {}) {
  const refs = readCredentialsRefs();
  const patchInfo = inspectProvidersFromPatch();

  // 合并搜索候选列表，优先官方标准名，随后是别名与从 patch 动态探测的键名
  const candidateNames = Array.from(new Set([
    ...KNOWN_KEY_ALIASES,
    ...patchInfo.apiKeyEnvs
  ]));

  let foundKey = '';
  let matchedName = '';

  // 1. 优先检查环境变量
  for (const name of candidateNames) {
    if (process.env[name] && process.env[name].trim()) {
      foundKey = process.env[name].trim();
      matchedName = name;
      break;
    }
  }

  // 2. 检查 .credentials.yaml 的 refs
  if (!foundKey) {
    for (const name of candidateNames) {
      if (refs[name] && refs[name].trim()) {
        foundKey = refs[name].trim();
        matchedName = name;
        break;
      }
    }
  }

  // 3. 如果找到了有效的 Key，但 .credentials.yaml 中缺少 WINETOKEN_API_KEY 官方键名，
  // 自动双写补齐别名，消除未来所有工具链路的分裂隐患
  if (foundKey && !refs['WINETOKEN_API_KEY'] && options.autoAlias !== false) {
    try {
      saveCredentialsRef('WINETOKEN_API_KEY', foundKey);
      console.log(`[WineToken Credentials] 已基于 ${matchedName} 自动在 credentials.yaml 中补齐同值别名 WINETOKEN_API_KEY`);
    } catch (_) {}
  }

  return {
    apiKey: foundKey,
    keyName: matchedName,
    hasKey: Boolean(foundKey)
  };
}

/**
 * 安全向 ~/.dsh/.credentials.yaml 写入或更新一个 ref 键值 (零外部依赖，严格保护原文件结构与权限)
 */
function saveCredentialsRef(envKeyName, keyValue) {
  if (!fs.existsSync(DSH_HOME)) {
    fs.mkdirSync(DSH_HOME, { recursive: true });
  }

  const trimmed = (keyValue || '').trim();
  if (!trimmed) return false;

  // 放宽校验范围，仅杜绝换行符注入，支持常见 Base64/Token 字符
  if (/[\r\n]/.test(trimmed) || trimmed.length < 8) {
    throw new Error('API Key 格式非法 (包含换行符或长度不足)');
  }

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
  return true;
}

/**
 * 保存 API Key 并同步多处与验证
 */
function saveApiKey(newKey) {
  const trimmed = (newKey || '').trim();
  if (!trimmed) {
    return { success: false, error: 'API Key 不能为空' };
  }

  try {
    // 1. 同步设置当前进程环境变量
    process.env.WINETOKEN_API_KEY = trimmed;

    // 2. 检查原有是否已有 ZHAIZHU_API_KEY，如有则双向同步，否则至少写 WINETOKEN_API_KEY
    const refs = readCredentialsRefs();
    saveCredentialsRef('WINETOKEN_API_KEY', trimmed);
    if (refs['ZHAIZHU_API_KEY']) {
      saveCredentialsRef('ZHAIZHU_API_KEY', trimmed);
    }

    // 3. 落盘回读校验 (物理核验落盘真实性，杜绝静默失败)
    const verifyRefs = readCredentialsRefs();
    if (verifyRefs['WINETOKEN_API_KEY'] !== trimmed) {
      return { success: false, error: '凭据写入回读校验不匹配' };
    }

    // 4. 同步更新内存环境变量 (绝对严禁回写源码目录 config.json，坚守开源脱敏红线)
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * 获取精准的 Base URL (优先探测目标 provider，保底默认网关)
 */
function getResolvedBaseUrl() {
  const patchInfo = inspectProvidersFromPatch();
  if (patchInfo.baseURL) {
    return patchInfo.baseURL;
  }
  return DEFAULT_BASE_URL;
}

module.exports = {
  DSH_HOME,
  CREDENTIALS_FILE,
  CORDIS_PATCH_FILE,
  DEFAULT_BASE_URL,
  KNOWN_KEY_ALIASES,
  readCredentialsRefs,
  inspectProvidersFromPatch,
  resolveApiKey,
  saveApiKey,
  saveCredentialsRef,
  getResolvedBaseUrl
};
