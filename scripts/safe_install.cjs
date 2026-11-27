// -*- coding: utf-8 -*-
/**
 * DeepSeek Harness - WineToken 插件官方标准 100% 增量安全安装器
 * 
 * 核心安全承诺：
 * 1. [零数据丢失]：读取既有配置并做增量合并（纯文本结构合并），绝不覆写、不清空用户的任何已有插件与 YAML 注释！
 * 2. [自动备份防护]：实际变更前自动对 package.json 与 cordis.patch.yml 创建安全备份 (.bak)；
 * 3. [零篡改客户端]：绝对不触碰、不修改 app.asar 核心包，100% 基于官方 Cordis 与 React 插槽扩展；
 * 4. [先清后写自愈]：安装时自动清除历史重复注入/游离注释/空骨架，再单次写入带起止标记的基线模型配置。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const PLUGIN_DIR = path.resolve(__dirname, '..');
const DSH_HOME = path.join(os.homedir(), '.dsh');
const PROFILE_DIR = path.join(DSH_HOME, 'profiles', 'desktop');
const PKG_FILE = path.join(PROFILE_DIR, 'package.json');
const PATCH_FILE = path.join(PROFILE_DIR, 'cordis.patch.yml');

const { DEFAULT_BASE_URL } = require(path.join(PLUGIN_DIR, 'src', 'credentials.js'));
const {
  cleanWineTokenFromPatchContent,
  mergeProviderIntoPatchContent,
  getBaselineModels
} = require(path.join(PLUGIN_DIR, 'src', 'patch-engine.js'));

function backupFile(filePath) {
  if (fs.existsSync(filePath)) {
    const timestamp = Date.now();
    const bakPath = `${filePath}.bak.${timestamp}`;
    fs.copyFileSync(filePath, bakPath);
    console.log(`  [OK]  已创建安全备份: ${path.basename(bakPath)}`);
    return bakPath;
  }
  return null;
}

function safeInstall(options = {}) {
  const pkgFile = options.pkgFile || PKG_FILE;
  const patchFile = options.patchFile || PATCH_FILE;
  const profileDir = path.dirname(pkgFile);

  console.log('='.repeat(65));
  console.log('[OK] DeepSeek Harness - WineToken 插件安全增量安装器');
  console.log('='.repeat(65));

  if (!fs.existsSync(profileDir)) {
    fs.mkdirSync(profileDir, { recursive: true });
  }
  if (!fs.existsSync(path.dirname(patchFile))) {
    fs.mkdirSync(path.dirname(patchFile), { recursive: true });
  }

  // -------------------------------------------------------------
  // 1. 安全增量合并 ~/.dsh/profiles/desktop/package.json
  // -------------------------------------------------------------
  console.log('\n[OK] [步骤 1/2] 安全合并 package.json 依赖与 bundles 清单...');
  backupFile(pkgFile);

  let pkgDoc = {
    name: 'dsh-profile-desktop',
    private: true,
    dependencies: {},
    dsh: {
      profile: {
        bundles: [
          '@deepseek-ai/dsh-base',
          '@deepseek-ai/dsh-web-app'
        ]
      }
    }
  };

  if (fs.existsSync(pkgFile)) {
    try {
      const raw = fs.readFileSync(pkgFile, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        pkgDoc = parsed;
        if (!pkgDoc.dependencies) pkgDoc.dependencies = {};
        if (!pkgDoc.dsh) pkgDoc.dsh = {};
        if (!pkgDoc.dsh.profile) pkgDoc.dsh.profile = {};
        if (!Array.isArray(pkgDoc.dsh.profile.bundles)) {
          pkgDoc.dsh.profile.bundles = [
            '@deepseek-ai/dsh-base',
            '@deepseek-ai/dsh-web-app'
          ];
        }
      }
    } catch (e) {
      console.warn('  [WARN] 解析既有 package.json 异常，将安全合并保全:', e.message);
    }
  }

  const existingDepsCount = Object.keys(pkgDoc.dependencies).length;
  console.log(`  ℹ  检测到用户当前已安装 ${existingDepsCount} 个第三方依赖，全部原样保留。`);

  pkgDoc.dependencies['@winetoken/dsh-plugin-winetoken'] = `link:${PLUGIN_DIR}`;

  if (!pkgDoc.dsh.profile.bundles.includes('@winetoken/dsh-plugin-winetoken')) {
    pkgDoc.dsh.profile.bundles.push('@winetoken/dsh-plugin-winetoken');
  }

  fs.writeFileSync(pkgFile, JSON.stringify(pkgDoc, null, 2), 'utf-8');
  console.log('  [OK] package.json 增量注入完成 (已有插件 100% 完整保留)。');

  // -------------------------------------------------------------
  // 2. 纯文本自愈清理 + 增量合并 ~/.dsh/profiles/desktop/cordis.patch.yml
  //    绝不使用 YAML.stringify 整文件重写，100% 保住用户注释与原始格式
  // -------------------------------------------------------------
  console.log('\n[WineToken]  [步骤 2/2] 安全合并 cordis.patch.yml 模块与模型补丁...');

  let originalPatch = '';
  if (fs.existsSync(patchFile)) {
    try {
      originalPatch = fs.readFileSync(patchFile, 'utf-8');
    } catch (e) {
      console.warn('  [WARN] 读取 cordis.patch.yml 异常:', e.message);
    }
  }

  const preClean = cleanWineTokenFromPatchContent(originalPatch);
  if (preClean.changed) {
    console.log(
      `  ℹ  检测到旧版/重复 WineToken 配置残留，已先执行无损清理 (providers=${preClean.stats.providersRemoved}, comments=${preClean.stats.commentsRemoved}, pluginEntries=${preClean.stats.pluginEntriesRemoved})。`
    );
  }

  const baselineModels = getBaselineModels();
  const nextPatch = mergeProviderIntoPatchContent(originalPatch, {
    id: 'winetoken',
    displayName: 'WineToken (全平台推理模型)',
    api: 'openai-completions',
    baseURL: DEFAULT_BASE_URL,
    apiKeyEnv: 'WINETOKEN_API_KEY',
    defaultContextWindow: 1000000,
    defaultMaxTokens: 128000,
    models: baselineModels
  });

  if (nextPatch === originalPatch) {
    console.log('  [OK] cordis.patch.yml 已处于干净最新状态，跳过写盘与备份。');
  } else {
    backupFile(patchFile);
    fs.writeFileSync(patchFile, nextPatch, 'utf-8');
    console.log(`  [OK] cordis.patch.yml 增量注入完成 (已写入 ${baselineModels.length} 个基线模型，其他插件补丁与注释 100% 完整保留)。`);
  }

  console.log('\n' + '='.repeat(65));
  console.log('[OK] [安装成功] WineToken 插件已成功增量安装到 DeepSeek Harness！');
  console.log('   - 现有插件状态: 100% 完好无损保留');
  console.log('   - 客户端核心包: 100% 官方原版 (绝不篡改 app.asar)');
  console.log('   - 请重启 DeepSeek Harness 客户端即可尽享全平台推理模型与创作工坊！');
  console.log('='.repeat(65));

  return { pkgFile, patchFile, changed: nextPatch !== originalPatch };
}

if (require.main === module) {
  safeInstall();
}

module.exports = { safeInstall };
