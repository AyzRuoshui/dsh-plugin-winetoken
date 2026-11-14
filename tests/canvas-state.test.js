// -*- coding: utf-8 -*-
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  CanvasStateBridge,
  isValidId,
  cleanText,
  normalizeProject
} = require('../src/canvas-state.js');

function makeDir(tag) {
  const dir = path.join(__dirname, '..', '.tmp', 'test_canvas_state_' + tag + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}

function seedRegistry(dir, id = 'project_a', fileContent = null) {
  const projectsDir = path.join(dir, 'winetoken_projects');
  fs.mkdirSync(projectsDir, { recursive: true });
  fs.writeFileSync(path.join(projectsDir, 'index.json'), JSON.stringify({
    version: 1, activeId: id,
    projects: [{ id, name: '工程甲', createdAt: 1, updatedAt: 1 }], deleted: []
  }, null, 2), 'utf8');
  fs.writeFileSync(path.join(projectsDir, `${id}.json`), JSON.stringify(fileContent || {
    version: '2.3.0', characters: [{ id: 'c1', name: '楚云' }],
    panels: [{ id: 'p1', num: 1, x: 360, y: 60, prompt: '雨夜', characterId: 'c1', imageUrl: 'x.png' }],
    canvasItems: [], edges: [], groups: [],
    viewport: { x: 40, y: 30, zoom: 1 }, activeModel: 'model-a'
  }, null, 2), 'utf8');
}

test('CanvasStateBridge - 基础工具函数与脏数据归一化', () => {
  assert.equal(isValidId('project_01'), true);
  assert.equal(isValidId('../evil'), false);
  assert.equal(isValidId('a\u0000b'), false);
  assert.equal(cleanText('含\n换行', 100, ''), '含换行');
  assert.equal(cleanText('  ', 100, '兜底'), '兜底');
  assert.equal(cleanText('长'.repeat(9999), 4000, '').length, 4000);
  const norm = normalizeProject({ version: '2.0.0', characters: 'bad', panels: null });
  assert.deepEqual(norm.characters, []);
  assert.deepEqual(norm.panels, []);
  assert.deepEqual(norm.canvasItems, []);
  assert.deepEqual(norm.viewport, { x: 40, y: 30, zoom: 1 });
});

test('CanvasStateBridge - getStoryboard 读取激活工程并摘要化', () => {
  const dir = makeDir('storyboard');
  try {
    seedRegistry(dir);
    const bridge = new CanvasStateBridge(dir);
    const active = bridge.resolveActive();
    assert.equal(active.id, 'project_a');
    assert.equal(active.source, 'registry');
    const sb = bridge.getStoryboard();
    assert.equal(sb.totalPanels, 1);
    assert.equal(sb.panels[0].prompt, '雨夜');
    assert.equal(sb.panels[0].hasImage, true);
    assert.equal(sb.characters[0].name, '楚云');
    assert.equal(sb.activeModel, 'model-a');
    // 摘要不得携带凭据/大字段
    assert.equal(sb.projectId, 'project_a');
  } finally { cleanup(dir); }
});

test('CanvasStateBridge - 注册表损坏回退 .bak，双损坏回退空且不抛错', () => {
  const dir = makeDir('corrupt');
  try {
    seedRegistry(dir);
    const regPath = path.join(dir, 'winetoken_projects', 'index.json');
    fs.copyFileSync(regPath, regPath + '.bak');
    fs.writeFileSync(regPath, '{ broken', 'utf8');
    const bridge = new CanvasStateBridge(dir);
    assert.equal(bridge.resolveActive().id, 'project_a');
    fs.writeFileSync(regPath + '.bak', 'also broken', 'utf8');
    assert.equal(bridge._readRegistry().activeId, null);
  } finally { cleanup(dir); }
});

test('CanvasStateBridge - 旧单文件只读回退 (无注册表时) 且不改写原文件', () => {
  const dir = makeDir('legacy');
  try {
    const legacy = { version: '2.0.0', characters: [{ id: 'c1', name: '老角色' }], panels: [], viewport: { x: 1, y: 2, zoom: 1 } };
    const legacyPath = path.join(dir, 'winetoken_canvas_project.json');
    fs.writeFileSync(legacyPath, JSON.stringify(legacy, null, 2), 'utf8');
    const before = fs.readFileSync(legacyPath, 'utf8');
    const bridge = new CanvasStateBridge(dir);
    assert.equal(bridge.resolveActive().source, 'legacy');
    const sb = bridge.getStoryboard();
    assert.equal(sb.characters[0].name, '老角色');
    assert.equal(fs.readFileSync(legacyPath, 'utf8'), before);
  } finally { cleanup(dir); }
});

test('CanvasStateBridge - addPanel 增量追加 / 镜号续排 / 控制字符清洗 / 物理回读', () => {
  const dir = makeDir('addpanel');
  try {
    seedRegistry(dir);
    const bridge = new CanvasStateBridge(dir);
    const result = bridge.addPanel({
      prompt: '长街\n对峙', dialogue: '台词', shot: 'CU',
      characterId: 'c1', aspectRatio: '16:9'
    });
    assert.equal(result.panel.num, 2);
    assert.equal(result.panel.prompt, '长街对峙');
    assert.equal(result.panel.shotLabel, '特写');
    assert.equal(result.panel.aspectRatio, '16:9');
    assert.equal(result.panel.createdBy, 'tool');

    // 物理回读强校验: 磁盘上确实有 2 个分镜且新分镜可解析
    const disk = JSON.parse(fs.readFileSync(result.projectFile, 'utf8'));
    assert.equal(disk.panels.length, 2);
    assert.equal(disk.panels[1].prompt, '长街对峙');
    assert.ok(fs.existsSync(result.projectFile + '.bak'), '写入前必须留 .bak 双备份');

    // 连续追加镜号递增
    const second = bridge.addPanel({ prompt: '第二镜' });
    assert.equal(second.panel.num, 3);
  } finally { cleanup(dir); }
});

test('CanvasStateBridge - 破坏性契约: 激活工程文件缺失 / 工程 JSON 损坏 必须真实抛错', () => {
  const dir = makeDir('missing');
  try {
    const projectsDir = path.join(dir, 'winetoken_projects');
    fs.mkdirSync(projectsDir, { recursive: true });
    fs.writeFileSync(path.join(projectsDir, 'index.json'), JSON.stringify({
      activeId: 'project_ghost', projects: [{ id: 'project_ghost', name: '幽灵' }]
    }), 'utf8');
    const bridge = new CanvasStateBridge(dir);
    assert.throws(() => bridge.getStoryboard(), /文件缺失/);
    assert.throws(() => bridge.addPanel({ prompt: 'x' }), /文件缺失/);

    const dir2 = makeDir('badjson');
    try {
      seedRegistry(dir2);
      fs.writeFileSync(path.join(dir2, 'winetoken_projects', 'project_a.json'), '{ broken', 'utf8');
      assert.throws(() => new CanvasStateBridge(dir2).getStoryboard(), /读取失败/);
    } finally { cleanup(dir2); }
  } finally { cleanup(dir); }
});

test('CanvasStateBridge - 破坏性契约: 物理回读篡改必须检出并抛错，绝不假成功', () => {
  const dir = makeDir('tamper');
  try {
    seedRegistry(dir);
    const bridge = new CanvasStateBridge(dir);
    const projectFile = path.join(dir, 'winetoken_projects', 'project_a.json');
    const original = fs.readFileSync;
    fs.readFileSync = function (file, ...args) {
      if (typeof file === 'string' && file === projectFile) return '{"tampered":true}';
      return original.call(fs, file, ...args);
    };
    try {
      assert.throws(() => bridge.addPanel({ prompt: 'x' }), /回读内容与写入不一致/);
    } finally { fs.readFileSync = original; }
  } finally { cleanup(dir); }
});

test('CanvasStateBridge - enqueueGeneration 只写 WAL 存根，绝不发付费请求且不双花', () => {
  const dir = makeDir('enqueue');
  try {
    seedRegistry(dir);
    const bridge = new CanvasStateBridge(dir);
    // 全局 fetch 打桩: 一旦被调用立即失败，证明宿主桥不发包
    const originalFetch = global.fetch;
    let fetchCalls = 0;
    global.fetch = () => { fetchCalls++; return Promise.reject(new Error('宿主桥不应发包')); };
    try {
      const queued = bridge.enqueueGeneration({ panelId: 'p1', prompt: '雨夜', kind: 'image' });
      assert.equal(queued.status, 'queued');
      assert.equal(queued.dispatched, false);
      assert.match(queued.taskId, /^job_tool_/);
    } finally { global.fetch = originalFetch; }
    assert.equal(fetchCalls, 0, '宿主工具绝不直接发起付费生成请求');

    const tasks = JSON.parse(fs.readFileSync(bridge.tasksPath, 'utf8'));
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].status, 'pending');
    assert.equal(tasks[0].source, 'tool');
    assert.equal(tasks[0].prompt, '雨夜');

    // 二次入队追加而非覆盖
    bridge.enqueueGeneration({ panelId: 'p1', prompt: '第二镜', kind: 'video' });
    const tasks2 = JSON.parse(fs.readFileSync(bridge.tasksPath, 'utf8'));
    assert.equal(tasks2.length, 2);
    assert.equal(tasks2[1].kind, 'video');
  } finally { cleanup(dir); }
});

test('CanvasStateBridge - WAL 存根损坏时重建且如实告警，不静默吞错', () => {
  const dir = makeDir('waltamper');
  try {
    seedRegistry(dir);
    const bridge = new CanvasStateBridge(dir);
    fs.writeFileSync(bridge.tasksPath, 'not json', 'utf8');
    const queued = bridge.enqueueGeneration({ prompt: 'x' });
    assert.equal(queued.status, 'queued');
    const tasks = JSON.parse(fs.readFileSync(bridge.tasksPath, 'utf8'));
    assert.equal(tasks.length, 1);
  } finally { cleanup(dir); }
});

test('CanvasStateBridge - addPanel 分镜数达上限时拒绝追加 (防资产膨胀)', () => {
  const dir = makeDir('maxpanels');
  try {
    const many = Array.from({ length: 500 }, (_, i) => ({ id: 'p' + i, num: i + 1, x: 0, prompt: '' }));
    seedRegistry(dir, 'project_a', { characters: [], panels: many, canvasItems: [], edges: [], groups: [] });
    const bridge = new CanvasStateBridge(dir);
    assert.throws(() => bridge.addPanel({ prompt: 'x' }), /上限/);
  } finally { cleanup(dir); }
});
