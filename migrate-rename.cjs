// -*- coding: utf-8 -*-
/**
 * WineToken 项目文件夹更名迁移工具（2026-11-10）
 * G:\dsh-wimetoken → G:\dsh-winetoken
 *
 * 完成动作（全部幂等，可重复运行）：
 *  1. 自动关闭 DeepSeek Harness（若在运行）
 *  2. 重命名项目文件夹（被占用则提示先关 ZCode，不硬来）
 *  3. 同步 profile 的 package.json / pnpm-lock.yaml 三处 link: 路径（先备份）
 *  4. 重建 node_modules junction 指向新路径
 *  5. 迁移 ZCode 项目记忆到新路径 key（新旧两份内容同步更正路径）
 *
 * 用法：关闭 ZCode 后双击 migrate-rename.cmd，或命令行 node migrate-rename.cjs
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

process.chdir('G:\\'); // 立刻离开待改名目录，避免自身 cwd 锁住

const OLD_DIR = 'G:\\dsh-wimetoken';
const NEW_DIR = 'G:\\dsh-winetoken';
const PROFILE = 'C:\\Users\\CodyAllison\\.dsh\\profiles\\desktop';
const PROFILE_PKG = path.join(PROFILE, 'package.json');
const PROFILE_LOCK = path.join(PROFILE, 'pnpm-lock.yaml');
const LINK = path.join(PROFILE, 'node_modules', '@winetoken', 'dsh-plugin-winetoken');
const MEM_ROOT = 'C:\\Users\\CodyAllison\\.zcode\\cli\\memories\\projects';
const MEM_OLD = path.join(MEM_ROOT, 'dsh-wimetoken-ac0c9b2a77907cd4');
const MEM_NEW = path.join(MEM_ROOT, 'dsh-winetoken-a134fb398fef0c7e');

let step = 0;
function ok(msg) { step++; console.log(`[${step}] ✓ ${msg}`); }
function warn(msg) { console.log(`    ⚠ ${msg}`); }

function pathReplace(content) {
  // 保留原有分隔符风格（G:\dsh-wimetoken / G:\\dsh-wimetoken / G:/dsh-wimetoken）
  return content.replace(/G:(\\+|\/+)dsh-wimetoken/g, (m, sep) => 'G:' + sep + 'dsh-winetoken');
}

function killDsh() {
  try {
    execSync('taskkill /IM "DeepSeek Harness.exe" /F', { stdio: 'pipe' });
    ok('已关闭 DeepSeek Harness（正在运行的进程全部终止）');
    execSync('ping -n 3 127.0.0.1 >nul', { stdio: 'pipe' }); // 等 2 秒让句柄释放
  } catch (_) {
    ok('DeepSeek Harness 未在运行，跳过关闭');
  }
}

function renameDir() {
  if (!fs.existsSync(OLD_DIR)) {
    if (fs.existsSync(NEW_DIR)) { ok('文件夹已处于新名称 G:\\dsh-winetoken（跳过改名）'); return true; }
    console.error('错误：新旧文件夹都不存在，请检查盘符。'); process.exit(1);
  }
  if (fs.existsSync(NEW_DIR)) {
    console.error('错误：G:\\dsh-winetoken 已存在且旧目录也在，请先处理冲突。'); process.exit(1);
  }
  for (let i = 1; i <= 5; i++) {
    try {
      fs.renameSync(OLD_DIR, NEW_DIR);
      ok(`文件夹已改名 G:\\dsh-wimetoken → G:\\dsh-winetoken (第 ${i} 次尝试)`);
      return true;
    } catch (e) {
      warn(`第 ${i}/5 次改名失败：${e.message.slice(0, 60)}`);
      if (i < 5) execSync('ping -n 3 127.0.0.1 >nul', { stdio: 'pipe' });
    }
  }
  console.error('');
  console.error('❌ 文件夹仍被占用。请按顺序关闭后重新运行本脚本：');
  console.error('   1. DeepSeek Harness（本脚本会自动关）');
  console.error('   2. ZCode（主程序与所有窗口）——最常见的占用者');
  console.error('   3. 其它打开该文件夹的资源管理器窗口 / 终端');
  process.exit(1);
}

function patchFile(file, label) {
  if (!fs.existsSync(file)) { warn(`${label} 不存在，跳过`); return; }
  const raw = fs.readFileSync(file, 'utf8');
  const patched = pathReplace(raw);
  if (patched === raw) { ok(`${label} 已是新路径（跳过）`); return; }
  fs.writeFileSync(file + '.bak.rename2026', raw, 'utf8');
  fs.writeFileSync(file, patched, 'utf8');
  ok(`${label} link 路径已更新（原文件备份为 .bak.rename2026）`);
}

function rebuildLink() {
  let cur = '';
  try { cur = fs.readlinkSync(LINK); } catch (_) {}
  if (cur && cur.toLowerCase() === NEW_DIR.toLowerCase()) { ok('junction 已指向新路径（跳过）'); return; }
  try { fs.rmSync(LINK, { force: true }); } catch (_) {
    try { execSync(`cmd /c rmdir "${LINK}"`, { stdio: 'pipe' }); } catch (e2) {
      console.error('错误：旧 junction 删除失败：' + e2.message); process.exit(1);
    }
  }
  fs.symlinkSync(NEW_DIR, LINK, 'junction');
  ok('junction 已重建 → G:\\dsh-winetoken');
  // 读穿 junction 验证
  const pkg = JSON.parse(fs.readFileSync(path.join(LINK, 'package.json'), 'utf8'));
  ok(`junction 解析验证通过：读入 package.json version=${pkg.version}`);
}

function migrateMemory() {
  if (!fs.existsSync(MEM_OLD)) { warn('旧记忆目录不存在，跳过迁移'); return; }
  if (!fs.existsSync(MEM_NEW)) {
    fs.cpSync(MEM_OLD, MEM_NEW, { recursive: true });
    ok(`项目记忆已迁移至新 key 目录 (${path.basename(MEM_NEW)})`);
  } else {
    ok('新记忆目录已存在（跳过复制）');
  }
  // 新旧两份里的路径表述同步更正
  let fixed = 0;
  for (const dir of [MEM_OLD, MEM_NEW]) {
    const memDir = path.join(dir, 'memory');
    if (!fs.existsSync(memDir)) continue;
    for (const f of fs.readdirSync(memDir)) {
      if (!f.endsWith('.md')) continue;
      const p = path.join(memDir, f);
      const raw = fs.readFileSync(p, 'utf8');
      const patched = pathReplace(raw);
      if (patched !== raw) { fs.writeFileSync(p, patched, 'utf8'); fixed++; }
    }
  }
  ok(`记忆文件内路径表述更正 ${fixed} 处（新旧目录均处理）`);
}

console.log('='.repeat(62));
console.log(' WineToken 项目文件夹更名迁移 dsh-wimetoken → dsh-winetoken');
console.log('='.repeat(62));

killDsh();
renameDir();
patchFile(PROFILE_PKG, 'profile package.json');
patchFile(PROFILE_LOCK, 'profile pnpm-lock.yaml');
rebuildLink();
migrateMemory();

console.log('='.repeat(62));
console.log('✅ 迁移完成！接下来：');
console.log('   1. 用 ZCode 打开新文件夹 G:\\dsh-winetoken');
console.log('   2. 重开 DeepSeek Harness（插件即时加载新源码）');
console.log('   3. 确认无误后可删除旧备份 *.bak.rename2026 与本迁移脚本');
console.log('='.repeat(62));
