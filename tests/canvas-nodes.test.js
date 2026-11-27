// -*- coding: utf-8 -*-
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  NODE_TYPES,
  getNodeDefinition,
  listNodeTypes,
  listNodes,
  resolveEdgeEndpoint,
  collectUpstream,
  buildGenerationContext,
  normalizeNodeIds
} = require('../src/canvas-nodes.js');

test('CanvasNodes - 全量四数组投影：顺序/缺省尺寸/标题/ref/raw 原引用', () => {
  const project = {
    characters: [{ id: 'c1', name: '楚云', avatar: 'avatar.png' }],
    panels: [{ id: 'p1', num: 1, x: 10, y: 20, width: 300, height: 200, prompt: '基础', characterId: 'c1' }],
    canvasItems: [
      { id: 'i1', type: 'image', x: 5, y: 6, data: { url: 'http://img/a.png', prompt: '' } },
      { id: 'i2', type: 'text', data: { text: '便签内容' } }
    ],
    groups: [{ id: 'g1', name: '第一组' }]
  };
  const nodes = listNodes(project);
  assert.equal(nodes.length, 4 + 1);
  assert.deepEqual(nodes.map(n => n.id), ['c1', 'p1', 'i1', 'i2', 'g1']);
  assert.deepEqual(nodes.map(n => n.type), ['character', 'panel', 'image', 'text', 'group']);

  assert.equal(nodes[0].title, '楚云');
  assert.equal(nodes[0].x, 0);
  assert.equal(nodes[0].width, 240);
  assert.equal(nodes[0].height, 220);
  assert.deepEqual(nodes[0].ref, { type: 'character', id: 'c1' });
  assert.equal(nodes[0].raw, project.characters[0]);

  assert.equal(nodes[1].title, '分镜 #1');
  assert.equal(nodes[1].x, 10);
  assert.equal(nodes[1].width, 300);
  assert.deepEqual(nodes[1].ref, { type: 'panel', id: 'p1' });

  assert.equal(nodes[2].title, 'http://img/a.png');
  assert.equal(nodes[2].width, 240);
  assert.equal(nodes[2].height, 320);
  assert.deepEqual(nodes[2].ref, { type: 'item', id: 'i1' });

  assert.equal(nodes[3].title, '便签内容');
  assert.equal(nodes[3].height, 120);
  assert.deepEqual(nodes[3].ref, { type: 'item', id: 'i2' });

  assert.equal(nodes[4].title, '第一组');
  assert.equal(nodes[4].width, 400);
  assert.equal(nodes[4].height, 300);
  assert.deepEqual(nodes[4].ref, { type: 'group', id: 'g1' });

  assert.deepEqual(normalizeNodeIds(nodes).duplicates, []);
});

test('CanvasNodes - 缺数组 / null 条目 / 未知 item.type / NaN 坐标均安全降级', () => {
  assert.deepEqual(listNodes(null), []);
  assert.deepEqual(listNodes({}), []);
  const dirty = listNodes({
    characters: [null, { id: 'c1', name: '' }],
    panels: [null, { id: 'p1' }],
    canvasItems: [null, { id: 'i1', type: 'weird' }, { id: 'i2', type: 'text', data: null }],
    groups: [null, { id: 'g1' }]
  });
  assert.deepEqual(dirty.map(n => n.id), ['c1', 'p1', 'i1', 'i2', 'g1']);
  assert.equal(dirty[0].title, '未命名角色');
  assert.equal(dirty[1].title, '分镜 #?');
  assert.equal(dirty[2].type, 'image');
  assert.equal(dirty[3].title, '文本节点');

  const nanNodes = listNodes({ panels: [{ id: 'p', x: NaN, y: Infinity, width: NaN }] });
  assert.equal(nanNodes[0].x, 0);
  assert.equal(nanNodes[0].y, 0);
  assert.equal(nanNodes[0].width, 280);
});

test('CanvasNodes - NODE_TYPES 冻结 + 颜色可区分 + 辅助函数可用', () => {
  assert.ok(Object.isFrozen(NODE_TYPES));
  assert.ok(Object.isFrozen(NODE_TYPES.panel));
  const keys = listNodeTypes();
  assert.deepEqual(keys, ['panel', 'character', 'image', 'text', 'video', 'group']);
  const colors = keys.map(k => NODE_TYPES[k].minimapColor);
  keys.forEach(k => {
    assert.equal(typeof NODE_TYPES[k].label, 'string');
    assert.equal(typeof NODE_TYPES[k].kind, 'string');
    assert.equal(typeof NODE_TYPES[k].canGenerate, 'boolean');
    assert.match(NODE_TYPES[k].minimapColor, /^#[0-9a-fA-F]{6}$/);
  });
  assert.equal(new Set(colors).size, colors.length);
  NODE_TYPES.extra = 1; // 非严格模式下静默失败
  assert.equal(NODE_TYPES.extra, undefined);
  assert.equal(typeof NODE_TYPES.getNodeDefinition, 'function');
  assert.equal(typeof NODE_TYPES.listNodeTypes, 'function');
});

test('CanvasNodes - getNodeDefinition 未知类型/原型键返回安全默认', () => {
  assert.equal(getNodeDefinition('panel'), NODE_TYPES.panel);
  ['nope', '__proto__', 'constructor', 'prototype', 'toString', null, 123].forEach(t => {
    const def = getNodeDefinition(t);
    assert.equal(def.kind, 'unknown');
    assert.equal(def.canGenerate, false);
    assert.match(def.minimapColor, /^#[0-9a-fA-F]{6}$/);
  });
});

test('CanvasNodes - resolveEdgeEndpoint 裸字符串 / {id} / {type,id} / 空值', () => {
  const proj = {
    characters: [{ id: 'c1', name: '甲' }],
    panels: [{ id: 'p1', num: 1 }],
    canvasItems: [{ id: 'i1', type: 'image' }],
    groups: [{ id: 'g1', name: '组' }]
  };
  assert.deepEqual(resolveEdgeEndpoint('p1', proj), { type: 'panel', id: 'p1' });
  assert.deepEqual(resolveEdgeEndpoint({ id: 'i1' }, proj), { type: 'item', id: 'i1' });
  assert.deepEqual(resolveEdgeEndpoint({ type: 'character', id: 'c1' }, proj), { type: 'character', id: 'c1' });
  assert.deepEqual(resolveEdgeEndpoint({ type: 'item', id: 'i1' }, proj), { type: 'item', id: 'i1' });
  assert.deepEqual(resolveEdgeEndpoint({ type: 'group', id: 'g1' }, proj), { type: 'group', id: 'g1' });
  assert.deepEqual(resolveEdgeEndpoint({ nodeId: 'p1' }, proj), { type: 'panel', id: 'p1' });
  [null, undefined, NaN, {}, [], '', 0].forEach(v => {
    assert.equal(resolveEdgeEndpoint(v, proj), null);
  });
  assert.equal(resolveEdgeEndpoint('anything', null), null);
});

test('CanvasNodes - 悬空 id 返回 null 且生成上下文给出中文警告', () => {
  const proj = { panels: [{ id: 'p1', num: 1 }] };
  assert.equal(resolveEdgeEndpoint('ghost', proj), null);
  assert.equal(resolveEdgeEndpoint({ type: 'panel', id: 'ghost' }, proj), null);
  const dangling = {
    panels: [{ id: 'p1', num: 1, prompt: '基础' }],
    edges: [{ id: 'e1', from: { type: 'item', id: 'ghost' }, to: { type: 'panel', id: 'p1' } }]
  };
  assert.deepEqual(collectUpstream(dangling, 'p1'), []);
  const ctx = buildGenerationContext(dangling, 'p1');
  assert.equal(ctx.prompt, '基础');
  assert.deepEqual(ctx.referenceImages, []);
  assert.ok(ctx.warnings.some(w => w.includes('悬空')));
  assert.ok(ctx.warnings.every(w => typeof w === 'string'));
});

test('CanvasNodes - 自引用边被跳过并告警', () => {
  const self = {
    panels: [{ id: 'p1', num: 1, prompt: '基础' }],
    edges: [{ id: 'e1', from: { type: 'panel', id: 'p1' }, to: { type: 'panel', id: 'p1' } }]
  };
  assert.deepEqual(collectUpstream(self, 'p1'), []);
  assert.ok(buildGenerationContext(self, 'p1').warnings.some(w => w.includes('自引用')));
});

test('CanvasNodes - 重复边按首次出现顺序去重', () => {
  const dup = {
    canvasItems: [{ id: 't1', type: 'text', data: { text: '补充' } }],
    panels: [{ id: 'p1', num: 1, prompt: '基础' }],
    edges: [
      { id: 'e1', from: { type: 'item', id: 't1' }, to: { type: 'panel', id: 'p1' } },
      { id: 'e2', from: 't1', to: 'p1' },
      { id: 'e3', from: { id: 't1' }, to: { id: 'p1' } }
    ]
  };
  const up = collectUpstream(dup, 'p1');
  assert.equal(up.length, 1);
  assert.equal(up[0].node.id, 't1');
  assert.deepEqual(up[0].endpoint, { type: 'item', id: 't1' });
  assert.equal(buildGenerationContext(dup, 'p1').prompt, '基础，补充');
});

test('CanvasNodes - 环 A→B→A 只取一跳，不递归不挂起', () => {
  const cyc = {
    panels: [{ id: 'A', num: 1, prompt: 'A提示' }, { id: 'B', num: 2, prompt: 'B提示' }],
    edges: [
      { id: 'e1', from: { type: 'panel', id: 'A' }, to: { type: 'panel', id: 'B' } },
      { id: 'e2', from: { type: 'panel', id: 'B' }, to: { type: 'panel', id: 'A' } }
    ]
  };
  const upA = collectUpstream(cyc, 'A');
  assert.equal(upA.length, 1);
  assert.equal(upA[0].node.id, 'B');
  const upB = collectUpstream(cyc, 'B');
  assert.equal(upB.length, 1);
  assert.equal(upB[0].node.id, 'A');
});

test('CanvasNodes - 兼容上游 fromNodeId/toNodeId 与缺端点的脏边', () => {
  const upstreamStyle = {
    panels: [{ id: 'p1', num: 1, prompt: '基础' }],
    canvasItems: [{ id: 't1', type: 'text', data: { text: '上游便签' } }],
    edges: [{ id: 'e1', fromNodeId: 't1', toNodeId: 'p1' }]
  };
  assert.equal(collectUpstream(upstreamStyle, 'p1')[0].node.id, 't1');
  assert.equal(buildGenerationContext(upstreamStyle, 'p1').prompt, '基础，上游便签');
  assert.doesNotThrow(() => {
    buildGenerationContext({
      panels: [null, { id: 'p1', num: 1 }],
      edges: [null, {}, { from: NaN, to: NaN }, { from: { get id() { throw new Error('x'); } }, to: 'p1' }]
    }, 'p1');
  });
});

test('CanvasNodes - 生成上下文按顺序收集 文本/图片/角色头像 且去重', () => {
  const full = {
    characters: [{ id: 'c1', name: '楚云', avatar: 'CHAR_AVATAR' }],
    panels: [{ id: 'p1', num: 1, prompt: '基底提示词', characterId: 'c1' }],
    canvasItems: [
      { id: 't1', type: 'text', data: { text: '第一段补充' } },
      { id: 't2', type: 'text', data: { text: '第二段补充' } },
      { id: 't3', type: 'text', data: { text: '第一段补充' } },
      { id: 'im1', type: 'image', data: { url: 'IMG_URL_1', prompt: '图片提示词' } },
      { id: 'im2', type: 'image', data: { assetKey: 'KEY_2', prompt: '图片提示词' } }
    ],
    edges: [
      { id: 'e1', from: { type: 'item', id: 't1' }, to: { type: 'panel', id: 'p1' } },
      { id: 'e2', from: { type: 'item', id: 'im1' }, to: { type: 'panel', id: 'p1' } },
      { id: 'e3', from: { type: 'item', id: 't2' }, to: { type: 'panel', id: 'p1' } },
      { id: 'e4', from: { type: 'item', id: 'im2' }, to: { type: 'panel', id: 'p1' } },
      { id: 'e5', from: { type: 'item', id: 't3' }, to: { type: 'panel', id: 'p1' } }
    ]
  };
  const ctx = buildGenerationContext(full, 'p1');
  assert.equal(ctx.prompt, '基底提示词，第一段补充，第二段补充，图片提示词');
  assert.deepEqual(ctx.texts, ['第一段补充', '第二段补充']);
  assert.deepEqual(ctx.referenceImages, ['IMG_URL_1', 'asset:KEY_2', 'CHAR_AVATAR']);
  assert.deepEqual(ctx.params, {});
  assert.deepEqual(ctx.warnings, []);

  // avatar 与已有参考图完全相同时不重复追加
  const dupAvatar = buildGenerationContext({
    characters: [{ id: 'c1', name: '甲', avatar: 'IMG_URL_1' }],
    panels: [{ id: 'p1', num: 1, prompt: 'x', characterId: 'c1' }],
    canvasItems: [{ id: 'im1', type: 'image', data: { url: 'IMG_URL_1' } }],
    edges: [{ id: 'e1', from: { type: 'item', id: 'im1' }, to: { type: 'panel', id: 'p1' } }]
  }, 'p1');
  assert.deepEqual(dupAvatar.referenceImages, ['IMG_URL_1']);
});

test('CanvasNodes - prompt 上限 4000 字', () => {
  const ctx = buildGenerationContext({
    panels: [{ id: 'p1', num: 1, prompt: '长'.repeat(5000) }],
    edges: []
  }, 'p1');
  assert.equal(ctx.prompt.length, 4000);
  assert.ok(ctx.warnings.some(w => w.includes('4000')));
});

test('CanvasNodes - referenceImages 上限 9 张（视频模型再按各自能力裁剪）', () => {
  const items = [];
  const edges = [];
  for (let i = 0; i < 10; i++) {
    items.push({ id: `im${i}`, type: 'image', data: { url: `URL_${i}` } });
    edges.push({ id: `e${i}`, from: { type: 'item', id: `im${i}` }, to: { type: 'panel', id: 'p1' } });
  }
  const ctx = buildGenerationContext({
    panels: [{ id: 'p1', num: 1, prompt: 'x' }], canvasItems: items, edges
  }, 'p1');
  assert.equal(ctx.referenceImages.length, 9);
  assert.deepEqual(ctx.referenceImages, ['URL_0', 'URL_1', 'URL_2', 'URL_3', 'URL_4', 'URL_5', 'URL_6', 'URL_7', 'URL_8']);
  assert.ok(ctx.warnings.some(w => w.includes('9')));
});

test('CanvasNodes - params 白名单 + 后者覆盖 + 拒绝原型污染与非法类型', () => {
  // JSON.parse 会生成自有 __proto__ 键，正是典型的污染载荷
  const dirtyParams = JSON.parse('{"model":"m1","size":"1024x1024","aspectRatio":"1:1","shot":"CU","negativePrompt":"丑","count":3,"unknownKey":"DROP","__proto__":{"polluted":true},"constructor":"bad","prototype":"bad"}');
  const proj = {
    panels: [{ id: 'p1', num: 1, prompt: 'x' }],
    canvasItems: [
      { id: 'n1', type: 'text', data: { text: 'a', params: { model: 'old', count: 1, unknownKey: 'DROP' } } },
      { id: 'n2', type: 'text', data: { text: 'b', params: dirtyParams } }
    ],
    edges: [
      { id: 'e1', from: { type: 'item', id: 'n1' }, to: { type: 'panel', id: 'p1' } },
      { id: 'e2', from: { type: 'item', id: 'n2' }, to: { type: 'panel', id: 'p1' } }
    ]
  };
  const ctx = buildGenerationContext(proj, 'p1');
  assert.deepEqual(ctx.params, {
    model: 'm1', size: '1024x1024', aspectRatio: '1:1', shot: 'CU', negativePrompt: '丑', count: 3
  });
  assert.equal(ctx.params.unknownKey, undefined);
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(({}).polluted, undefined);

  const bad = buildGenerationContext({
    panels: [{ id: 'p1', num: 1, prompt: 'x' }],
    canvasItems: [{ id: 'n', type: 'text', data: { text: 'a', params: { model: 123, count: 'oops', negativePrompt: '长'.repeat(3000) } } }],
    edges: [{ id: 'e', from: { type: 'item', id: 'n' }, to: { type: 'panel', id: 'p1' } }]
  }, 'p1');
  assert.deepEqual(bad.params, {});
});

test('CanvasNodes - normalizeNodeIds 重复检测且为纯函数', () => {
  const rep = normalizeNodeIds([{ id: 'a' }, { id: 'b' }, { id: 'a' }, { id: 'c' }, { id: 'a' }, { id: 'b' }]);
  assert.deepEqual(rep.ids, ['a', 'b', 'a', 'c', 'a', 'b']);
  assert.deepEqual(rep.duplicates, ['a', 'b']);
  assert.deepEqual(normalizeNodeIds([]), { ids: [], duplicates: [] });
  assert.deepEqual(normalizeNodeIds(null), { ids: [], duplicates: [] });
  const input = [{ id: 'a' }];
  normalizeNodeIds(input);
  assert.deepEqual(input, [{ id: 'a' }]);
});
