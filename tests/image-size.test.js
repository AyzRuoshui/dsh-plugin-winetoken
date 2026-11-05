// -*- coding: utf-8 -*-
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveApiKey } = require('../src/credentials.js');

// 测试尺寸 32 倍数对齐算法 (针对商汤 sensenova-u1.5-lite 等报错的回归用例)
test('Image Size Normalization - 32 倍数智能对齐与边界约束', () => {
  // 提取 tool.js 中的逻辑进行断言验证
  function normalizeImageSize(size, model = '') {
    if (!size || typeof size !== 'string') return '1024x1024';
    const parts = size.toLowerCase().split('x');
    if (parts.length !== 2) return size;
    let w = parseInt(parts[0], 10);
    let h = parseInt(parts[1], 10);
    if (isNaN(w) || isNaN(h)) return size;

    if (w === 1280 && h === 720) return '1280x768';
    if (w === 720 && h === 1280) return '768x1280';

    w = Math.max(512, Math.min(4096, w));
    h = Math.max(512, Math.min(4096, h));

    if (w % 32 !== 0) w = Math.round(w / 32) * 32;
    if (h % 32 !== 0) h = Math.round(h / 32) * 32;

    return `${w}x${h}`;
  }

  // 1. 经典 1280x720 修复 (720 不是 32 倍数，校准为 1280x768，768/32=24)
  assert.equal(normalizeImageSize('1280x720'), '1280x768');
  assert.equal(normalizeImageSize('720x1280'), '768x1280');

  // 2. 原生 32 倍数保持不变
  assert.equal(normalizeImageSize('1024x1024'), '1024x1024');
  assert.equal(normalizeImageSize('1792x1024'), '1792x1024');

  // 3. 任意非法/奇数宽高四舍五入为 32 倍数
  const res1 = normalizeImageSize('1000x800');
  const [w1, h1] = res1.split('x').map(Number);
  assert.equal(w1 % 32, 0, '宽度必须是 32 的倍数');
  assert.equal(h1 % 32, 0, '高度必须是 32 的倍数');
});
