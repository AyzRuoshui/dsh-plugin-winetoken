// -*- coding: utf-8 -*-
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  snapToGrid,
  calculateBezierPath,
  isIntersectingAABB,
  measureAndWrapText,
  computeAlignGuides,
  anchorFor,
  layoutCanvas,
  parseStoryboardJSON
} = require('../src/canvas-math.js');

test('CanvasMath - snapToGrid 8px 对齐', () => {
  assert.equal(snapToGrid(0), 0);
  assert.equal(snapToGrid(4), 8);
  assert.equal(snapToGrid(3), 0);
  assert.equal(snapToGrid(15), 16);
  assert.equal(snapToGrid(103), 104);
});

test('CanvasMath - calculateBezierPath 三次贝塞尔路径生成', () => {
  const p1 = { x: 100, y: 100 };
  const p2 = { x: 300, y: 200 };
  const path = calculateBezierPath(p1, p2);
  assert.match(path, /^M 100 100 C \d+ 100, \d+ 200, 300 200$/);
});

test('CanvasMath - isIntersectingAABB 视口相交判定', () => {
  const view = { x: 0, y: 0, width: 800, height: 600 };
  const inside = { x: 100, y: 100, width: 200, height: 200 };
  const outside = { x: 1000, y: 1000, width: 100, height: 100 };
  assert.equal(isIntersectingAABB(view, inside), true);
  assert.equal(isIntersectingAABB(view, outside), false);
});

test('CanvasMath - measureAndWrapText 长台词自适应折行', () => {
  const shortText = '短句不折行';
  const shortLines = measureAndWrapText(shortText, 200);
  assert.equal(shortLines.length, 1);
  assert.equal(shortLines[0], '短句不折行');

  const longText = '这是一个非常非常长的台词对白，如果不折行肯定会直接穿透气泡矩形边缘导致极其难看的视觉重叠瑕疵。';
  const longLines = measureAndWrapText(longText, 100, 14);
  assert.ok(longLines.length > 1, '长文本必须自动折为多行');
});

test('CanvasMath - computeAlignGuides 边缘对齐吸附与参考线', () => {
  // 左缘距邻卡左缘 3px (阈值内): 吸附 dx=3, 且吸附后左/中/右三线同时对齐
  const moving = { x: 357, y: 100, w: 280, h: 420 };
  const others = [{ x: 360, y: 60, w: 280, h: 420 }];
  const res = computeAlignGuides(moving, others, 6);
  assert.equal(res.dx, 3);
  assert.equal(res.dy, 0);
  assert.equal(res.guides.filter(g => g.orientation === 'v').length, 3);
});

test('CanvasMath - computeAlignGuides 阈值外不吸附', () => {
  // 所有边缘均远离邻卡 (最近也有 140px): 不产生吸附与参考线
  const res = computeAlignGuides(
    { x: 800, y: 900, w: 280, h: 420 },
    [{ x: 360, y: 60, w: 280, h: 420 }],
    6
  );
  assert.equal(res.dx, 0);
  assert.equal(res.dy, 0);
  assert.deepEqual(res.guides, []);
});

test('CanvasMath - computeAlignGuides 垂直对齐输出水平参考线', () => {
  // 上缘 203 距邻卡上缘 200 为 3px, 应输出 dy=-3 的吸附与 h 向参考线
  const res = computeAlignGuides(
    { x: 0, y: 203, w: 280, h: 420 },
    [{ x: 100, y: 200, w: 280, h: 420 }],
    6
  );
  assert.equal(res.dy, -3);
  assert.ok(res.guides.some(g => g.orientation === 'h'));
});

test('CanvasMath - anchorFor 节点四边锚点定位', () => {
  const node = { x: 100, y: 200, width: 280, height: 420 };
  assert.deepEqual(anchorFor(node, 'right'), { x: 380, y: 410 });
  assert.deepEqual(anchorFor(node, 'left'), { x: 100, y: 410 });
  assert.deepEqual(anchorFor(node, 'top'), { x: 240, y: 200 });
  assert.deepEqual(anchorFor(node, 'bottom'), { x: 240, y: 620 });
  // 缺省右边; 缺尺寸回退 (0,0) 原点
  assert.deepEqual(anchorFor(node), { x: 380, y: 410 });
  assert.deepEqual(anchorFor({ x: 50, y: 60 }), { x: 50, y: 60 });
});

test('CanvasMath - layoutCanvas 组波段按镜号排序且互不重叠', () => {
  const panels = [
    { id: 'a', num: 2, x: 999, y: 999, width: 280, height: 420 },
    { id: 'b', num: 1, x: 0, y: 0, width: 280, height: 420 },
    { id: 'c', num: 9, x: 50, y: 50, width: 280, height: 420 }
  ];
  const groups = [{ id: 'g1', name: '组1', memberIds: ['a', 'b'] }];
  const { panelMoves, itemMoves } = layoutCanvas(panels, [], groups);
  // 组1 成员按镜号: b(1) 在 a(2) 前面
  const mA = panelMoves.find(m => m.id === 'a');
  const mB = panelMoves.find(m => m.id === 'b');
  assert.ok(mB.x < mA.x, '镜号 1 应排在镜号 2 左侧');
  // 未分组的 c 独占下一波段, y 更大
  const mC = panelMoves.find(m => m.id === 'c');
  assert.ok(mC.y > mA.y, '未分组波段应在组波段下方');
  // 全部从 360 起排, 与角色列 (40~260) 不重叠
  assert.equal(mB.x, 360);
  assert.equal(mC.x, 360);
  assert.equal(itemMoves.length, 0);
});

test('CanvasMath - layoutCanvas 通用节点独立成行', () => {
  const items = [
    { id: 'i1', type: 'image', x: 10, y: 10, width: 240, height: 320, createdAt: 2 },
    { id: 'i2', type: 'text', x: 20, y: 20, width: 220, height: 140, createdAt: 1 }
  ];
  const { itemMoves } = layoutCanvas([], items, []);
  const mi2 = itemMoves.find(m => m.id === 'i2');
  const mi1 = itemMoves.find(m => m.id === 'i1');
  assert.ok(mi2.x < mi1.x, '按创建序排列');
  assert.equal(mi2.x, 360);
});

test('CanvasMath - parseStoryboardJSON 剥离围栏与寒暄并归一化', () => {
  const raw = '好的，以下是拆解结果：\n```json\n' + JSON.stringify([
    { shot: 'cu', shotLabel: '', prompt: '少年面部特写，冷峻眼神', dialogue: '"这一剑，我已等了三年。"' },
    { description: '雨夜长街全景，寒光泛起' },
    { shot: 'XX', prompt: '', dialogue: '无提示词应跳过' },
    '脏数据字符串'
  ]) + '\n```\n希望对你有帮助';
  const shots = parseStoryboardJSON(raw);
  assert.equal(shots.length, 2);
  assert.equal(shots[0].shot, 'CU');
  assert.equal(shots[0].shotLabel, '特写');
  assert.equal(shots[1].shot, 'MS');
  assert.equal(shots[1].prompt, '雨夜长街全景，寒光泛起');
});

test('CanvasMath - parseStoryboardJSON 脏输出安全降级', () => {
  assert.deepEqual(parseStoryboardJSON(''), []);
  assert.deepEqual(parseStoryboardJSON(null), []);
  assert.deepEqual(parseStoryboardJSON('模型开始胡言乱语，没有 JSON'), []);
  assert.deepEqual(parseStoryboardJSON('{"shot":"CU"}'), []);
  assert.deepEqual(parseStoryboardJSON('[{"shot":"CU","prompt":"合法分镜"}]').length, 1);
});
