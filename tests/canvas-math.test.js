// -*- coding: utf-8 -*-
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  snapToGrid,
  calculateBezierPath,
  isIntersectingAABB,
  measureAndWrapText
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
