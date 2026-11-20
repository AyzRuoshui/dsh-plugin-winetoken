// -*- coding: utf-8 -*-
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  CanvasProjectStore,
  PROJECT_VERSION
} = require('../src/canvas-project-store.js');

function makeDir(tag) {
  const dir = path.join(__dirname, '..', '.tmp', 'test_mig_' + tag + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}

test('CanvasMigrationContract - v2.2.0 旧工程打开自动无损迁移为 nodes/edges 结构', () => {
  const dir = makeDir('v22_migration');
  try {
    const store = new CanvasProjectStore(dir);
    // 模拟注册一个旧工程
    const meta = { id: 'p_legacy_1', name: '旧版神作', createdAt: 1000, updatedAt: 2000 };
    store._writeRegistry({ version: 1, activeId: meta.id, projects: [meta], deleted: [] });

    // 写入 v2.2.0 格式工程文件 (无 nodes/edges)
    const legacyProject = {
      version: '2.2.0',
      id: meta.id,
      name: meta.name,
      characters: [
        { id: 'char_01', name: '主角·楚云', dna: '少年剑客，黑袍银发', avatar: 'asset:chuyun_face.png', tags: ['主角'] }
      ],
      panels: [
        {
          id: 'shot_01',
          num: 1,
          x: 360,
          y: 60,
          width: 280,
          height: 420,
          aspectRatio: '2:3',
          shot: 'CU',
          shotLabel: '特写',
          prompt: '长街风雨，剑眉星目',
          dialogue: '“此剑已等三年。”',
          characterId: 'char_01',
          imageUrl: 'asset:shot_01.png',
          stagingCandidateUrl: null,
          candidates: ['asset:shot_01_alt.png'],
          status: 'idle',
          tags: ['开场']
        }
      ],
      canvasItems: [
        {
          id: 'item_img1',
          type: 'image',
          x: 700,
          y: 90,
          data: {
            url: 'asset:ref_sword.png',
            assetKey: 'ref_sword.png',
            prompt: '残破古剑',
            name: '古剑参考',
            params: { model: 'sensenova-u1.5-lite', aspectRatio: '16:9', quality: '2k', count: 2 }
          }
        },
        {
          id: 'item_vid1',
          type: 'video',
          x: 700,
          y: 400,
          data: {
            prompt: '拔剑挥击',
            params: { model: 'MiniMax-H3', duration: 10, resolution: '1080P', aspectRatio: '16:9', generateAudio: true }
          }
        },
        {
          id: 'item_txt1',
          type: 'text',
          x: 700,
          y: 650,
          data: { text: '暴雨夜，长街石板反光' }
        }
      ],
      groups: [
        { id: 'group_01', name: '雨夜交锋组', memberIds: ['shot_01', 'item_img1'], width: 680, height: 500 }
      ],
      edges: [
        { id: 'e_char_shot', from: { type: 'character', id: 'char_01' }, to: { type: 'panel', id: 'shot_01' } },
        { id: 'e_img_vid', from: { type: 'item', id: 'item_img1' }, to: { type: 'item', id: 'item_vid1' } }
      ],
      viewport: { x: 50, y: 40, zoom: 0.9 },
      activeModel: 'sensenova-u1.5-lite'
    };

    const filePath = store.projectFilePath(meta.id);
    const bakPath = filePath + '.bak';
    fs.writeFileSync(filePath, JSON.stringify(legacyProject, null, 2), 'utf8');

    // 打开工程触发无损自动迁移
    const loaded = store.loadProject(meta.id);

    // 契约断言 1：版本升级为 2.5.1
    assert.equal(loaded.version, '2.5.1');
    assert.equal(loaded.version, PROJECT_VERSION);

    // 契约断言 2：生成了 .bak 物理备份文件，且内容与原旧工程一致
    assert.ok(fs.existsSync(bakPath), '必须自动生成 .bak 物理备份');
    const bakContent = JSON.parse(fs.readFileSync(bakPath, 'utf8'));
    assert.equal(bakContent.version, '2.2.0');
    assert.equal(bakContent.characters[0].name, '主角·楚云');

    // 契约断言 3：React Flow nodes 数组无损包含全部 5 个节点
    assert.ok(Array.isArray(loaded.nodes), '必须包含 nodes 数组');
    assert.equal(loaded.nodes.length, 1 + 1 + 3 + 1); // char + panel + 3 items + group
    const charNode = loaded.nodes.find(n => n.id === 'char_01');
    assert.equal(charNode.type, 'characterNode');
    assert.equal(charNode.data.name, '主角·楚云');
    assert.equal(charNode.data.avatar, 'asset:chuyun_face.png');

    const panelNode = loaded.nodes.find(n => n.id === 'shot_01');
    assert.equal(panelNode.type, 'panelNode');
    assert.equal(panelNode.data.prompt, '长街风雨，剑眉星目');
    assert.equal(panelNode.data.dialogue, '“此剑已等三年。”');
    assert.equal(panelNode.data.characterId, 'char_01');
    assert.deepEqual(panelNode.data.candidates, ['asset:shot_01_alt.png']);

    const imgNode = loaded.nodes.find(n => n.id === 'item_img1');
    assert.equal(imgNode.type, 'imageNode');
    assert.equal(imgNode.data.params.quality, '2k');
    assert.equal(imgNode.data.params.count, 2);

    const vidNode = loaded.nodes.find(n => n.id === 'item_vid1');
    assert.equal(vidNode.type, 'videoNode');
    assert.equal(vidNode.data.params.duration, 10);
    assert.equal(vidNode.data.params.resolution, '1080P');
    assert.equal(vidNode.data.params.generateAudio, true);

    const txtNode = loaded.nodes.find(n => n.id === 'item_txt1');
    assert.equal(txtNode.type, 'textNode');
    assert.equal(txtNode.data.text, '暴雨夜，长街石板反光');

    const grpNode = loaded.nodes.find(n => n.id === 'group_01');
    assert.equal(grpNode.type, 'groupNode');
    assert.equal(grpNode.data.name, '雨夜交锋组');

    // 契约断言 4：边统一映射为 React Flow 标准边，type 为 default，禁止出现 bezier
    assert.ok(Array.isArray(loaded.edges));
    assert.equal(loaded.edges.length, 2);
    loaded.edges.forEach(e => {
      assert.ok(e.id && e.source && e.target);
      assert.equal(e.type, 'default', '边类型必须为 default');
      assert.notEqual(e.type, 'bezier', '不得出现 bezier 边');
    });

    // 契约断言 5：物理回读检查，落盘文件已是 2.5.1 格式且包含 nodes
    const onDisk = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    assert.equal(onDisk.version, '2.5.1');
    assert.ok(Array.isArray(onDisk.nodes));
    assert.equal(onDisk.nodes.length, loaded.nodes.length);
  } finally {
    cleanup(dir);
  }
});

test('CanvasMigrationContract - 脏数据（NaN坐标、缺字段、孤立边）降级与兜底能力', () => {
  const dir = makeDir('dirty_migration');
  try {
    const store = new CanvasProjectStore(dir);
    const meta = { id: 'p_dirty', name: '脏工程', createdAt: 1, updatedAt: 2 };
    store._writeRegistry({ version: 1, activeId: meta.id, projects: [meta], deleted: [] });

    const dirtyProject = {
      version: '2.0.0',
      id: meta.id,
      characters: [null, { id: 'c_nan', x: NaN, y: Infinity, name: 12345 }],
      panels: [null, { id: 'p_nan', num: 'bad', prompt: null, x: 'invalid' }],
      canvasItems: [null, { id: 'it_bad', type: 'unknown_type', data: null }],
      groups: [null, { id: 'grp_bad', width: NaN }],
      edges: [null, {}, { from: 'c_nan', to: null }, { from: null, to: 'p_nan' }, { id: 'e_ok', from: 'c_nan', to: 'p_nan' }],
      viewport: { x: NaN, y: 'bad', zoom: null }
    };

    const filePath = store.projectFilePath(meta.id);
    fs.writeFileSync(filePath, JSON.stringify(dirtyProject, null, 2), 'utf8');

    // 验证不崩溃，且脏数据被完全钳制/清洗
    const loaded = store.loadProject(meta.id);
    assert.equal(loaded.version, '2.5.1');
    assert.ok(Array.isArray(loaded.nodes));
    assert.ok(Array.isArray(loaded.edges));

    // 检查 NaN 坐标安全回退
    const cNode = loaded.nodes.find(n => n.id === 'c_nan');
    assert.ok(cNode);
    assert.ok(Number.isFinite(cNode.position.x));
    assert.ok(Number.isFinite(cNode.position.y));

    // 孤立边被安全跳过，只保留有效边
    assert.equal(loaded.edges.length, 1);
    assert.equal(loaded.edges[0].source, 'c_nan');
    assert.equal(loaded.edges[0].target, 'p_nan');
    assert.equal(loaded.edges[0].type, 'default');

    // 视口安全兜底
    assert.ok(Number.isFinite(loaded.viewport.x));
    assert.ok(Number.isFinite(loaded.viewport.y));
    assert.ok(Number.isFinite(loaded.viewport.zoom));
  } finally {
    cleanup(dir);
  }
});
