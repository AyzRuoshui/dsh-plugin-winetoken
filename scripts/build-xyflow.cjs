// -*- coding: utf-8 -*-
const path = require('path');
const fs = require('fs');
const esbuild = require('esbuild');

const ROOT_DIR = path.join(__dirname, '..');
const VENDOR_DIR = path.join(ROOT_DIR, 'src', 'vendor');
const ENTRY_FILE = path.join(VENDOR_DIR, 'xyflow.entry.js');
const OUT_FILE = path.join(VENDOR_DIR, 'xyflow.factory.cjs');

if (!fs.existsSync(VENDOR_DIR)) {
  fs.mkdirSync(VENDOR_DIR, { recursive: true });
}

// 写入打包入口
const entryContent = `import * as XyFlow from '@xyflow/react';
import cssText from '@xyflow/react/dist/style.css';

function initXyFlow(React, ReactDOM) {
  if (React && typeof globalThis !== 'undefined' && !globalThis.React) {
    try { globalThis.React = React; } catch (_) {}
  }
  return { ...XyFlow, cssText };
}

module.exports = initXyFlow;
module.exports.default = initXyFlow;
module.exports.initXyFlow = initXyFlow;
`;

fs.writeFileSync(ENTRY_FILE, entryContent, 'utf8');

async function build() {
  await esbuild.build({
    entryPoints: [ENTRY_FILE],
    bundle: true,
    minify: true,
    format: 'cjs',
    external: ['react', 'react-dom'],
    loader: { '.css': 'text' },
    outfile: OUT_FILE,
  });
  console.log('[build-xyflow] Built bundle:', OUT_FILE);
  const stat = fs.statSync(OUT_FILE);
  console.log(`[build-xyflow] Bundle size: ${(stat.size / 1024).toFixed(2)} KB`);
}

if (require.main === module) {
  build().catch(err => {
    console.error('[build-xyflow] Build failed:', err);
    process.exit(1);
  });
}

module.exports = { build };
