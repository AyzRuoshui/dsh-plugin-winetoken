// -*- coding: utf-8 -*-
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  CanvasAssets,
  isSafeAssetKey,
  decodeDataUrl,
  extOf,
  mimeOfKey,
  collectAssetKeys
} = require('../src/canvas-assets.js');

function makeDir(tag) {
  const dir = path.join(__dirname, '..', '.tmp', 'test_canvas_assets_' + tag + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}

const PNG = 'data:image/png;base64,' + Buffer.from('fake-png-bytes').toString('base64');
const JPG = 'data:image/jpeg;base64,' + Buffer.from('fake-jpg-bytes').toString('base64');

test('CanvasAssets - DataURL 解码与扩展名/MIME 白名单', () => {
  assert.equal(extOf(PNG), 'png');
  assert.equal(extOf(JPG), 'jpg');
  assert.equal(mimeOfKey('shot_01.PNG'), 'image/png');
  assert.equal(mimeOfKey('clip.mp4'), 'video/mp4');
  assert.equal(decodeDataUrl(PNG).buffer.length, Buffer.from('fake-png-bytes').length);
  for (const bad of ['', null, 'https://x/a.png', 'data:text/html;base64,AAAA', 'data:image/png;base64,', 'data:image/svg+xml;base64,AAAA']) {
    assert.equal(decodeDataUrl(bad), null, `应拒绝: ${String(bad)}`);
  }
  assert.equal(isSafeAssetKey('../evil.png'), false);
  assert.equal(isSafeAssetKey('a/b.png'), false);
  assert.equal(isSafeAssetKey('evil.exe'), false);
  assert.equal(isSafeAssetKey('ok_01.webp'), true);
});

test('CanvasAssets - 落盘 + 物理回读强校验 + 读回 DataURL 往返一致', () => {
  const dir = makeDir('roundtrip');
  try {
    const assets = new CanvasAssets(dir);
    const saved = assets.saveDataUrl(PNG);
    assert.ok(isSafeAssetKey(saved.assetKey));
    assert.equal(saved.mime, 'image/png');
    assert.equal(saved.bytes, Buffer.from('fake-png-bytes').length);
    assert.equal(assets.exists(saved.assetKey), true);
    assert.equal(assets.readAsDataUrl(saved.assetKey), PNG);
    assert.equal(fs.readFileSync(path.join(dir, saved.assetKey)).length, saved.bytes);
  } finally {
    cleanup(dir);
  }
});

test('CanvasAssets - 破坏性契约：物理回读篡改必须真实抛错，绝不假成功', () => {
  const dir = makeDir('tamper');
  try {
    const assets = new CanvasAssets(dir);
    const originalRead = fs.readFileSync;
    fs.readFileSync = function (file, ...args) {
      if (typeof file === 'string' && file.startsWith(dir) && !file.endsWith('.tmp')) {
        return Buffer.from('TAMPERED');
      }
      return originalRead.call(fs, file, ...args);
    };
    try {
      assert.throws(() => assets.saveDataUrl(PNG), /回读内容与写入不一致/);
    } finally {
      fs.readFileSync = originalRead;
    }
  } finally {
    cleanup(dir);
  }
});

test('CanvasAssets - 破坏性契约：非法 DataURL / 空 Buffer / 非法键 / 缺失资产全部真实报错', () => {
  const dir = makeDir('reject');
  try {
    const assets = new CanvasAssets(dir);
    assert.throws(() => assets.saveDataUrl('javascript:alert(1)'), /非法的图片\/视频 DataURL/);
    assert.throws(() => assets.saveDataUrl('data:image/svg+xml;base64,AAAA'), /非法的图片\/视频 DataURL/);
    assert.throws(() => assets.saveBuffer(Buffer.alloc(0), 'png'), /资产内容为空/);
    assert.throws(() => assets.filePath('../../evil.png'), /非法资产键/);
    assert.throws(() => assets.readAsDataUrl('missing.png'), /读取失败/);
    assert.equal(assets.exists('../evil.png'), false);
  } finally {
    cleanup(dir);
  }
});

test('CanvasAssets - saveBuffer 支持视频 MIME 且回读字节数一致', () => {
  const dir = makeDir('buffer');
  try {
    const assets = new CanvasAssets(dir);
    const buf = Buffer.from('fake-mp4-payload');
    const saved = assets.saveBuffer(buf, 'video/mp4');
    assert.equal(saved.mime, 'video/mp4');
    assert.ok(saved.assetKey.endsWith('.mp4'));
    assert.equal(assets.readAsDataUrl(saved.assetKey), 'data:video/mp4;base64,' + buf.toString('base64'));
    assert.throws(() => assets.saveBuffer(buf, 'application/x-msdownload'), /不支持的扩展名/);
  } finally {
    cleanup(dir);
  }
});

test('CanvasAssets - collectAssetKeys 汇总并去重，cleanupUnused 只删未引用合法资产', () => {
  const dir = makeDir('cleanup');
  try {
    const assets = new CanvasAssets(dir);
    const a = assets.saveDataUrl(PNG);
    const b = assets.saveDataUrl(JPG);
    fs.writeFileSync(path.join(dir, 'orphan.webp'), 'junk');
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'must-survive');
    fs.writeFileSync(path.join(dir, 'stray.tmp'), 'tmp');

    const project = {
      panels: [{ imageUrl: 'asset:' + a.assetKey, candidates: ['asset:' + a.assetKey] }],
      canvasItems: [{ data: { url: 'https://cdn/x.png' } }]
    };
    assert.deepEqual(collectAssetKeys(project), [a.assetKey]);
    const removed = assets.cleanupUnused(project);
    assert.ok(removed.includes(b.assetKey));
    assert.ok(removed.includes('orphan.webp'));
    assert.equal(fs.existsSync(path.join(dir, a.assetKey)), true, '在用资产不得删除');
    assert.equal(fs.existsSync(path.join(dir, 'notes.txt')), true, '非白名单文件不得误删');
    assert.equal(fs.existsSync(path.join(dir, 'stray.tmp')), true, '.tmp 文件不得误删');
  } finally {
    cleanup(dir);
  }
});

test('CanvasAssets - 真实写盘失败 (目录被文件占位) 向上抛错而非静默返回成功', () => {
  const dir = makeDir('write_fail');
  try {
    const assets = new CanvasAssets(dir);
    for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { recursive: true, force: true });
    fs.rmdirSync(dir);
    fs.writeFileSync(dir, 'blocked', 'utf8');
    assert.throws(() => assets.saveDataUrl(PNG), /ENOENT|ENOTDIR|失败|错误/);
  } finally {
    cleanup(dir);
  }
});
