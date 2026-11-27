// -*- coding: utf-8 -*-
/**
 * DeepSeek Harness - WineToken 插件安全移除清理脚本
 * 从 cordis.patch.yml 无损移除所有 WineToken 注入段与游离插件注释，
 * 严格保留 ui-theme 等其他插件、zhaizhu 等共存 provider 与全部用户注释。
 */

const fs = require('fs');
const path = require('path');

const PLUGIN_DIR = path.resolve(__dirname, '..');
const { DSH_HOME, CORDIS_PATCH_FILE } = require(path.join(PLUGIN_DIR, 'src', 'credentials.js'));
const { cleanupCordisPatchFile } = require(path.join(PLUGIN_DIR, 'src', 'sync.js'));

const PACKAGE_NAME = '@winetoken/dsh-plugin-winetoken';
const DEFAULT_PROFILE_PKG = path.join(DSH_HOME, 'profiles', 'desktop', 'package.json');

function parseArgs(argv = []) {
  const opts = {
    dryRun: false,
    backup: true,
    patchFile: CORDIS_PATCH_FILE,
    cleanPackageJson: false,
    packageFile: DEFAULT_PROFILE_PKG,
    help: false
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      opts.dryRun = true;
    } else if (arg === '--no-backup') {
      opts.backup = false;
    } else if (arg === '--clean-package-json') {
      opts.cleanPackageJson = true;
    } else if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else if (arg === '--patch-file' && argv[i + 1]) {
      opts.patchFile = path.resolve(argv[++i]);
    } else if (arg.startsWith('--patch-file=')) {
      opts.patchFile = path.resolve(arg.slice('--patch-file='.length));
    } else if (arg === '--package-file' && argv[i + 1]) {
      opts.packageFile = path.resolve(argv[++i]);
    } else if (arg.startsWith('--package-file=')) {
      opts.packageFile = path.resolve(arg.slice('--package-file='.length));
    }
  }
  return opts;
}

function cleanProfilePackageJson(pkgFile, dryRun) {
  if (!fs.existsSync(pkgFile)) {
    return { exists: false, changed: false };
  }
  const raw = fs.readFileSync(pkgFile, 'utf-8');
  const pkg = JSON.parse(raw);
  let changed = false;

  if (pkg && pkg.dependencies && Object.prototype.hasOwnProperty.call(pkg.dependencies, PACKAGE_NAME)) {
    delete pkg.dependencies[PACKAGE_NAME];
    changed = true;
  }
  if (pkg && pkg.dsh && pkg.dsh.profile && Array.isArray(pkg.dsh.profile.bundles)) {
    const filtered = pkg.dsh.profile.bundles.filter(b => b !== PACKAGE_NAME);
    if (filtered.length !== pkg.dsh.profile.bundles.length) {
      pkg.dsh.profile.bundles = filtered;
      changed = true;
    }
  }

  if (changed && !dryRun) {
    const bakPath = `${pkgFile}.bak`;
    if (!fs.existsSync(bakPath)) {
      fs.writeFileSync(bakPath, raw, 'utf-8');
    }
    fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2), 'utf-8');
  }
  return { exists: true, changed };
}

function runUninstall(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);

  if (opts.help) {
    console.log('Usage: node scripts/safe_uninstall.cjs [--dry-run] [--patch-file <path>] [--no-backup] [--clean-package-json]');
    return { exitCode: 0, help: true };
  }

  const result = cleanupCordisPatchFile({
    dryRun: opts.dryRun,
    backup: opts.backup,
    patchFile: opts.patchFile
  });

  if (!result.exists) {
    console.log(`[WineToken Uninstall] cordis.patch.yml not found (${result.patchFile}), nothing to clean.`);
  } else if (!result.changed) {
    console.log('[WineToken Uninstall] cordis.patch.yml is already clean (no changes).');
  } else {
    const s = result.stats || {};
    const summary = `managed=${s.managedBlocksRemoved || 0}, comments=${s.commentsRemoved || 0}, pluginEntries=${s.pluginEntriesRemoved || 0}, providers=${s.providersRemoved || 0}, emptyLlmEntries=${s.emptyLlmEntriesRemoved || 0}`;
    if (opts.dryRun) {
      console.log(`[WineToken Uninstall] [dry-run] Would clean WineToken entries from ${result.patchFile} (${summary}).`);
    } else {
      console.log(`[WineToken Uninstall] Cleaned WineToken entries from ${result.patchFile} (${summary}).`);
      if (result.backupFile) {
        console.log(`[WineToken Uninstall] Backup saved to ${result.backupFile}`);
      }
    }
  }

  let pkgResult = null;
  if (opts.cleanPackageJson) {
    pkgResult = cleanProfilePackageJson(opts.packageFile, opts.dryRun);
    if (pkgResult.changed) {
      const prefix = opts.dryRun ? '[dry-run] Would remove' : 'Removed';
      console.log(`[WineToken Uninstall] ${prefix} ${PACKAGE_NAME} from ${opts.packageFile}.`);
    } else {
      console.log(`[WineToken Uninstall] ${opts.packageFile} has no ${PACKAGE_NAME} entry.`);
    }
  }

  return { exitCode: 0, result, pkgResult };
}

if (require.main === module) {
  try {
    const res = runUninstall();
    process.exit(res.exitCode);
  } catch (err) {
    console.error('[WineToken Uninstall] Cleanup failed:', err.message);
    process.exit(1);
  }
}

module.exports = {
  parseArgs,
  runUninstall
};
