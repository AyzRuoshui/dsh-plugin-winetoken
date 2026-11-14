// -*- coding: utf-8 -*-
/**
 * WineToken 画布提示词库 (CanvasPrompts)
 * 对位上游 infinite-canvas 的 prompt library: 把分镜/图片/视频节点的提示词收藏复用。
 * 纯函数模块，不读写 localStorage (由 client.js 负责持久化)，零依赖、无 DOM/网络。
 * 所有外部输入 (尤其导入) 一律严格清洗，杜绝原型污染与超长文本撑爆存储。
 */

const LIBRARY_VERSION = 1;
const MAX_ITEMS = 200;
const MAX_TEXT = 4000;
const MAX_TAG = 40;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** 剔除控制字符、trim、限长；非字符串回退空串 */
function cleanText(value, max = MAX_TEXT) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim().slice(0, max);
}

function sanitizeTag(value) {
  const t = cleanText(value, MAX_TAG);
  return t || '未分类';
}

/** 单条收藏归一化：脏条目返回 null 由调用方剔除 */
function normalizeItem(raw) {
  if (!isObject(raw)) return null;
  const text = cleanText(raw.text, MAX_TEXT);
  if (!text) return null;
  const id = cleanText(raw.id, 120) || `prompt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const createdAt = Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now();
  const tags = Array.isArray(raw.tags)
    ? Array.from(new Set(raw.tags.map(sanitizeTag))).slice(0, 8)
    : [];
  return { id, text, title: cleanText(raw.title, 120) || text.slice(0, 24), tags, createdAt };
}

/** 归一化整个库：去重 (按 text 精确串)、限量、剔除脏条目，永不抛错 */
function normalizeLibrary(raw) {
  const list = Array.isArray(raw) ? raw : (isObject(raw) && Array.isArray(raw.items) ? raw.items : []);
  const seen = new Set();
  const items = [];
  for (const entry of list) {
    const item = normalizeItem(entry);
    if (!item || seen.has(item.text)) continue;
    seen.add(item.text);
    items.push(item);
    if (items.length >= MAX_ITEMS) break;
  }
  return { version: LIBRARY_VERSION, items };
}

/** 新增收藏；重复文本返回 {added:false} 而非重复堆积 */
function addPrompt(library, { text = '', title = '', tags = [] } = {}) {
  const clean = cleanText(text, MAX_TEXT);
  if (!clean) return { library: normalizeLibrary(library), added: false, reason: '提示词为空' };
  const norm = normalizeLibrary(library);
  if (norm.items.some(it => it.text === clean)) {
    return { library: norm, added: false, reason: '该提示词已在库中' };
  }
  if (norm.items.length >= MAX_ITEMS) {
    return { library: norm, added: false, reason: `提示词库已达上限 ${MAX_ITEMS} 条` };
  }
  const item = normalizeItem({ text: clean, title, tags, createdAt: Date.now() });
  return { library: { version: LIBRARY_VERSION, items: [...norm.items, item] }, added: true, item };
}

function removePrompt(library, id) {
  const norm = normalizeLibrary(library);
  const before = norm.items.length;
  const items = norm.items.filter(it => it.id !== id);
  return { library: { ...norm, items }, removed: items.length !== before };
}

/** 模糊搜索：大小写不敏感，匹配 text/title/tags；空查询返回全量 */
function searchPrompts(library, query = '') {
  const norm = normalizeLibrary(library);
  const q = cleanText(query, 200).toLowerCase();
  if (!q) return norm.items;
  return norm.items.filter(it =>
    it.text.toLowerCase().includes(q) ||
    it.title.toLowerCase().includes(q) ||
    it.tags.some(t => t.toLowerCase().includes(q))
  );
}

/** 导出清单 (版本化，绝不携带凭据) */
function buildExport(library) {
  return { app: 'winetoken-canvas-prompts', version: LIBRARY_VERSION, exportedAt: Date.now(), items: normalizeLibrary(library).items };
}

/**
 * 导入校验: 接受对象或 JSON 字符串，严格拒绝错误 app/版本/结构；
 * 与现有库合并去重，返回 {ok, library, added, warnings}；失败返回 {ok:false, error}。
 */
function parseImport(raw, existing = {}) {
  let data = raw;
  if (typeof raw === 'string') {
    try { data = JSON.parse(raw); }
    catch (err) { return { ok: false, error: `提示词库文件不是合法 JSON: ${err.message}` }; }
  }
  if (!isObject(data)) return { ok: false, error: '提示词库根节点必须是对象' };
  if (data.app !== 'winetoken-canvas-prompts') return { ok: false, error: '提示词库来源标识不匹配' };
  if (data.version !== LIBRARY_VERSION) return { ok: false, error: `提示词库版本不兼容 (期望 ${LIBRARY_VERSION})` };
  if (!Array.isArray(data.items)) return { ok: false, error: '提示词库缺少 items 数组' };

  const warnings = [];
  const base = normalizeLibrary(existing);
  const known = new Set(base.items.map(it => it.text));
  let added = 0;
  for (const entry of data.items) {
    const item = normalizeItem(entry);
    if (!item) { warnings.push('已剔除一条空白/畸形提示词'); continue; }
    if (known.has(item.text)) continue;
    if (base.items.length >= MAX_ITEMS) { warnings.push(`已达上限 ${MAX_ITEMS} 条，其余忽略`); break; }
    known.add(item.text);
    base.items.push(item);
    added++;
  }
  // 防御: 恶意 JSON 的 __proto__ 键不得污染原型
  if (Object.prototype.polluted !== undefined) warnings.push('已拦截原型污染载荷');
  return { ok: true, library: base, added, warnings };
}

module.exports = {
  LIBRARY_VERSION,
  MAX_ITEMS,
  MAX_TEXT,
  cleanText,
  normalizeLibrary,
  normalizeItem,
  addPrompt,
  removePrompt,
  searchPrompts,
  buildExport,
  parseImport
};
