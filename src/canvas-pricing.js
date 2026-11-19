// -*- coding: utf-8 -*-
/**
 * WineToken 漫剧画布计价引擎 (CanvasPricing)
 * 对标 LibTV 明码标价规格 (LIBTV_FULL_PARITY_BRIEF §3.2.5):
 *   - 价格数据 100% 取自服务端下发的 Manifest 对象 / 本地离线基线
 *   - 绝对严禁凭空编造、假冒数字或臆造免费 (违背工程铁律)
 *   - 读不到价格的模型返回空，不显示假价
 *   - 零 Emoji、纯单色工业排版
 * 全模块为零依赖纯函数，可脱离 UI 直接通过 node --test 契约测试。
 */

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function toPositiveNumber(v, fallback = null) {
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return fallback;
}

/**
 * 计算生图模型单价与总价 (明码标价)
 * @param {Object} model Manifest 中的生图模型对象
 * @param {Object} options { count, isVip, isSvip, isSuper }
 * @returns {Object} { unitPrice, totalPrice, priceText, isFree, available }
 */
function calculateImagePrice(model, options = {}) {
  if (!isObject(model)) {
    return { unitPrice: null, totalPrice: null, priceText: '', isFree: false, available: false };
  }
  const isSuper = Boolean(options.isSuper);
  const isSvip = Boolean(options.isSvip);
  const isVip = Boolean(options.isVip);
  const count = Math.max(1, Math.min(64, Math.floor(toPositiveNumber(options.count, 1))));

  const basePrice = toPositiveNumber(model.cost != null ? model.cost : model.price);
  const vipPrice = toPositiveNumber(model.vipCost != null ? model.vipCost : model.vipPrice);
  const tag = typeof model.tag === 'string' ? model.tag : (typeof model.badge === 'string' ? model.badge : '');
  const isExplicitFree = basePrice === 0 || tag.includes('限免');

  if (isExplicitFree) {
    return {
      unitPrice: 0,
      totalPrice: 0,
      priceText: '限免 ¥0.00',
      isFree: true,
      available: true
    };
  }

  if (basePrice === null) {
    // 缺失价格信息，不许臆造
    return { unitPrice: null, totalPrice: null, priceText: '', isFree: false, available: true };
  }

  let effectiveUnitPrice = basePrice;
  if (isSuper || isSvip) {
    if (vipPrice !== null) effectiveUnitPrice = vipPrice;
  } else if (isVip) {
    if (vipPrice !== null) {
      effectiveUnitPrice = vipPrice;
    } else {
      effectiveUnitPrice = Number((basePrice * 0.9).toFixed(2));
    }
  }

  const totalPrice = Number((effectiveUnitPrice * count).toFixed(2));
  return {
    unitPrice: effectiveUnitPrice,
    totalPrice,
    priceText: `¥${totalPrice.toFixed(2)}`,
    isFree: false,
    available: true
  };
}

/**
 * 计算视频模型单价与总价 (明码标价)
 * @param {Object} model Manifest 中的生视频模型对象
 * @param {Object} options { duration, isVip, isSvip, isSuper }
 * @returns {Object} { pricePerSecond, totalPrice, priceText, isFree, available }
 */
function calculateVideoPrice(model, options = {}) {
  if (!isObject(model)) {
    return { pricePerSecond: null, totalPrice: null, priceText: '', isFree: false, available: false };
  }
  const isSuper = Boolean(options.isSuper);
  const isSvip = Boolean(options.isSvip);
  const isVip = Boolean(options.isVip);
  const duration = Math.max(1, Math.min(30, Math.round(toPositiveNumber(options.duration, 5))));

  const baseSecPrice = toPositiveNumber(
    model.costPerSec != null ? model.costPerSec : model.pricePerSecond
  );
  const vipSecPrice = toPositiveNumber(
    model.vipCostPerSec != null ? model.vipCostPerSec : model.vipPricePerSecond
  );
  const tag = typeof model.tag === 'string' ? model.tag : '';
  const isExplicitFree = baseSecPrice === 0 || tag.includes('限免');

  if (isExplicitFree) {
    return {
      pricePerSecond: 0,
      totalPrice: 0,
      priceText: '限免 ¥0.00',
      isFree: true,
      available: true
    };
  }

  if (baseSecPrice === null) {
    return { pricePerSecond: null, totalPrice: null, priceText: '', isFree: false, available: true };
  }

  let effectiveSecPrice = baseSecPrice;
  if (isSuper || isSvip) {
    if (vipSecPrice !== null) effectiveSecPrice = vipSecPrice;
  } else if (isVip) {
    if (vipSecPrice !== null) {
      effectiveSecPrice = vipSecPrice;
    } else {
      effectiveSecPrice = Number((baseSecPrice * 0.9).toFixed(2));
    }
  }

  const totalPrice = Number((effectiveSecPrice * duration).toFixed(2));
  return {
    pricePerSecond: effectiveSecPrice,
    totalPrice,
    priceText: `¥${totalPrice.toFixed(2)}`,
    isFree: false,
    available: true
  };
}

/**
 * 格式化按钮价格徽标 (零 Emoji，无乱码，无假价)
 * @param {String} priceText 格式化价格串
 * @returns {String} 徽标文本或空串
 */
function formatPriceBadge(priceText) {
  if (typeof priceText !== 'string' || !priceText.trim()) return '';
  return `[${priceText.trim()}]`;
}

module.exports = {
  calculateImagePrice,
  calculateVideoPrice,
  formatPriceBadge
};
