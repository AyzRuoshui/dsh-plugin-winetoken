// -*- coding: utf-8 -*-
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  APP_ID,
  EXPORT_VERSION,
  isSafeAssetKey,
  collectAssetKeys,
  buildExportManifest,
  parseImportManifest
} = require('../src/canvas-export.js');

function sampleProject() {
  return {
    characters: [{ id: 'c1', name: '楚云', avatar: 'asset:avatar_01.webp' }],
    panels: [{
      id: 'p1', num: 1, prompt: '雨夜长街', imageUrl: 'asset:shot_01.png',
      candidates: ['asset:shot_01_alt.png'], characterId: 'c1'
    }],
    canvasItems: [
      { id: 'i1', type: 'image', data: { url: 'asset:ref_01.jpg', assetKey: 'ref_01.jpg' } },
      { id: 'i2', type: 'text', data: { text: '便签' } }
    ],
    edges: [{ id: 'e1', from: { type: 'item', id: 'i1' }, to: { type: 'panel', id: 'p1' } }],
    groups: [],
    viewport: { x: 40, y: 30, zoom: 1 },
    activeModel: 'model-a',
    // 运行时敏感字段：绝不允许进入导出包
    apiKey: 'SK-SECRET-MUST-NOT-EXPORT',
    credentials: { token: 'abc' }
  };
}

test('CanvasExport - 导出清单版本化 / 敏感字段剥离 / 资产键去重', () => {
  const m = buildExportManifest(sampleProject(), 1700000000000);
  assert.equal(m.app, APP_ID);
  assert.equal(m.version, EXPORT_VERSION);
  assert.equal(m.exportedAt, 1700000000000);
  assert.equal(m.project.apiKey, undefined);
  assert.equal(m.project.credentials, undefined);
  assert.equal(m.project.panels[0].prompt, '雨夜长街');
  assert.deepEqual(m.project.viewport, { x: 40, y: 30, zoom: 1 });
  assert.deepEqual(m.assets.map(a => a.assetKey), [
    'avatar_01.webp', 'shot_01.png', 'shot_01_alt.png', 'ref_01.jpg'
  ]);
  assert.deepEqual(m.warnings, []);
});

test('CanvasExport - 远程 URL / data URL 不随包导出，旧工程缺字段补默认', () => {
  const keys = collectAssetKeys({
    panels: [{ imageUrl: 'https://cdn.example.com/a.png' }],
    canvasItems: [{ data: { url: 'data:image/png;base64,AAAA' } }]
  });
  assert.deepEqual(keys, []);
  const m = buildExportManifest({ version: '2.0.0' });
  assert.deepEqual(m.project.characters, []);
  assert.deepEqual(m.project.panels, []);
  assert.deepEqual(m.project.canvasItems, []);
  assert.deepEqual(m.project.edges, []);
  assert.deepEqual(m.project.groups, []);
  assert.deepEqual(m.project.viewport, { x: 40, y: 30, zoom: 1 });
  assert.ok(m.warnings.some(w => w.includes('characters')));
  assert.deepEqual(m.assets, []);
});

test('CanvasExport - isSafeAssetKey 拒绝路径穿越 / 控制字符 / 非法扩展名', () => {
  assert.equal(isSafeAssetKey('shot_01.png'), true);
  assert.equal(isSafeAssetKey('REF-2.WEBP'), true);
  for (const bad of [
    '../evil.png', 'a/b.png', 'a\\b.png', 'evil.exe', 'evil.js',
    'a\u0000b.png', '', null, undefined, 123, {}, 'a'.repeat(200) + '.png'
  ]) {
    assert.equal(isSafeAssetKey(bad), false, `应拒绝: ${String(bad)}`);
  }
});

test('CanvasExport - 导入往返一致 (对象与 JSON 字符串两种入参)', () => {
  const m = buildExportManifest(sampleProject(), 1700000000000);
  const fromObj = parseImportManifest(m);
  assert.equal(fromObj.ok, true);
  assert.equal(fromObj.error, undefined);
  assert.deepEqual(fromObj.manifest.project, m.project);
  assert.deepEqual(fromObj.manifest.assets, m.assets);
  assert.equal(fromObj.manifest.exportedAt, 1700000000000);

  const fromJson = parseImportManifest(JSON.stringify(m));
  assert.equal(fromJson.ok, true);
  assert.deepEqual(fromJson.manifest.project, m.project);
});

test('CanvasExport - 破坏性契约：错误 app / 不兼容版本 / 非法 JSON / 非对象根节点', () => {
  const m = buildExportManifest(sampleProject());
  const cases = [
    [{ ...m, app: 'evil-app' }, /来源标识不匹配/],
    [{ ...m, app: 'winetoken-canvas', version: 999 }, /版本不兼容/],
    [{ ...m, project: null }, /缺少 project/],
    ['{broken json', /不是合法 JSON/],
    [null, /根节点必须是对象/],
    [[1, 2, 3], /根节点必须是对象/]
  ];
  for (const [input, pattern] of cases) {
    const r = parseImportManifest(input);
    assert.equal(r.ok, false);
    assert.match(r.error, pattern);
  }
});

test('CanvasExport - 破坏性契约：脏资产清单剔除路径穿越且导入缺字段补默认', () => {
  const dirty = {
    app: APP_ID,
    version: EXPORT_VERSION,
    exportedAt: 1,
    project: { panels: [{ id: 'p1', prompt: 'x' }] },
    assets: [
      { assetKey: '../evil.png' },
      { assetKey: 'ok.png' },
      { assetKey: 'ok.png' },
      { assetKey: 'evil.exe' },
      null, 'junk', {}
    ]
  };
  const r = parseImportManifest(dirty);
  assert.equal(r.ok, true);
  assert.deepEqual(r.manifest.assets, [{ assetKey: 'ok.png', path: 'assets/ok.png' }]);
  assert.deepEqual(r.manifest.project.canvasItems, []);
  assert.deepEqual(r.manifest.project.viewport, { x: 40, y: 30, zoom: 1 });
  assert.ok(r.warnings.some(w => w.includes('剔除非法资产键')));
  assert.ok(r.warnings.some(w => w.includes('canvasItems')));
});

test('CanvasExport - 原型污染载荷不会污染导出/导入结果', () => {
  const payload = JSON.parse('{"__proto__":{"polluted":true},"constructor":"bad","panels":[]}');
  const m = buildExportManifest(payload);
  assert.equal(({}).polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);
  const r = parseImportManifest({
    app: APP_ID, version: EXPORT_VERSION, project: payload, assets: []
  });
  assert.equal(r.ok, true);
  assert.equal(({}).polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);
});
