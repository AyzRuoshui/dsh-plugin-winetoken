// -*- coding: utf-8 -*-
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { CanvasProjectStorage } = require('../src/canvas-storage.js');

test('CanvasProjectStorage - 默认初始工程与原子存取', () => {
  const testDir = path.join(__dirname, '..', '.tmp', 'test_storage_' + Date.now());
  const storage = new CanvasProjectStorage(testDir);

  // 1. 默认数据加载
  const def = storage.getDefaultProject();
  assert.equal(def.version, '2.2.0');
  assert.equal(Array.isArray(def.characters), true);
  assert.equal(Array.isArray(def.panels), true);
  // CANVAS-M2/M3: 增量字段默认值
  assert.equal(Array.isArray(def.canvasItems), true);
  assert.equal(Array.isArray(def.edges), true);
  assert.equal(Array.isArray(def.groups), true);

  // 2. 物理写入与持久化加载
  const customData = {
    ...def,
    characters: [{ id: 'char_test', name: '测试角色', dna: '帅气剑客', avatar: '' }]
  };
  const ok = storage.saveProject(customData);
  assert.equal(ok, true);

  const loaded = storage.loadProject();
  assert.equal(loaded.characters[0].name, '测试角色');
  assert.equal(fs.existsSync(storage.projectFilePath), true);

  // 清理临时测试目录
  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch (_) {}
});

test('CanvasProjectStorage - 旧版本工程文件增量字段向后兼容 (2.0.0 → 2.2.0)', () => {
  const testDir = path.join(__dirname, '..', '.tmp', 'test_storage_legacy_' + Date.now());
  const storage = new CanvasProjectStorage(testDir);
  fs.mkdirSync(testDir, { recursive: true });

  // 模拟旧版本工程文件: 无 canvasItems/edges/groups 字段 (CANVAS-M2/M3 之前的数据)
  const legacyProject = {
    version: '2.0.0',
    characters: [{ id: 'char_old', name: '旧角色', dna: '老主角', avatar: '' }],
    panels: [{
      id: 'shot_old', num: 1, x: 360, y: 60, width: 280, height: 420,
      aspectRatio: '2:3', shot: 'CU', shotLabel: '特写', prompt: '旧分镜',
      dialogue: '', characterId: 'char_old', imageUrl: '', candidates: [], status: 'idle'
    }],
    viewport: { x: 40, y: 30, zoom: 1 }
  };
  fs.writeFileSync(storage.projectFilePath, JSON.stringify(legacyProject), 'utf8');

  const loaded = storage.loadProject();
  assert.equal(loaded.characters[0].name, '旧角色');
  assert.equal(Array.isArray(loaded.canvasItems), true);
  assert.equal(loaded.canvasItems.length, 0);
  assert.equal(Array.isArray(loaded.edges), true);
  assert.equal(Array.isArray(loaded.groups), true);

  // 迁移后写盘升级版本号且增量字段持久保留
  assert.equal(storage.saveProject(loaded), true);
  const reloaded = storage.loadProject();
  assert.equal(reloaded.version, '2.2.0');
  assert.equal(Array.isArray(reloaded.groups), true);

  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch (_) {}
});
