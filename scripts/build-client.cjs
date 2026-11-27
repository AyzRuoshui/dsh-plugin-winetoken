// -*- coding: utf-8 -*-
/**
 * v2.5.19 全量打包：把 client.js + 12 兄弟 + canvas-reactflow + xyflow
 * 打成单个自包含 CJS 产物 dist/client.js，运行时相对 require 归零。
 *
 * 关键参数（对齐计划第 3 节）：
 *  - bundle:true, format:'cjs', platform:'browser'
 *  - external = 11 个 seed word（本插件运行时只用 react/react-dom）
 *  - loader '.css' -> 'text'（xyflow CSS 内联进产物）
 *  - onResolve fs/path/os/child_process/electron -> src/vendor/node-builtin-stub.cjs
 *    （4 个 fs 兄弟走内存垫片；child_process/electron 为 client.js 原生文件能力的可选
 *    依赖，重定向到空 stub 后 try/catch 自然降级，产物不留运行时 require）
 *  - minify:false（便于产物静态审计；体积过大时下游可加 --minify 变体）
 *  - outfile: dist/client.js
 */
const path = require('path');
const fs = require('fs');
const esbuild = require('esbuild');

const ROOT_DIR = path.join(__dirname, '..');
const ENTRY_FILE = path.join(ROOT_DIR, 'src', 'client.bundle.entry.js');
const OUT_DIR = path.join(ROOT_DIR, 'dist');
const OUT_FILE = path.join(OUT_DIR, 'client.js');
const STUB_FILE = path.join(ROOT_DIR, 'src', 'vendor', 'node-builtin-stub.cjs');

// 宿主 seed word 白名单（计划第 7 节列出的 11 个）；这些由宿主 factory 注入，不打包。
const SEED_WORDS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  'zod',
  '@tanstack/react-virtual',
  '@deepseek-ai/agent-client-store',
  '@deepseek-ai/agent-client-ui-slots',
  '@deepseek-ai/agent-client-ui-primitives',
  '@deepseek-ai/agent-client-ui-dockkit'
];

// Node / Electron 内置模块兜底重定向插件：onResolve 把这些模块在 bundle 期替换为
// 空 stub（不依赖 alias 对内置模块的语义差异，双保险）。
// fs/path/os：4 个 fs 兄弟据此走内存垫片。
// child_process / electron（簇 B，v2.5.19）：来自 src/client.js 的 WineTokenFileUtil
// （promptSaveLocation / openFile / revealFile / openFolder / writeMediaToFile 等原生
// 文件对话框与打开文件的可选能力，均包在 try/catch 里）。这些调用在 DSH web 宿主里
// 一旦执行必 miss（宿主只注入 11 个 seed，没有 node 内置），先重定向到空 stub，
// 让 require 返回 {}，try/catch 内的能力探测自然降级，产物不再残留运行时
// require('child_process') / require('electron')。
const builtinStubPlugin = {
  name: 'winetoken-builtin-stub',
  setup(buildCtx) {
    buildCtx.onResolve({ filter: /^(fs|path|os|child_process|electron)$/ }, (args) => ({ path: STUB_FILE, namespace: 'file' }));
  }
};

async function build({ minify = false } = {}) {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  await esbuild.build({
    entryPoints: [ENTRY_FILE],
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: 'es2020',
    minify,
    external: SEED_WORDS,
    loader: { '.css': 'text' },
    plugins: [builtinStubPlugin],
    logLevel: 'info',
    outfile: OUT_FILE
  });
  const stat = fs.statSync(OUT_FILE);
  console.log(`[build-client] Built bundle: ${OUT_FILE}`);
  console.log(`[build-client] Bundle size: ${(stat.size / 1024).toFixed(2)} KB`);
  return OUT_FILE;
}

if (require.main === module) {
  const minify = process.argv.includes('--minify');
  build({ minify }).catch(err => {
    console.error('[build-client] Build failed:', err);
    process.exit(1);
  });
}

module.exports = { build, SEED_WORDS, OUT_FILE };
