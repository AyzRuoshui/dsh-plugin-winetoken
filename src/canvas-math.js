// -*- coding: utf-8 -*-
/**
 * WineToken 漫剧画布数学计算与图形排版工具库
 * 包含贝塞尔拓扑流线计算、网格磁吸对齐、AABB视口包围盒裁剪与条漫文本折行算法
 */

/**
 * 8px 磁吸网格对齐
 */
function snapToGrid(val, gridSize = 8) {
  return Math.round(val / gridSize) * gridSize;
}

/**
 * 计算两个分镜卡片或角色与分镜之间的三次贝塞尔拓扑流线控制点
 */
function calculateBezierPath(source, target) {
  const sx = source.x;
  const sy = source.y;
  const tx = target.x;
  const ty = target.y;

  const dx = Math.abs(tx - sx);
  // 水平延伸控制点距离，增强流线美感
  const curvature = Math.max(dx * 0.5, 60);

  const cp1x = sx + curvature;
  const cp1y = sy;
  const cp2x = tx - curvature;
  const cp2y = ty;

  return `M ${sx} ${sy} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${tx} ${ty}`;
}

/**
 * AABB (Axis-Aligned Bounding Box) 包围盒视口相交判定
 * 用于对超出视口屏幕外的分镜节点进行渲染剔除 (Virtualization)
 */
function isIntersectingAABB(boxA, boxB) {
  return (
    boxA.x < boxB.x + boxB.width &&
    boxA.x + boxA.width > boxB.x &&
    boxA.y < boxB.y + boxB.height &&
    boxA.y + boxA.height > boxB.y
  );
}

/**
 * 条漫长图导出对白文字自适应折行算法
 * 保证长文本对白根据气泡最大宽度精确断句，绝不穿透溢出
 */
function measureAndWrapText(text, maxWidth, charWidthEstimate = 14) {
  if (!text) return [];
  const lines = [];
  let currentLine = '';

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '\n') {
      lines.push(currentLine);
      currentLine = '';
      continue;
    }
    const testLine = currentLine + char;
    // 粗略估算宽度（中文字符约 1 个字宽，英文标点约 0.5 个字宽）
    let width = 0;
    for (let c of testLine) {
      width += c.charCodeAt(0) > 255 ? charWidthEstimate : charWidthEstimate * 0.55;
    }

    if (width > maxWidth && currentLine.length > 0) {
      lines.push(currentLine);
      currentLine = char;
    } else {
      currentLine = testLine;
    }
  }

  if (currentLine.length > 0) {
    lines.push(currentLine);
  }

  return lines;
}

/**
 * 拖拽对齐参考线计算 (CANVAS-M1 1.8)
 * 将移动卡片的左/中/右、上/中/下边缘与画布其余卡片的对应边缘比较，
 * 命中阈值 (默认 6px) 则输出最小吸附修正量与需要渲染的参考线集合
 * @param {object} moving 移动中卡片的世界坐标包围盒 {x, y, w, h} (已应用网格吸附)
 * @param {Array<{x,y,w,h}>} others 其余卡片包围盒
 * @param {number} threshold 吸附判定阈值 (px)
 * @returns {{dx: number, dy: number, guides: Array<{orientation:'v'|'h', pos:number}>}}
 */
function computeAlignGuides(moving, others, threshold = 6) {
  const result = { dx: 0, dy: 0, guides: [] };
  if (!moving || !Array.isArray(others) || others.length === 0) return result;

  const solveAxis = (isVertical) => {
    const mStart = isVertical ? moving.y : moving.x;
    const mSize = isVertical ? moving.h : moving.w;
    const mEdges = [mStart, mStart + mSize / 2, mStart + mSize];

    // 1. 找最小吸附修正量
    let bestDelta = null;
    let bestDist = threshold + 1;
    others.forEach(box => {
      const bStart = isVertical ? box.y : box.x;
      const bSize = isVertical ? box.h : box.w;
      const bEdges = [bStart, bStart + bSize / 2, bStart + bSize];
      bEdges.forEach(ref => {
        mEdges.forEach(edge => {
          const dist = Math.abs(ref - edge);
          if (dist <= threshold && dist < bestDist) {
            bestDist = dist;
            bestDelta = ref - edge;
          }
        });
      });
    });
    if (bestDelta === null) return;

    // 2. 收集吸附后所有命中的参考线 (可能多条同时对齐)
    const seen = new Set();
    others.forEach(box => {
      const bStart = isVertical ? box.y : box.x;
      const bSize = isVertical ? box.h : box.w;
      [bStart, bStart + bSize / 2, bStart + bSize].forEach(ref => {
        mEdges.forEach(edge => {
          if (Math.abs(ref - (edge + bestDelta)) <= 0.01) {
            const key = `${isVertical ? 'h' : 'v'}:${ref}`;
            if (!seen.has(key)) {
              seen.add(key);
              result.guides.push({ orientation: isVertical ? 'h' : 'v', pos: ref });
            }
          }
        });
      });
    });

    if (isVertical) result.dy = bestDelta;
    else result.dx = bestDelta;
  };

  solveAxis(false);
  solveAxis(true);
  return result;
}

/**
 * 智能节点间拓扑连线计算（吸收修正 2：常规右侧保持原有锚点视觉，仅跨象限自适应）
 * @param {{x: number, y: number, width: number, height: number}} sourceBox
 * @param {{x: number, y: number, width: number, height: number}} targetBox
 * @param {{defaultStartY?: number, defaultEndY?: number}} [options]
 * @returns {string} SVG 贝塞尔曲线指令路径
 */
function calculateSmartConnectionPath(sourceBox, targetBox, options = {}) {
  const sb = {
    x: typeof sourceBox?.x === 'number' && !Number.isNaN(sourceBox.x) ? sourceBox.x : 0,
    y: typeof sourceBox?.y === 'number' && !Number.isNaN(sourceBox.y) ? sourceBox.y : 0,
    width: typeof sourceBox?.width === 'number' && !Number.isNaN(sourceBox.width) ? sourceBox.width : 0,
    height: typeof sourceBox?.height === 'number' && !Number.isNaN(sourceBox.height) ? sourceBox.height : 0
  };
  const tb = {
    x: typeof targetBox?.x === 'number' && !Number.isNaN(targetBox.x) ? targetBox.x : 0,
    y: typeof targetBox?.y === 'number' && !Number.isNaN(targetBox.y) ? targetBox.y : 0,
    width: typeof targetBox?.width === 'number' && !Number.isNaN(targetBox.width) ? targetBox.width : 0,
    height: typeof targetBox?.height === 'number' && !Number.isNaN(targetBox.height) ? targetBox.height : 0
  };

  const sxRight = sb.x + sb.width;
  const txLeft = tb.x;

  // 常规情形（目标在源节点右侧）：严格保持 v2.4.0 现有口径与视觉
  if (txLeft >= sxRight - 20) {
    const startX = sxRight;
    const startY = typeof options.defaultStartY === 'number' && !Number.isNaN(options.defaultStartY)
      ? options.defaultStartY
      : sb.y + sb.height / 2;
    const endX = tb.x;
    const endY = typeof options.defaultEndY === 'number' && !Number.isNaN(options.defaultEndY)
      ? options.defaultEndY
      : tb.y + 30;
    const dx = endX - startX;
    const ctrlX1 = startX + dx * 0.5;
    const ctrlY1 = startY;
    const ctrlX2 = startX + dx * 0.5;
    const ctrlY2 = endY;
    return `M ${startX} ${startY} C ${ctrlX1} ${ctrlY1}, ${ctrlX2} ${ctrlY2}, ${endX} ${endY}`;
  }

  // 跨象限情形：目标卡移动到上方、下方或左侧
  const scx = sb.x + sb.width / 2;
  const scy = sb.y + sb.height / 2;
  const tcx = tb.x + tb.width / 2;
  const tcy = tb.y + tb.height / 2;
  const dx = tcx - scx;
  const dy = tcy - scy;

  let sourceAnchor, targetAnchor, cp1, cp2;

  // 垂直主导关系（上方或下方）
  if (Math.abs(dy) > Math.abs(dx)) {
    if (dy < 0) {
      // 目标在上方：源节点顶边 -> 目标节点底边
      sourceAnchor = { x: scx, y: sb.y };
      targetAnchor = { x: tcx, y: tb.y + tb.height };
      const dist = Math.max(Math.abs(dy) * 0.5, 40);
      cp1 = { x: sourceAnchor.x, y: sourceAnchor.y - dist };
      cp2 = { x: targetAnchor.x, y: targetAnchor.y + dist };
    } else {
      // 目标在下方：源节点底边 -> 目标节点顶边
      sourceAnchor = { x: scx, y: sb.y + sb.height };
      targetAnchor = { x: tcx, y: tb.y };
      const dist = Math.max(Math.abs(dy) * 0.5, 40);
      cp1 = { x: sourceAnchor.x, y: sourceAnchor.y + dist };
      cp2 = { x: targetAnchor.x, y: targetAnchor.y - dist };
    }
  } else {
    // 水平反向（目标在左方）
    sourceAnchor = { x: sb.x, y: scy };
    targetAnchor = { x: tb.x + tb.width, y: tcy };
    const dist = Math.max(Math.abs(dx) * 0.5, 40);
    cp1 = { x: sourceAnchor.x - dist, y: sourceAnchor.y };
    cp2 = { x: targetAnchor.x + dist, y: targetAnchor.y };
  }

  return `M ${sourceAnchor.x} ${sourceAnchor.y} C ${cp1.x} ${cp1.y}, ${cp2.x} ${cp2.y}, ${targetAnchor.x} ${targetAnchor.y}`;
}

/**
 * 节点锚点定位 (CANVAS-M2 2.3)
 * 返回节点 AABB 指定边的中点世界坐标，供连线端点实时贴合节点边缘
 * @param {object} node {x, y, width, height}
 * @param {'left'|'right'|'top'|'bottom'} side
 * @returns {{x: number, y: number}}
 */
function anchorFor(node, side = 'right') {
  const n = node || {};
  const x = typeof n.x === 'number' && !Number.isNaN(n.x) ? n.x : 0;
  const y = typeof n.y === 'number' && !Number.isNaN(n.y) ? n.y : 0;
  const w = typeof n.width === 'number' && !Number.isNaN(n.width) ? n.width : 0;
  const h = typeof n.height === 'number' && !Number.isNaN(n.height) ? n.height : 0;
  const cx = x + w / 2;
  const cy = y + h / 2;
  switch (side) {
    case 'left': return { x, y: cy };
    case 'top': return { x: cx, y };
    case 'bottom': return { x: cx, y: y + h };
    case 'right':
    default: return { x: x + w, y: cy };
  }
}

/**
 * 整理画布自动布局 (CANVAS-M3 3.2)
 * 分镜按组分波段、按镜号排序横向排列；未分组分镜随后；通用节点最后单独成行。
 * 纯函数，返回位移清单，不直接改状态。
 * @param {Array} panels 分镜卡
 * @param {Array} canvasItems 通用节点 (图片/文本)
 * @param {Array} groups 组列表
 * @returns {{panelMoves: Array<{id,x,y}>, itemMoves: Array<{id,x,y}>}}
 */
function layoutCanvas(panels, canvasItems, groups) {
  const START_X = 360;
  const START_Y = 60;
  const GAP = 40;
  const panelMoves = [];
  const itemMoves = [];
  const groupOf = new Map();
  (groups || []).forEach((g, gi) => {
    (g.memberIds || []).forEach(id => {
      if (!groupOf.has(id)) groupOf.set(id, gi);
    });
  });

  let cursorY = START_Y;

  const layBand = (nodes, defaultW, defaultH, sink) => {
    if (!nodes.length) return;
    let cursorX = START_X;
    let bandH = 0;
    nodes.forEach(n => {
      const w = n.width || defaultW;
      const h = n.height || defaultH;
      sink.push({ id: n.id, x: cursorX, y: cursorY });
      cursorX += w + GAP;
      bandH = Math.max(bandH, h);
    });
    cursorY += bandH + GAP;
  };

  // 1. 分镜组波段 (按组序, 组内按镜号)
  (groups || []).forEach((g, gi) => {
    const members = (panels || [])
      .filter(p => groupOf.get(p.id) === gi)
      .slice()
      .sort((a, b) => (a.num || 0) - (b.num || 0));
    layBand(members, 280, 420, panelMoves);
  });

  // 2. 未分组分镜波段 (按镜号)
  const loosePanels = (panels || [])
    .filter(p => !groupOf.has(p.id))
    .slice()
    .sort((a, b) => (a.num || 0) - (b.num || 0));
  layBand(loosePanels, 280, 420, panelMoves);

  // 3. 通用节点波段 (按创建序)
  const looseItems = (canvasItems || []).slice()
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  layBand(looseItems, 240, 320, itemMoves);

  return { panelMoves, itemMoves };
}

/**
 * AI 拆镜输出解析 (CANVAS-M4 客户端部分)
 * 从大模型返回文本中稳健提取分镜 JSON 数组：剥离 markdown 围栏、截取首尾方括号
 * (容忍模型在 JSON 前后的寒暄)、逐项校验归一化，单条脏数据降级跳过而不整体失败。
 * 纯函数，零网络依赖，可独立单测。
 * @param {string} raw 模型原始返回文本
 * @returns {Array<{shot:string, shotLabel:string, prompt:string, dialogue:string}>}
 */
function parseStoryboardJSON(raw) {
  if (!raw || typeof raw !== 'string') return [];
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence) text = fence[1].trim();
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return [];
  let arr;
  try {
    arr = JSON.parse(text.slice(start, end + 1));
  } catch (_) {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const validShots = ['CU', 'MS', 'WS', 'FS'];
  const defaultLabels = { CU: '特写', MS: '中景', WS: '远景', FS: '全景' };
  return arr
    .filter(item => item && typeof item === 'object' && !Array.isArray(item))
    .map(item => {
      const shot = String(item.shot || 'MS').toUpperCase();
      return {
        shot: validShots.includes(shot) ? shot : 'MS',
        shotLabel: String(item.shotLabel || '').trim() || (defaultLabels[shot] || '中景'),
        prompt: String(item.prompt || item.description || '').trim(),
        dialogue: String(item.dialogue || item.line || '').trim()
      };
    })
    .filter(item => item.prompt.length > 0);
}

module.exports = {
  snapToGrid,
  calculateBezierPath,
  calculateSmartConnectionPath,
  isIntersectingAABB,
  measureAndWrapText,
  computeAlignGuides,
  anchorFor,
  layoutCanvas,
  parseStoryboardJSON
};
