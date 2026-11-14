// -*- coding: utf-8 -*-
/**
 * 画布集成冒烟测试: 在隔离子进程里用最小 DSH 宿主桩真实加载 src/client.js。
 * 采用子进程是因为 client.js 顶层含宿主轮询/定时器，在同进程内会阻止 Node 退出。
 * 不访问网络、不写源码目录、不启动真实宿主。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { execFileSync } = require('child_process');

const PROBE = path.join(__dirname, 'fixtures', 'canvas-client-probe.cjs');

function runProbe() {
  const out = execFileSync(process.execPath, [PROBE], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    timeout: 20000,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return out.trim();
}

test('CanvasIntegration - 宿主桩加载 client.js 并注册官方 ModuleLoader 条目 (含阶段三模块)', () => {
  const out = runProbe();
  assert.match(out, /PROBE_OK/);
  assert.match(out, /@winetoken\/dsh-plugin-winetoken/);
  assert.match(out, /STAGE3_MODULES_OK/);
});

test('CanvasIntegration - 五个新纯模块可被 client.js 同款 require 路径解析且不抛错', () => {
  const mods = [
    'canvas-project-store.js',
    'canvas-minimap.js',
    'canvas-nodes.js',
    'canvas-export.js',
    'canvas-assets.js'
  ];
  for (const m of mods) {
    const full = path.join(__dirname, '..', 'src', m);
    assert.doesNotThrow(() => require(full), `${m} 必须可独立加载`);
    assert.equal(typeof require(full), 'object', `${m} 必须导出对象`);
  }
});

test('CanvasIntegration - 小地图几何与节点注册表联合产出可渲染数据', () => {
  const MiniMap = require('../src/canvas-minimap.js');
  const Nodes = require('../src/canvas-nodes.js');
  const project = {
    characters: [{ id: 'c1', name: '楚云' }],
    panels: [{ id: 'p1', num: 1, x: 360, y: 60, width: 280, height: 420 }],
    canvasItems: [{ id: 'i1', type: 'image', x: 700, y: 90, data: { url: 'x.png' } }],
    groups: []
  };
  const nodes = Nodes.listNodes(project);
  const bounds = MiniMap.computeWorldBounds(nodes);
  const t = MiniMap.createMinimapTransform(bounds);
  const rects = MiniMap.computeNodeRects(nodes, t);
  assert.equal(rects.length, nodes.length, '小地图矩形数必须与节点数一致 (索引用于着色)');
  for (const r of rects) {
    assert.ok(Number.isFinite(r.x) && Number.isFinite(r.y));
    assert.ok(r.width >= 2 && r.height >= 2);
  }
  nodes.forEach(n => {
    assert.match(Nodes.getNodeDefinition(n.type).minimapColor, /^#[0-9a-fA-F]{6}$/);
  });
});

test('CanvasIntegration - 生成上下文与工程导出清单在同一工程上互不冲突', () => {
  const Nodes = require('../src/canvas-nodes.js');
  const Exporter = require('../src/canvas-export.js');
  const project = {
    characters: [{ id: 'c1', name: '楚云', avatar: 'asset:avatar.webp' }],
    panels: [{ id: 'p1', num: 1, prompt: '雨夜', characterId: 'c1' }],
    canvasItems: [
      { id: 't1', type: 'text', data: { text: '冷色调' } },
      { id: 'im1', type: 'image', data: { url: 'asset:ref.png', prompt: '剑客剪影' } }
    ],
    edges: [
      { id: 'e1', from: { type: 'item', id: 't1' }, to: { type: 'panel', id: 'p1' } },
      { id: 'e2', from: { type: 'item', id: 'im1' }, to: { type: 'panel', id: 'p1' } }
    ],
    groups: [],
    apiKey: 'MUST-NOT-LEAK'
  };
  const ctx = Nodes.buildGenerationContext(project, 'p1');
  assert.equal(ctx.prompt.includes('冷色调'), true);
  assert.equal(ctx.prompt.includes('剑客剪影'), true);
  assert.deepEqual(ctx.referenceImages, ['asset:ref.png', 'asset:avatar.webp']);

  const manifest = Exporter.buildExportManifest(project, 1);
  assert.equal(manifest.project.apiKey, undefined, '导出清单绝不能携带凭据');
  assert.deepEqual(manifest.assets.map(a => a.assetKey), ['avatar.webp', 'ref.png']);
  const imported = Exporter.parseImportManifest(JSON.stringify(manifest));
  assert.equal(imported.ok, true);
  assert.equal(imported.manifest.project.apiKey, undefined);
});
