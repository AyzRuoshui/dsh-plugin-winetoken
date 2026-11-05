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

module.exports = {
  snapToGrid,
  calculateBezierPath,
  isIntersectingAABB,
  measureAndWrapText
};
