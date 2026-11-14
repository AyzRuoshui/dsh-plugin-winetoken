// -*- coding: utf-8 -*-
/**
 * WineToken 画布小地图 (MiniMap) 几何计算工具库
 * 参考 basketikun/infinite-canvas 的 canvas-mini-map.tsx 改写为纯函数、零依赖实现：
 * 汇总节点世界包围盒 -> 求等比缩放与居中偏移 -> 投影节点/视口矩形 -> 拖拽小地图反算视口。
 * 不读写 DOM、文件与全局状态，所有入参均做 NaN/Infinity/null 防御，可独立单测。
 */

/** 小地图默认参数（宽高、留白、缩放上下限） */
const MINIMAP_DEFAULTS = {
  width: 240,
  height: 160,
  padding: 500,
  minZoom: 0.05,
  maxZoom: 5
};

// 节点缺省尺寸、退化包围盒最小跨度、节点矩形最小可视像素
const DEFAULT_NODE_WIDTH = 280;
const DEFAULT_NODE_HEIGHT = 420;
const MIN_BOUNDS_SPAN = 1;
const MIN_RECT_SIZE = 2;

/** 仅接受有限数，否则回退到 fallback */
function finiteOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

/** 仅接受有限且为正的数，否则回退到 fallback */
function positiveFinite(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** 区间夹取，兼容正负 Infinity 与 NaN */
function clamp(value, lo, hi) {
  if (!Number.isFinite(value)) return value === Infinity ? hi : lo;
  return Math.min(Math.max(value, lo), hi);
}

/** 缩放归一化：脏值回退 1，并夹取到 [minZoom, maxZoom] */
function normalizeZoom(zoom) {
  return clamp(finiteOr(zoom, 1), MINIMAP_DEFAULTS.minZoom, MINIMAP_DEFAULTS.maxZoom);
}

/**
 * 归一化单个节点：过滤 null/非对象条目；尺寸缺失/NaN/负数回退缺省值；
 * 坐标缺失/NaN/Infinity 回退 0（负坐标是合法输入，原样保留）。
 * computeWorldBounds 与 computeNodeRects 共用，保证两处过滤规则完全一致。
 */
function normalizeNode(node) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return null;
  return {
    x: finiteOr(node.x, 0),
    y: finiteOr(node.y, 0),
    width: Number.isFinite(node.width) && node.width >= 0 ? node.width : DEFAULT_NODE_WIDTH,
    height: Number.isFinite(node.height) && node.height >= 0 ? node.height : DEFAULT_NODE_HEIGHT
  };
}

/** 由 min/max 生成自洽包围盒，强制宽高为有限正数，防止单点/零尺寸导致 scale 退化为 0/NaN/Infinity */
function finalizeBounds(minX, minY, maxX, maxY) {
  const left = finiteOr(minX, 0);
  const top = finiteOr(minY, 0);
  const width = positiveFinite(maxX - left, MIN_BOUNDS_SPAN);
  const height = positiveFinite(maxY - top, MIN_BOUNDS_SPAN);
  return {
    minX: left,
    minY: top,
    maxX: left + width,
    maxY: top + height,
    width,
    height
  };
}

/** 归一化变换对象：任何脏字段都降级为有限可用值，保证后续除法不产生 NaN/Infinity */
function normalizeTransform(transform) {
  const t = transform && typeof transform === 'object' ? transform : {};
  const mapWidth = positiveFinite(t.mapWidth, MINIMAP_DEFAULTS.width);
  const mapHeight = positiveFinite(t.mapHeight, MINIMAP_DEFAULTS.height);
  const fallbackScale = Math.min(mapWidth, mapHeight) / (2 * MINIMAP_DEFAULTS.padding);
  return {
    scale: positiveFinite(t.scale, fallbackScale),
    offsetX: finiteOr(t.offsetX, 0),
    offsetY: finiteOr(t.offsetY, 0),
    mapWidth,
    mapHeight
  };
}

/**
 * 把世界坐标两点投影成小地图像素矩形并夹取到地图内。
 * 尺寸按两角点间距取值并封顶到地图宽高，左上角再夹到 [0, mapWidth - width]，
 * 保证矩形整体不出界；minSize > 0 时保证极小节点至少保留该像素尺寸。
 */
function rectFromWorldPoints(p0, p1, t, minSize) {
  const left = Math.min(p0.x, p1.x);
  const top = Math.min(p0.y, p1.y);
  const rawW = finiteOr(Math.abs(p1.x - p0.x), 0);
  const rawH = finiteOr(Math.abs(p1.y - p0.y), 0);
  const width = Math.min(t.mapWidth, Math.max(rawW, minSize));
  const height = Math.min(t.mapHeight, Math.max(rawH, minSize));
  return {
    x: clamp(left, 0, Math.max(0, t.mapWidth - width)),
    y: clamp(top, 0, Math.max(0, t.mapHeight - height)),
    width,
    height
  };
}

/**
 * 计算所有节点的世界坐标包围盒并四向外扩留白。
 * @param {Array<{x,y,width,height}>} nodes 节点列表，null/非对象条目忽略
 * @param {number} padding 外扩像素，默认 500；非有限或负值回退默认值
 * @returns {{minX,minY,maxX,maxY,width,height}} 宽高恒为有限正数
 */
function computeWorldBounds(nodes, padding = MINIMAP_DEFAULTS.padding) {
  const pad = Number.isFinite(padding) && padding >= 0 ? padding : MINIMAP_DEFAULTS.padding;
  const list = Array.isArray(nodes) ? nodes : [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let count = 0;
  for (const raw of list) {
    const n = normalizeNode(raw);
    if (!n) continue;
    count++;
    if (n.x < minX) minX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.x + n.width > maxX) maxX = n.x + n.width;
    if (n.y + n.height > maxY) maxY = n.y + n.height;
  }
  // 无有效节点时返回以原点为中心的确定性默认包围盒
  if (count === 0) return finalizeBounds(-pad, -pad, pad, pad);
  return finalizeBounds(minX - pad, minY - pad, maxX + pad, maxY + pad);
}

/**
 * 由世界包围盒创建小地图缩放变换（等比缩放 + 居中偏移）。
 * scale = min(mapWidth/bounds.width, mapHeight/bounds.height)，offset 使内容在地图内居中。
 * @param {{minX,minY,width,height}} bounds 世界包围盒
 * @param {number} mapWidth 小地图宽（px），默认 240
 * @param {number} mapHeight 小地图高（px），默认 160
 * @returns {{scale,offsetX,offsetY,mapWidth,mapHeight,bounds}} scale 恒为有限正数
 */
function createMinimapTransform(bounds, mapWidth = MINIMAP_DEFAULTS.width, mapHeight = MINIMAP_DEFAULTS.height) {
  const mw = positiveFinite(mapWidth, MINIMAP_DEFAULTS.width);
  const mh = positiveFinite(mapHeight, MINIMAP_DEFAULTS.height);
  const src = bounds && typeof bounds === 'object' ? bounds : {};
  const bw = positiveFinite(src.width, 2 * MINIMAP_DEFAULTS.padding);
  const bh = positiveFinite(src.height, 2 * MINIMAP_DEFAULTS.padding);
  const minX = finiteOr(src.minX, 0);
  const minY = finiteOr(src.minY, 0);
  const fallbackScale = Math.min(mw, mh) / (2 * MINIMAP_DEFAULTS.padding);
  const scale = positiveFinite(Math.min(mw / bw, mh / bh), fallbackScale);
  const offsetX = finiteOr((mw - bw * scale) / 2 - minX * scale, 0);
  const offsetY = finiteOr((mh - bh * scale) / 2 - minY * scale, 0);
  // 原样回传包围盒引用便于调用方复核；脏入参则回退到空场景默认包围盒
  const safeBounds = bounds && typeof bounds === 'object' ? bounds : computeWorldBounds([]);
  return { scale, offsetX, offsetY, mapWidth: mw, mapHeight: mh, bounds: safeBounds };
}

/** 世界坐标 -> 小地图像素坐标（不做取整，保留浮点） */
function worldToMinimap(point, transform) {
  const t = normalizeTransform(transform);
  const src = point && typeof point === 'object' ? point : {};
  const x = finiteOr(src.x, 0) * t.scale + t.offsetX;
  const y = finiteOr(src.y, 0) * t.scale + t.offsetY;
  // 极端溢出时降级为有限值，正常入参下该守卫不会改变结果
  return { x: finiteOr(x, 0), y: finiteOr(y, 0) };
}

/** 小地图像素坐标 -> 世界坐标，worldToMinimap 的代数逆变换 */
function minimapToWorld(point, transform) {
  const t = normalizeTransform(transform);
  const src = point && typeof point === 'object' ? point : {};
  const x = (finiteOr(src.x, 0) - t.offsetX) / t.scale;
  const y = (finiteOr(src.y, 0) - t.offsetY) / t.scale;
  return { x: finiteOr(x, 0), y: finiteOr(y, 0) };
}

/**
 * 计算每个节点在小地图上的矩形：保持输入顺序，按同一规则跳过脏条目，
 * 夹取到地图范围内并保证至少 2px 可见。
 */
function computeNodeRects(nodes, transform) {
  const t = normalizeTransform(transform);
  const list = Array.isArray(nodes) ? nodes : [];
  const rects = [];
  for (const raw of list) {
    const n = normalizeNode(raw);
    if (!n) continue;
    const p0 = worldToMinimap({ x: n.x, y: n.y }, t);
    const p1 = worldToMinimap({ x: n.x + n.width, y: n.y + n.height }, t);
    rects.push(rectFromWorldPoints(p0, p1, t, MIN_RECT_SIZE));
  }
  return rects;
}

/**
 * 计算当前视口在世界中的可见矩形并投影/夹取到小地图。
 * DSH 约定 world = (screen - viewport.x) / zoom，故可见世界矩形左上角为
 * (-viewport.x/zoom, -viewport.y/zoom)，尺寸为 viewportSize/zoom。
 * 缩放超出 [minZoom, maxZoom] 时夹到边界，避免除零/溢出并与 minimapPanToViewport 一致。
 * 视口矩形不强制最小尺寸（高倍缩放下允许很薄）。
 */
function computeViewportRect(viewport, viewportSize, transform) {
  const t = normalizeTransform(transform);
  const v = viewport && typeof viewport === 'object' ? viewport : {};
  const vs = viewportSize && typeof viewportSize === 'object' ? viewportSize : {};
  const zoom = normalizeZoom(v.zoom);
  const sw = positiveFinite(vs.width, MINIMAP_DEFAULTS.width);
  const sh = positiveFinite(vs.height, MINIMAP_DEFAULTS.height);
  const worldX = -finiteOr(v.x, 0) / zoom;
  const worldY = -finiteOr(v.y, 0) / zoom;
  const worldW = sw / zoom;
  const worldH = sh / zoom;
  const p0 = worldToMinimap({ x: worldX, y: worldY }, t);
  const p1 = worldToMinimap({ x: worldX + worldW, y: worldY + worldH }, t);
  return rectFromWorldPoints(p0, p1, t, 0);
}

/**
 * 小地图拖拽/点击反算视口：把点击点还原成世界中心，令该世界点落在屏幕正中，
 * 即 x = viewportSize.width/2 - worldCenterX*zoom（y 同理），等价于上游的 recenter。
 * zoom 夹取到 [minZoom, maxZoom]。
 */
function minimapPanToViewport(minimapPoint, viewportSize, transform, zoom) {
  const t = normalizeTransform(transform);
  const vs = viewportSize && typeof viewportSize === 'object' ? viewportSize : {};
  const sw = positiveFinite(vs.width, MINIMAP_DEFAULTS.width);
  const sh = positiveFinite(vs.height, MINIMAP_DEFAULTS.height);
  const z = normalizeZoom(zoom);
  const world = minimapToWorld(minimapPoint, t);
  return {
    x: finiteOr(sw / 2 - world.x * z, 0),
    y: finiteOr(sh / 2 - world.y * z, 0),
    zoom: z
  };
}

module.exports = {
  MINIMAP_DEFAULTS,
  computeWorldBounds,
  createMinimapTransform,
  worldToMinimap,
  minimapToWorld,
  computeNodeRects,
  computeViewportRect,
  minimapPanToViewport
};
