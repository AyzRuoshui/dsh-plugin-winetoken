// -*- coding: utf-8 -*-
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MINIMAP_DEFAULTS,
  computeWorldBounds,
  createMinimapTransform,
  worldToMinimap,
  minimapToWorld,
  computeNodeRects,
  computeViewportRect,
  minimapPanToViewport
} = require('../src/canvas-minimap.js');

// 手工推导的精确包围盒：256×128，恰好给出 scale=0.9375 与 offset=(240,140)
const EXACT_BOUNDS = { minX: -256, minY: -128, maxX: 0, maxY: 0, width: 256, height: 128 };
const VS = { width: 800, height: 600 };

test('CanvasMiniMap - 默认参数与空节点确定性包围盒', () => {
  assert.equal(MINIMAP_DEFAULTS.width, 240);
  assert.equal(MINIMAP_DEFAULTS.height, 160);
  const b = computeWorldBounds([]);
  assert.deepEqual(b, { minX: -500, minY: -500, maxX: 500, maxY: 500, width: 1000, height: 1000 });
  for (const v of Object.values(b)) assert.ok(Number.isFinite(v));
  assert.deepEqual(computeWorldBounds(null), computeWorldBounds([]));
  assert.deepEqual(computeWorldBounds([null, 1, 'x', {}]), {
    minX: -500, minY: -500, maxX: 500 + 280, maxY: 500 + 420,
    width: 1000 + 280, height: 1000 + 420
  });
});

test('CanvasMiniMap - 负坐标 / 单零尺寸节点不产生零或 NaN scale', () => {
  const b = computeWorldBounds([
    { x: -1000, y: -500, width: 200, height: 100 },
    { x: 40, y: 80, width: 0, height: 0 }
  ], 0);
  assert.equal(b.minX, -1000);
  assert.equal(b.maxX, 40);
  assert.equal(b.width, 1040);
  const t = createMinimapTransform(b);
  assert.ok(t.scale > 0 && Number.isFinite(t.scale));

  const zero = computeWorldBounds([{ x: 10, y: 10, width: 0, height: 0 }], 0);
  assert.ok(zero.width > 0 && zero.height > 0);
  assert.ok(createMinimapTransform(zero).scale > 0);
});

test('CanvasMiniMap - 脏 padding / 脏节点尺寸安全降级', () => {
  for (const pad of [NaN, Infinity, -1, undefined, 'x']) {
    const b = computeWorldBounds([{ x: 0, y: 0, width: 10, height: 10 }], pad);
    assert.ok(b.width > 0 && b.height > 0);
    for (const v of Object.values(b)) assert.ok(Number.isFinite(v));
  }
  const dirty = computeWorldBounds([{ x: NaN, y: Infinity, width: NaN, height: -5 }], 0);
  for (const v of Object.values(dirty)) assert.ok(Number.isFinite(v));
});

test('CanvasMiniMap - 精确变换：scale 0.9375 与居中偏移 (240,140)', () => {
  const t = createMinimapTransform(EXACT_BOUNDS);
  assert.equal(t.scale, 0.9375);
  assert.equal(t.offsetX, 240);
  assert.equal(t.offsetY, 140);
  assert.equal(t.mapWidth, 240);
  assert.equal(t.mapHeight, 160);
  assert.deepEqual(worldToMinimap({ x: -256, y: -128 }, t), { x: 0, y: 20 });
  assert.deepEqual(worldToMinimap({ x: 0, y: 0 }, t), { x: 240, y: 140 });
});

test('CanvasMiniMap - worldToMinimap / minimapToWorld 往返恒等 (1e-9)', () => {
  const t = createMinimapTransform(computeWorldBounds([
    { x: -300, y: -200, width: 280, height: 420 },
    { x: 800, y: 600, width: 240, height: 320 }
  ]));
  for (const p of [{ x: 0, y: 0 }, { x: -123.5, y: 456.25 }, { x: 1e4, y: -1e4 }]) {
    const w = minimapToWorld(worldToMinimap(p, t), t);
    assert.ok(Math.abs(w.x - p.x) < 1e-9);
    assert.ok(Math.abs(w.y - p.y) < 1e-9);
  }
  // 脏变换与脏点全部有限
  for (const p of [null, { x: NaN, y: Infinity }, {}]) {
    const w = minimapToWorld(worldToMinimap(p, null), null);
    assert.ok(Number.isFinite(w.x) && Number.isFinite(w.y));
  }
});

test('CanvasMiniMap - computeNodeRects 保持顺序、夹取地图内、最小 2px', () => {
  const t = createMinimapTransform(EXACT_BOUNDS);
  const rects = computeNodeRects([
    null,
    { x: -256, y: -128, width: 100, height: 100 },
    { x: 1e9, y: 1e9, width: 10, height: 10 }
  ], t);
  assert.equal(rects.length, 2);
  for (const r of rects) {
    for (const v of Object.values(r)) assert.ok(Number.isFinite(v));
    assert.ok(r.width >= 2 && r.height >= 2);
    assert.ok(r.x >= 0 && r.y >= 0);
    assert.ok(r.x + r.width <= 240 + 1e-9 && r.y + r.height <= 160 + 1e-9);
  }
  assert.deepEqual(computeNodeRects([], t), []);
});

test('CanvasMiniMap - computeViewportRect 极端缩放与越界夹取', () => {
  const t = createMinimapTransform(EXACT_BOUNDS);
  const far = computeViewportRect({ x: 1000, y: 550, zoom: 0.05 }, VS, t);
  assert.deepEqual(far, { x: 0, y: 0, width: 240, height: 160 });

  const near = computeViewportRect({ x: 1000, y: 550, zoom: 5 }, VS, t);
  assert.deepEqual(near, { x: 52.5, y: 36.875, width: 150, height: 112.5 });
  assert.ok(near.x >= 0 && near.y >= 0);
  assert.ok(near.x + near.width <= 240 && near.y + near.height <= 160);

  for (const z of [0, -1, Infinity, NaN, -Infinity, 1e9]) {
    const r = computeViewportRect({ x: 0, y: 0, zoom: z }, VS, t);
    for (const v of Object.values(r)) assert.ok(Number.isFinite(v), `缩放 ${z} 下不得出现非有限值`);
    assert.ok(r.x >= 0 && r.y >= 0 && r.width <= 240 && r.height <= 160);
  }

  const dirty = computeViewportRect({ x: NaN, y: Infinity, zoom: NaN }, { width: NaN, height: -3 }, t);
  for (const v of Object.values(dirty)) assert.ok(Number.isFinite(v));
});

test('CanvasMiniMap - minimapPanToViewport 视口中心往返恒等', () => {
  const t = createMinimapTransform(EXACT_BOUNDS);
  const view = { x: 1000, y: 550, zoom: 5 };
  const rect = computeViewportRect(view, VS, t);
  const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  assert.deepEqual(center, { x: 127.5, y: 93.125 });
  const next = minimapPanToViewport(center, VS, t, view.zoom);
  assert.ok(Math.abs(next.x - view.x) < 1e-9, 'x 应回到原视口');
  assert.ok(Math.abs(next.y - view.y) < 1e-9, 'y 应回到原视口');
  assert.equal(next.zoom, view.zoom);
});

test('CanvasMiniMap - minimapPanToViewport 居中公式与缩放夹取', () => {
  const t = createMinimapTransform(EXACT_BOUNDS);
  const p = { x: 120, y: 80 };
  assert.deepEqual(minimapPanToViewport(p, VS, t, 1), { x: 528, y: 364, zoom: 1 });
  assert.equal(minimapPanToViewport(p, VS, t, 0.001).zoom, 0.05);
  assert.equal(minimapPanToViewport(p, VS, t, -5).zoom, 0.05);
  assert.equal(minimapPanToViewport(p, VS, t, 100).zoom, 5);
  assert.equal(minimapPanToViewport(p, VS, t, 2.5).zoom, 2.5);
  assert.equal(minimapPanToViewport(p, VS, t).zoom, 1);
  assert.equal(minimapPanToViewport(p, VS, t, NaN).zoom, 1);
  assert.equal(minimapPanToViewport(p, VS, t, Infinity).zoom, 1);

  const dirty = minimapPanToViewport({ x: NaN, y: Infinity }, { width: NaN, height: -1 }, null, NaN);
  for (const v of Object.values(dirty)) assert.ok(Number.isFinite(v));
  const dirty2 = minimapPanToViewport(null, VS, t, 1);
  for (const v of Object.values(dirty2)) assert.ok(Number.isFinite(v));
});

test('CanvasMiniMap - 超大坐标 (1e9) 全链路不溢出 Infinity', () => {
  const nodes = [
    { x: -1e9, y: -1e9, width: 280, height: 420 },
    { x: 1e9, y: 1e9, width: 280, height: 420 }
  ];
  const b = computeWorldBounds(nodes, 0);
  assert.equal(b.minX, -1e9);
  assert.equal(b.maxX, 1e9 + 280);
  assert.equal(b.width, 2e9 + 280);
  for (const v of Object.values(b)) assert.ok(Number.isFinite(v));

  const t = createMinimapTransform(b);
  assert.ok(Number.isFinite(t.scale) && t.scale > 0);
  assert.ok(Number.isFinite(t.offsetX) && Number.isFinite(t.offsetY));

  const p = { x: 1e9, y: -1e9 };
  const w = minimapToWorld(worldToMinimap(p, t), t);
  assert.ok(Number.isFinite(w.x) && Number.isFinite(w.y));
  assert.ok(Math.abs(w.x - p.x) < 1e-3 && Math.abs(w.y - p.y) < 1e-3);

  const rects = computeNodeRects(nodes, t);
  assert.equal(rects.length, 2);
  for (const r of rects) {
    for (const v of Object.values(r)) assert.ok(Number.isFinite(v));
    assert.ok(r.width >= 2 && r.height >= 2);
    assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.width <= 240 + 1e-9 && r.y + r.height <= 160 + 1e-9);
  }

  const vr = computeViewportRect({ x: 1e9, y: -1e9, zoom: 5 }, VS, t);
  for (const v of Object.values(vr)) assert.ok(Number.isFinite(v));
});
