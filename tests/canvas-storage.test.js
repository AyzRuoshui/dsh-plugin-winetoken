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
  assert.equal(def.version, '2.0.0');
  assert.equal(Array.isArray(def.characters), true);
  assert.equal(Array.isArray(def.panels), true);

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
