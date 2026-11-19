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

// =========================================================================
// LibTV 目标规格 16 个专业预设库 (LIBTV_FULL_PARITY_BRIEF §2.3)
// 纯单色工业风格、零 Emoji、按分镜叙事/空间机位/设定图/质感调节 4 大类归约
// =========================================================================
const LIBTV_PRESETS = Object.freeze([
  // 分镜叙事 (6 项)
  {
    id: 'dispatch_board',
    name: '调度故事板',
    category: '分镜叙事',
    aspectRatio: '16:9',
    prompt: '调度故事板，电影分镜设计，机位运动轨迹，场景空间透视，镜头编号标注，景深控制，严谨构图，叙事光影',
    desc: '机位运动与空间调度规划'
  },
  {
    id: 'storyboard',
    name: '故事板',
    category: '分镜叙事',
    aspectRatio: '16:9',
    prompt: '电影故事板分镜，专业分镜线稿与明暗调子，画面张力，导演视角，严密构图，镜头机位，叙事性强',
    desc: '导演视角电影分镜'
  },
  {
    id: 'grid_25',
    name: '25宫格连贯分镜',
    category: '分镜叙事',
    aspectRatio: '16:9',
    prompt: '25宫格连贯电影分镜，25-panel storyboard grid, 序列帧动作推演，动作连贯性，相同角色连续动态，时间切片，电影节奏',
    desc: '连续动作序列帧推演'
  },
  {
    id: 'grid_4_drama',
    name: '剧情推演四宫格',
    category: '分镜叙事',
    aspectRatio: '1:1',
    prompt: '四宫格剧情推演，4-panel comic strip, 起承转合故事叙述，分镜连贯，镜头景别交替推进，戏剧冲突，情节推进',
    desc: '起承转合四镜头序列'
  },
  {
    id: 'prequel_3s',
    name: '画面推演-3秒前',
    category: '分镜叙事',
    aspectRatio: '16:9',
    prompt: '推演当前画面3秒前的发生瞬间，动作前摇，剧情前因，环境线索，因果伏笔，动态张力，时间倒流',
    desc: '推演当前镜头的前置瞬间'
  },
  {
    id: 'prequel_5s',
    name: '画面推演-5秒前',
    category: '分镜叙事',
    aspectRatio: '16:9',
    prompt: '推演当前画面5秒前的前情展开，前置冲突，角色入场，时间前移，故事渊源，因果铺垫',
    desc: '推演前置冲突与角色入场'
  },
  // 空间与机位 (2 项)
  {
    id: 'panorama_720',
    name: '720全景',
    category: '空间与机位',
    aspectRatio: '16:9',
    prompt: '720全景透视，超广角鱼眼全景，全景空间环境设计，360度环绕无死角，极宽广视野，空间深度感，宏大场景',
    desc: '超广角全景环绕透视'
  },
  {
    id: 'grid_9_angles',
    name: '多机位九宫格',
    category: '空间与机位',
    aspectRatio: '16:9',
    prompt: '九宫格多机位视角，9-camera multi-angle grid, 同一主体多角度镜头切分：俯拍、仰拍、特写、中景、全景、侧逆光，立体全方位空间展示',
    desc: '同一主体九种运镜机位'
  },
  // 设定图 (6 项，复用角色 DNA 与定妆照)
  {
    id: 'character_dna',
    name: '角色定妆照',
    category: '设定图',
    aspectRatio: '9:16',
    prompt: '角色官方定妆照，高辨识度外貌DNA，标准正面全身立绘，特征清晰，细节精致，中性光影，角色概念设定，一致性保障',
    desc: '保持外貌DNA的高辨识度立绘'
  },
  {
    id: 'turnaround_3view',
    name: '角色三视图',
    category: '设定图',
    aspectRatio: '16:9',
    prompt: '角色三视图设定，正面、侧面、背面全身立绘，character model sheet, turnaround view, 白底干净背景，严谨比例，服装与道具细节一致',
    desc: '正/侧/背全身模型设定'
  },
  {
    id: 'face_3view',
    name: '角色脸部三视图',
    category: '设定图',
    aspectRatio: '16:9',
    prompt: '角色面部头部三视图，face turnaround sheet, 正面、45度侧面、正侧面面部特写，五官结构严谨，神态微表情一致，发型光影精准',
    desc: '面部五官与神态三角度'
  },
  {
    id: 'character_sheet',
    name: '角色设定图',
    category: '设定图',
    aspectRatio: '16:9',
    prompt: '角色完整概念设计图，character concept sheet, 包含全身动态、表情变奏、服饰材质细节拆解、色彩配搭，设计手稿',
    desc: '表情动态服饰材质完整拆解'
  },
  {
    id: 'scene_sheet',
    name: '场景设定图',
    category: '设定图',
    aspectRatio: '16:9',
    prompt: '场景概念设计图，environment design sheet, 建筑结构，光影氛围，材质质感，透视线，空间布局，色彩基调，概念原画',
    desc: '建筑结构与光影氛围原画'
  },
  {
    id: 'product_sheet',
    name: '产品设定图',
    category: '设定图',
    aspectRatio: '16:9',
    prompt: '产品与道具工业概念设计图，product design sheet, 道具三视图，内部构造拆解，机械材质，工业制图线，高精度细节',
    desc: '道具与机械构造三视图拆解'
  },
  // 质感调节 (2 项)
  {
    id: 'portrait_texture',
    name: '人像质感调节',
    category: '质感调节',
    aspectRatio: '9:16',
    prompt: '顶级人像真实质感，超清细腻皮肤纹理，自然毛孔与绒毛，真实眼眸反光，摄影级自然浅景深，哈苏画质，通透肤色',
    desc: '细腻毛孔与真实眼眸质感'
  },
  {
    id: 'cinematic_grade',
    name: '电影级光影校正',
    category: '质感调节',
    aspectRatio: '16:9',
    prompt: '院线电影级调色与光影校正，cinematic lighting, 变形宽银幕电影镜头，伦勃朗光，戏剧性冷暖反差，大师级电影胶片质感，氛围浓郁',
    desc: '院线宽银幕调色与光影'
  }
]);

// =========================================================================
// 补充规格 S4 图片后处理派生动作预设
// =========================================================================
const DERIVED_ACTION_PRESETS = Object.freeze([
  { id: 'hd', name: '高清', prompt: '8K超清重制，超分辨率放大，极致边缘细节与纹理增强，去噪点与画面锐化，顶级画质', desc: '超分辨率放大与细节增强' },
  { id: 'repaint', name: '重绘', prompt: '局部重绘与氛围深化，在保留主体结构的基础上优化画面质感、精细色彩与艺术张力', desc: '保留主体重绘优化' },
  { id: 'panorama', name: '全景图', prompt: '基于画面向外扩展扩图，超广角全景环绕空间延伸，无缝融合扩展视野，宏大环境', desc: '向外扩展全景' },
  { id: 'multi_angle', name: '多角度', prompt: '以该主体为核心，推演另一视角机位运镜拍摄，保持角色外观与光影完全一致，立体空间转换', desc: '推演另一视角机位' },
  { id: 'relight', name: '重打光', prompt: '戏剧性重打光，重新构筑电影级主光源与边缘轮廓光，增强体积感与立体感，明暗对比强烈', desc: '重新构筑电影级光影' },
  { id: 'layer_split', name: '图层拆分', prompt: '图层前景主体与背景景深分离，透明通道切分，景深层次分明，主体突出', desc: '前景主体与背景分离' }
]);

// =========================================================================
// 补充规格 S3 画布彩色标签系统
// =========================================================================
const CANVAS_TAGS = Object.freeze([
  { id: 'prop', label: '道具', color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.15)' },
  { id: 'timbre', label: '音色', color: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.15)' },
  { id: 'scene', label: '场景', color: '#f97316', bg: 'rgba(249, 115, 22, 0.15)' },
  { id: 'costume', label: '服装', color: '#6366f1', bg: 'rgba(99, 102, 241, 0.15)' },
  { id: 'character', label: '人物', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.15)' },
  { id: 'final', label: '最终版', color: '#10b981', bg: 'rgba(16, 185, 129, 0.15)' },
  { id: 'pending', label: '待定版', color: '#eab308', bg: 'rgba(234, 179, 8, 0.15)' }
]);

function getLibtvPresets() {
  return LIBTV_PRESETS;
}

function getLibtvPreset(id) {
  if (typeof id !== 'string') return null;
  return LIBTV_PRESETS.find(p => p.id === id) || null;
}

function applyPreset(basePrompt, presetId) {
  const preset = getLibtvPreset(presetId);
  if (!preset) {
    return {
      prompt: typeof basePrompt === 'string' ? basePrompt : '',
      aspectRatio: null,
      applied: false
    };
  }
  const cleanBase = typeof basePrompt === 'string' ? basePrompt.trim() : '';
  const mergedPrompt = cleanBase ? `${cleanBase}，${preset.prompt}` : preset.prompt;
  return {
    prompt: mergedPrompt.slice(0, MAX_TEXT),
    aspectRatio: preset.aspectRatio || null,
    preset,
    applied: true
  };
}

function getDerivedActionPresets() {
  return DERIVED_ACTION_PRESETS;
}

function getDerivedAction(id) {
  if (typeof id !== 'string') return null;
  return DERIVED_ACTION_PRESETS.find(a => a.id === id) || null;
}

function buildDerivedPrompt(basePrompt, actionId) {
  const action = getDerivedAction(actionId);
  if (!action) {
    return typeof basePrompt === 'string' ? basePrompt : '';
  }
  const cleanBase = typeof basePrompt === 'string' ? basePrompt.trim() : '';
  const res = cleanBase ? `${cleanBase}，${action.prompt}` : action.prompt;
  return res.slice(0, MAX_TEXT);
}

module.exports = {
  LIBRARY_VERSION,
  MAX_ITEMS,
  MAX_TEXT,
  LIBTV_PRESETS,
  DERIVED_ACTION_PRESETS,
  CANVAS_TAGS,
  cleanText,
  normalizeLibrary,
  normalizeItem,
  addPrompt,
  removePrompt,
  searchPrompts,
  buildExport,
  parseImport,
  getLibtvPresets,
  getLibtvPreset,
  applyPreset,
  getDerivedActionPresets,
  getDerivedAction,
  buildDerivedPrompt
};
