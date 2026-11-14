// -*- coding: utf-8 -*-
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  CanvasProjectStore,
  REGISTRY_VERSION,
  PROJECT_VERSION,
  isValidId
} = require('../src/canvas-project-store.js');

function makeDir(tag) {
  const dir = path.join(__dirname, '..', '.tmp', 'test_project_store_' + tag + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}

function writeJson(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
}

test('CanvasProjectStore - 全新注册表 / 创建-重命名-删除-恢复-彻底清除生命周期', () => {
  const dir = makeDir('lifecycle');
  try {
    const store = new CanvasProjectStore(dir);
    assert.deepEqual(store.listProjects(), []);
    assert.deepEqual(store.listDeleted(), []);
    assert.equal(store.getActiveId(), null);
    assert.equal(store._readRegistry().version, REGISTRY_VERSION);

    const a = store.createProject('  第一季  ');
    assert.equal(a.name, '第一季');
    assert.ok(isValidId(a.id));
    assert.equal(store.getActiveId(), a.id);
    assert.equal(store.listProjects().length, 1);

    const b = store.createProject('第二季');
    assert.equal(store.listProjects().length, 2);
    assert.equal(store.getActiveId(), a.id, '新建工程不应抢走当前激活工程');

    assert.equal(store.renameProject(b.id, '第二季·修订').name, '第二季·修订');
    assert.equal(store.renameProject('not_exist', 'x'), null);
    assert.equal(store.renameProject('../evil', 'x'), null);

    assert.equal(store.deleteProject(b.id), true);
    assert.deepEqual(store.listProjects().map(p => p.id), [a.id]);
    assert.deepEqual(store.listDeleted().map(p => p.id), [b.id]);

    assert.equal(store.restoreProject(b.id), true);
    assert.equal(store.listProjects().length, 2);
    assert.deepEqual(store.listDeleted(), []);

    assert.equal(store.setActiveId(b.id), true);
    assert.equal(store.getActiveId(), b.id);
    assert.equal(store.setActiveId('ghost'), false);
    assert.equal(store.getActiveId(), b.id);

    assert.equal(store.deleteProject(a.id), true);
    assert.equal(store.getActiveId(), b.id, '删除激活工程后自动回退到剩余工程');

    assert.equal(store.purgeProject(b.id), true);
    assert.deepEqual(store.listProjects(), []);
    assert.equal(store.getActiveId(), null, '彻底清除最后一个工程后激活态为空');
    assert.equal(fs.existsSync(store.projectFilePath(b.id)), false);
    assert.equal(store.purgeProject(b.id), false);
  } finally {
    cleanup(dir);
  }
});

test('CanvasProjectStore - 脏环境：主 index 损坏但 .bak 完好时自动回退', () => {
  const dir = makeDir('corrupt_index');
  try {
    const store = new CanvasProjectStore(dir);
    const good = {
      version: 1, activeId: 'p_ok',
      projects: [{ id: 'p_ok', name: '可用工程', createdAt: 1, updatedAt: 2 }],
      deleted: []
    };
    writeJson(store.backupPath, good);
    fs.writeFileSync(store.registryPath, '{ broken json', 'utf8');
    const reg = store._readRegistry();
    assert.deepEqual(reg.projects.map(p => p.id), ['p_ok']);
    assert.equal(reg.activeId, 'p_ok');
  } finally {
    cleanup(dir);
  }
});

test('CanvasProjectStore - 脏环境：重复 id / 缺字段 / 非法 id / 非法 activeId 全部归一化', () => {
  const dir = makeDir('dirty_registry');
  try {
    const store = new CanvasProjectStore(dir);
    writeJson(store.registryPath, {
      version: 99,
      activeId: 'ghost',
      projects: [
        { id: 'dup', name: '甲', createdAt: 1, updatedAt: 1 },
        { id: 'dup', name: '乙', createdAt: 2, updatedAt: 2 },
        { id: 'ok', name: '含\n换行', createdAt: 'bad', updatedAt: NaN },
        { id: '../evil', name: '恶意' },
        { name: '缺 id' },
        null, 'junk'
      ],
      deleted: [{ id: 'dup', name: '回收站重复' }]
    });
    const reg = store._readRegistry();
    assert.deepEqual(reg.projects.map(p => p.id), ['dup', 'ok']);
    assert.equal(reg.projects[0].name, '甲', '保留首次出现的条目');
    assert.equal(reg.projects[1].name, '含换行');
    assert.equal(reg.deleted.length, 0, '跨列表去重：已存在于 projects 的 id 不进入 deleted');
    assert.equal(reg.activeId, 'dup', '非法 activeId 回退到首个工程');
    assert.equal(reg.version, REGISTRY_VERSION);
  } finally {
    cleanup(dir);
  }
});

test('CanvasProjectStore - 旧单文件零迁移：幂等、原文件不被改写、旧字段增量兼容', () => {
  const dir = makeDir('legacy');
  try {
    const legacy = {
      version: '2.0.0',
      characters: [{ id: 'char_old', name: '旧角色', dna: '老主角', avatar: '' }],
      panels: [{ id: 'shot_old', num: 1, x: 360, y: 60, prompt: '旧分镜' }],
      viewport: { x: 40, y: 30, zoom: 1 }
    };
    writeJson(storePathLegacy(dir), legacy);
    const before = fs.readFileSync(storePathLegacy(dir), 'utf8');

    const store = new CanvasProjectStore(dir);
    assert.equal(store.ensureLegacyMigration(), true);
    assert.equal(store.ensureLegacyMigration(), false, '重复调用不得重复迁移');
    assert.equal(fs.readFileSync(storePathLegacy(dir), 'utf8'), before, '旧档案必须原样保留');
    assert.equal(store.listProjects().length, 1);
    assert.equal(store.getActiveId(), 'project_default');

    const loaded = store.loadProject('project_default');
    assert.equal(loaded.version, PROJECT_VERSION);
    assert.equal(loaded.name, '默认工程');
    assert.equal(loaded.characters[0].name, '旧角色');
    assert.deepEqual(loaded.canvasItems, []);
    assert.deepEqual(loaded.edges, []);
    assert.deepEqual(loaded.groups, []);
    assert.deepEqual(loaded.viewport, { x: 40, y: 30, zoom: 1 });
  } finally {
    cleanup(dir);
  }
});

function storePathLegacy(dir) {
  return path.join(dir, 'winetoken_canvas_project.json');
}

test('CanvasProjectStore - 脏环境：旧工程文件损坏 / 结构非法时不崩溃且注册表保持空', () => {
  const dir = makeDir('legacy_corrupt');
  try {
    fs.writeFileSync(storePathLegacy(dir), 'not json at all', 'utf8');
    const store = new CanvasProjectStore(dir);
    assert.equal(store.ensureLegacyMigration(), false);
    assert.deepEqual(store.listProjects(), []);

    fs.writeFileSync(storePathLegacy(dir), JSON.stringify({ characters: 'not-array', panels: [] }), 'utf8');
    const store2 = new CanvasProjectStore(dir);
    assert.equal(store2.ensureLegacyMigration(), false);
    assert.deepEqual(store2.listProjects(), []);
  } finally {
    cleanup(dir);
  }
});

test('CanvasProjectStore - save/load 往返 + 物理回读强校验 + 写盘失败必须真实抛错', () => {
  const dir = makeDir('roundtrip');
  try {
    const store = new CanvasProjectStore(dir);
    const meta = store.createProject('往返工程');
    const data = store.loadProject(meta.id);
    data.panels.push({ id: 'shot_new', num: 9, prompt: '新分镜' });
    data.canvasItems.push({ id: 'i1', type: 'text', data: { text: '便签' } });
    assert.equal(store.saveProject(meta.id, data), true);
    const reloaded = store.loadProject(meta.id);
    assert.equal(reloaded.panels.some(p => p.id === 'shot_new'), true);
    assert.equal(reloaded.canvasItems[0].data.text, '便签');
    assert.equal(reloaded.name, '往返工程');
    assert.equal(reloaded.version, PROJECT_VERSION);

    // 注入回读篡改：物理回读强校验必须检出不一致并抛错，绝不假成功
    // 仅篡改工程文件本身的回读；注册表读取仍走真实文件，确保流程抵达回读校验点
    const originalRead = fs.readFileSync;
    const projectFile = store.projectFilePath(meta.id);
    fs.readFileSync = function (file, ...args) {
      if (typeof file === 'string' && file === projectFile) return '{"tampered":true}';
      return originalRead.call(fs, file, ...args);
    };
    try {
      assert.throws(() => store.saveProject(meta.id, data), /回读内容与写入不一致/);
    } finally {
      fs.readFileSync = originalRead;
    }

    assert.throws(() => store.loadProject('../evil'), /非法工程 id/);
    assert.throws(() => store.saveProject('ghost', {}), /不在注册表中/);
    assert.throws(() => store.loadProject('missing_but_valid'), /读取失败/);
  } finally {
    cleanup(dir);
  }
});

test('CanvasProjectStore - 真实写盘失败 (目录被文件占位) 向上抛错而非静默返回成功', () => {
  const dir = makeDir('write_fail');
  try {
    const store = new CanvasProjectStore(dir);
    const meta = store.createProject('故障演练');
    const projectsDir = path.join(dir, 'winetoken_projects');
    // 把整个工程目录替换成一个普通文件，模拟磁盘/权限故障
    for (const f of fs.readdirSync(projectsDir)) fs.rmSync(path.join(projectsDir, f), { recursive: true, force: true });
    fs.rmdirSync(projectsDir);
    fs.writeFileSync(projectsDir, 'blocked', 'utf8');
    assert.throws(() => store.saveProject(meta.id, store.loadProject(meta.id)), /ENOENT|ENOTDIR|失败|错误/);
    assert.throws(() => store.createProject('再建一个'), /ENOENT|ENOTDIR|失败|错误/);
  } finally {
    cleanup(dir);
  }
});
