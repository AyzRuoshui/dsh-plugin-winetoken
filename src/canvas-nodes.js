// -*- coding: utf-8 -*-
/**
 * WineToken 漫剧画布统一节点视图 (只读投影层)
 * 对齐上游 infinite-canvas 的「上游节点即生成上下文」语义，但不改动任何存储格式：
 *   - 把 characters / panels / canvasItems / groups 投影成一张扁平节点表
 *   - 把形如 {type,id} / 裸字符串 / {id} 的边端点归一化为规范引用
 *   - 汇总指向目标节点的上游节点，产出提示词、参考图、文本与参数覆盖
 * 全模块零依赖、零 fs/DOM/网络、无动态代码执行，纯函数且对脏数据绝不抛错。
 *
 * 两套命名空间 (刻意区分，务必留意)：
 *   1) descriptor.type / NODE_TYPES 键 = 节点注册表键: panel/character/image/text/video/group
 *   2) ref.type / 边端点 type        = 边命名空间: panel/item/character/group
 *      canvasItem 在边里统一叫 'item'，与 client.js 真正写入的 {type:'item',id} 一致，
 *      因此无论边端点自带 'item' 还是裸字符串 id，归一化后都得到同一种规范形态。
 */

// 未知类型的安全默认定义 (冻结，调用方无法污染注册表)
const UNKNOWN_DEFINITION = Object.freeze({
  label: '未知节点',
  minimapColor: '#9ca3af',
  kind: 'unknown',
  canGenerate: false
});

// 节点注册表：单色系但逐类可区分的十六进制小地图颜色，绝不含表情符号
const NODE_TYPES = {
  panel: { label: '分镜', minimapColor: '#6b7280', kind: 'shot', canGenerate: true },
  character: { label: '角色', minimapColor: '#9ca3af', kind: 'entity', canGenerate: false },
  image: { label: '图片', minimapColor: '#4b5563', kind: 'media', canGenerate: true },
  text: { label: '文本', minimapColor: '#d1d5db', kind: 'text', canGenerate: false },
  video: { label: '视频', minimapColor: '#374151', kind: 'media', canGenerate: true },
  group: { label: '分组', minimapColor: '#e5e7eb', kind: 'container', canGenerate: false }
};

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function getString(v) {
  return typeof v === 'string' ? v : '';
}

// 数值归一化：NaN / Infinity / 脏字符串一律回退，避免 NaN 污染坐标与尺寸
function toFinite(v, fallback) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

function normalizeId(v) {
  if (typeof v === 'string') return v.length > 0 ? v : null;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

function toNodeId(v) {
  const direct = normalizeId(v);
  if (direct !== null) return direct;
  if (isObject(v)) return normalizeId(v.id != null ? v.id : v.nodeId);
  return null;
}

function deepFreeze(obj) {
  Object.keys(obj).forEach(k => {
    const v = obj[k];
    if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v);
  });
  return Object.freeze(obj);
}

// 返回已注册定义，否则返回安全默认值；用 hasOwnProperty 挡住 constructor/__proto__ 等继承键
function getNodeDefinition(type) {
  const key = typeof type === 'string' ? type : '';
  if (Object.prototype.hasOwnProperty.call(NODE_TYPES, key)) {
    const def = NODE_TYPES[key];
    if (def && typeof def === 'object' && typeof def.minimapColor === 'string') return def;
  }
  return UNKNOWN_DEFINITION;
}

function listNodeTypes() {
  return Object.keys(NODE_TYPES).filter(k => {
    const d = NODE_TYPES[k];
    return isObject(d) && typeof d.minimapColor === 'string';
  });
}

// 兼容「把辅助函数挂在注册表上」的习惯：非枚举属性不污染 Object.keys(NODE_TYPES)
Object.defineProperty(NODE_TYPES, 'getNodeDefinition', {
  value: getNodeDefinition, enumerable: false, writable: false, configurable: false
});
Object.defineProperty(NODE_TYPES, 'listNodeTypes', {
  value: listNodeTypes, enumerable: false, writable: false, configurable: false
});
deepFreeze(NODE_TYPES);

// 各类型缺省尺寸；未列出的 video 亦给出合理默认
const DEFAULT_SIZE = {
  panel: { w: 280, h: 420 },
  character: { w: 240, h: 220 },
  image: { w: 240, h: 320 },
  text: { w: 240, h: 120 },
  video: { w: 320, h: 180 },
  group: { w: 400, h: 300 }
};

function defaultSizeFor(type) {
  return DEFAULT_SIZE[type] || DEFAULT_SIZE.image;
}

function truncate(s, max) {
  return s.length <= max ? s : s.slice(0, max);
}

function firstText(...vals) {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim() !== '') return v;
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return '';
}

function dataOf(raw) {
  if (!isObject(raw)) return {};
  const d = raw.data;
  return isObject(d) ? d : {};
}

function itemNodeType(item) {
  const t = getString(item.type);
  return (t === 'image' || t === 'text' || t === 'video') ? t : 'image';
}

function titleOfCharacter(c) {
  return getString(c.name).trim() || '未命名角色';
}

function titleOfPanel(p) {
  return `分镜 #${toFinite(p.num, '?')}`;
}

// 通用节点标题取 text/url/prompt 首个非空串并截断到 40 字
function titleOfItem(item, type) {
  const d = dataOf(item);
  const s = truncate(firstText(d.text, d.url, d.prompt).trim(), 40);
  return s || (getNodeDefinition(type).label + '节点');
}

function titleOfGroup(g) {
  return getString(g.name).trim() || '未命名分组';
}

function makeNode(raw, type, refType, title) {
  const id = normalizeId(raw.id) || '';
  const def = defaultSizeFor(type);
  const posX = (raw.position && raw.position.x !== undefined) ? raw.position.x : raw.x;
  const posY = (raw.position && raw.position.y !== undefined) ? raw.position.y : raw.y;
  const w = raw.width || (raw.style && raw.style.width) || def.w;
  const h = raw.height || (raw.style && raw.style.height) || def.h;
  return {
    id,
    type,
    title,
    x: toFinite(posX, 0),
    y: toFinite(posY, 0),
    width: toFinite(w, def.w),
    height: toFinite(h, def.h),
    ref: { type: refType, id },
    raw
  };
}

/**
 * 扁平投影：支持 React Flow nodes 与 legacy 四数组 (characters/panels/canvasItems/groups)。
 * raw 保留原对象引用 (不深拷贝)，ref 采用边命名空间。
 */
function listNodes(project) {
  const p = isObject(project) ? project : {};
  const out = [];
  // 逐条 try/catch：某条脏数据 (如 getter 抛错) 只跳过该条，不影响整表
  const emit = (raw, build) => {
    if (!isObject(raw)) return;
    try { out.push(build(raw)); } catch (_) {}
  };
  if (Array.isArray(p.nodes)) {
    p.nodes.forEach(n => emit(n, r => {
      const rawType = getString(r.type);
      let canonicalType = 'image';
      let refType = 'item';
      if (rawType === 'panelNode' || rawType === 'panel') {
        canonicalType = 'panel';
        refType = 'panel';
      } else if (rawType === 'characterNode' || rawType === 'character') {
        canonicalType = 'character';
        refType = 'character';
      } else if (rawType === 'groupNode' || rawType === 'group') {
        canonicalType = 'group';
        refType = 'group';
      } else if (rawType === 'videoNode' || rawType === 'video') {
        canonicalType = 'video';
        refType = 'item';
      } else if (rawType === 'textNode' || rawType === 'text') {
        canonicalType = 'text';
        refType = 'item';
      } else {
        canonicalType = itemNodeType(r);
        refType = 'item';
      }
      const d = dataOf(r);
      let title = '';
      if (canonicalType === 'character') title = titleOfCharacter(d.name ? d : r);
      else if (canonicalType === 'panel') title = titleOfPanel(d.num !== undefined ? d : r);
      else if (canonicalType === 'group') title = titleOfGroup(d.name ? d : r);
      else title = titleOfItem(r, canonicalType);

      return makeNode(r, canonicalType, refType, title);
    }));
    return out;
  }
  const chars = Array.isArray(p.characters) ? p.characters : [];
  chars.forEach(c => emit(c, r => makeNode(r, 'character', 'character', titleOfCharacter(r))));
  const panels = Array.isArray(p.panels) ? p.panels : [];
  panels.forEach(pp => emit(pp, r => makeNode(r, 'panel', 'panel', titleOfPanel(r))));
  const items = Array.isArray(p.canvasItems) ? p.canvasItems : [];
  items.forEach(it => emit(it, r => {
    const t = itemNodeType(r);
    return makeNode(r, t, 'item', titleOfItem(r, t));
  }));
  const groups = Array.isArray(p.groups) ? p.groups : [];
  groups.forEach(g => emit(g, r => makeNode(r, 'group', 'group', titleOfGroup(r))));
  return out;
}

// 供内部复用的 id → 节点索引，重复 id 保留首个
function buildIndex(project) {
  const nodes = listNodes(project);
  const byId = new Map();
  nodes.forEach(n => {
    const k = String(n.id);
    if (!byId.has(k)) byId.set(k, n);
  });
  return { nodes, byId };
}

// 从任意端点形态里稳健抽出 id：字符串/数字、{id}、{nodeId}、fromNodeId/toNodeId、数组等
function extractEndpointId(endpoint) {
  if (typeof endpoint === 'string' || typeof endpoint === 'number') return normalizeId(endpoint);
  if (Array.isArray(endpoint)) {
    for (let i = endpoint.length - 1; i >= 0; i--) {
      const nid = normalizeId(endpoint[i]);
      if (nid !== null) return nid;
    }
    return null;
  }
  if (isObject(endpoint)) {
    const keys = ['id', 'nodeId', 'fromNodeId', 'toNodeId', 'targetId', 'sourceId'];
    for (const k of keys) {
      const nid = normalizeId(endpoint[k]);
      if (nid !== null) return nid;
    }
  }
  return null;
}

function resolveWithIndex(endpoint, index) {
  let id;
  try { id = extractEndpointId(endpoint); } catch (_) { return null; }
  if (id === null) return null;
  const node = index.byId.get(id);
  if (!node) return null; // 悬空 id
  // 规范形态一律以 id 在统一视图里解析出的 ref.type 为准，忽略脏数据里不一致的显式 type
  return { type: node.ref.type, id: node.id };
}

/** 归一化边端点为规范 {type,id} 或 null；缺 id / 悬空 id / 畸形输入绝不抛错 */
function resolveEdgeEndpoint(endpoint, project) {
  try {
    return resolveWithIndex(endpoint, buildIndex(project));
  } catch (_) {
    return null;
  }
}

// 容忍旧工程/alternate 形状：from/to、fromNodeId/toNodeId、source/target 等
function pickEdgeEndpoint(edge, side) {
  const keys = side === 'from'
    ? ['from', 'fromNodeId', 'source', 'start', 'a']
    : ['to', 'toNodeId', 'target', 'end', 'b'];
  for (const k of keys) {
    try {
      if (Object.prototype.hasOwnProperty.call(edge, k)) {
        const v = edge[k];
        if (v !== undefined && v !== null) return v;
      }
    } catch (_) {}
  }
  return undefined;
}

function safeIdOf(endpoint) {
  try { return extractEndpointId(endpoint); } catch (_) { return null; }
}

// 内部实现：同时产出上游列表与诊断警告，供 collectUpstream / buildGenerationContext 复用
function collectUpstreamInternal(project, nodeId, index) {
  const upstream = [];
  const warnings = [];
  const seen = new Set();   // 上游节点 id 去重
  const warned = new Set(); // 警告文本去重
  const warn = (msg) => {
    if (!warned.has(msg)) { warned.add(msg); warnings.push(msg); }
  };
  const idx = index || buildIndex(project);
  const tid = toNodeId(nodeId);
  const edges = (isObject(project) && Array.isArray(project.edges)) ? project.edges : [];
  if (tid === null) return { upstream, warnings };

  // 仅按边数组顺序做「一跳」上游采集，绝不递归，天然免疫 A→B→A 环
  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i];
    if (!isObject(edge)) { warn('已忽略缺少端点的连线'); continue; }
    let fromRaw, toRaw;
    try {
      fromRaw = pickEdgeEndpoint(edge, 'from');
      toRaw = pickEdgeEndpoint(edge, 'to');
    } catch (_) { continue; }
    if (fromRaw === undefined || toRaw === undefined) { warn('已忽略缺少端点的连线'); continue; }

    const to = resolveWithIndex(toRaw, idx);
    const from = resolveWithIndex(fromRaw, idx);
    if (!to) {
      const did = safeIdOf(toRaw);
      if (did !== null) warn(`连线引用了悬空节点 id：${did}`);
      continue;
    }
    if (!from) {
      const did = safeIdOf(fromRaw);
      if (did !== null) warn(`连线引用了悬空节点 id：${did}`);
      continue;
    }
    if (from.id === to.id) { warn(`已忽略自引用连线：${from.id}`); continue; }
    if (to.id !== tid) continue;          // 只保留指向目标节点的边
    if (seen.has(from.id)) continue;      // 重复边去重 (保留首次出现顺序)
    seen.add(from.id);
    const node = idx.byId.get(from.id);
    if (!node) continue;
    upstream.push({ node, endpoint: from });
  }
  return { upstream, warnings };
}

/** 返回指向 nodeId 的上游节点 [{node, endpoint}]，边序、去重、跳过悬空/自引用 */
function collectUpstream(project, nodeId) {
  try {
    return collectUpstreamInternal(project, nodeId).upstream;
  } catch (_) {
    return [];
  }
}

const PROMPT_MAX = 4000;
const REF_MAX = 8;
const PARAM_KEYS = Object.freeze([
  'model', 'size', 'aspectRatio', 'shot', 'negativePrompt', 'count',
  'duration', 'resolution', 'mode', 'generateAudio', 'quality', 'preset'
]);
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// 返回规范值；null 表示非法丢弃。白名单之外的键根本不会走到这里。
function validateParam(key, val) {
  if (FORBIDDEN_KEYS.has(key)) return null;
  if (key === 'count') {
    let n = NaN;
    if (typeof val === 'number') n = val;
    else if (typeof val === 'string' && val.trim() !== '') n = Number(val);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > 64) return null;
    return n;
  }
  if (key === 'duration') {
    let n = NaN;
    if (typeof val === 'number') n = val;
    else if (typeof val === 'string' && val.trim() !== '') n = Number(val);
    if (!Number.isFinite(n) || n < 1 || n > 30) return null;
    return Math.round(n);
  }
  if (key === 'generateAudio') {
    if (typeof val === 'boolean') return val;
    if (val === 'true') return true;
    if (val === 'false') return false;
    return null;
  }
  if (typeof val !== 'string') return null;
  const max = key === 'negativePrompt' ? 2000 : key === 'model' ? 200 : 100;
  return val.length > max ? null : val;
}

function basePromptOf(node) {
  const raw = node.raw || {};
  const d = dataOf(raw);
  if (node.type === 'panel') return getString(d.prompt || raw.prompt);
  if (node.type === 'text') return getString(d.text || raw.text);
  if (node.type === 'image' || node.type === 'video') return getString(d.prompt || raw.prompt);
  return '';
}

function imagePromptOf(node) {
  const d = dataOf(node.raw);
  const raw = node.raw || {};
  return getString(d.prompt || raw.prompt);
}

function textOf(node) {
  const d = dataOf(node.raw);
  const raw = node.raw || {};
  return getString(d.text || raw.text);
}

function imageRefOf(node) {
  const d = dataOf(node.raw);
  const raw = node.raw || {};
  const url = getString(d.url || raw.imageUrl || raw.url);
  if (url.trim() !== '') return url;
  const assetKey = getString(d.assetKey || raw.assetKey);
  if (assetKey.trim() !== '') return 'asset:' + assetKey;
  return '';
}

/**
 * 生成上下文：基础提示词 + 上游文本 + 上游图片 data.prompt；上游图片 url/assetKey 作参考图，
 * 末尾追加目标分镜角色 avatar；参数仅合并白名单键。全程纯函数，对脏数据绝不抛错。
 */
function buildGenerationContext(project, nodeId) {
  const warnings = [];
  const result = { prompt: '', referenceImages: [], texts: [], params: {}, warnings };
  try {
    const idx = buildIndex(project);
    const tid = toNodeId(nodeId);
    const target = tid !== null ? idx.byId.get(tid) : null;
    if (!target) {
      warnings.push(`目标节点 ${tid === null ? String(nodeId) : tid} 不存在，已返回空上下文`);
      return result;
    }

    const collected = collectUpstreamInternal(project, nodeId, idx);
    collected.warnings.forEach(w => { if (!warnings.includes(w)) warnings.push(w); });
    const upstream = collected.upstream;

    // 1) prompt：逐段 trim + 去重，中文逗号连接，超长截断
    const parts = [];
    const seenPart = new Set();
    const addPart = (v) => {
      const s = getString(v).trim();
      if (!s || seenPart.has(s)) return;
      seenPart.add(s);
      parts.push(s);
    };
    addPart(basePromptOf(target));
    upstream.forEach(({ node }) => { if (node.type === 'text') addPart(textOf(node)); });
    upstream.forEach(({ node }) => { if (node.type === 'image') addPart(imagePromptOf(node)); });
    let prompt = parts.join('，');
    if (prompt.length > PROMPT_MAX) {
      prompt = prompt.slice(0, PROMPT_MAX);
      warnings.push(`提示词超过 ${PROMPT_MAX} 字，已截断`);
    }

    // 2) texts：上游文本原始字符串，有序、按精确串去重
    const texts = [];
    upstream.forEach(({ node }) => {
      if (node.type !== 'text') return;
      const t = textOf(node);
      if (t.trim() !== '' && !texts.includes(t)) texts.push(t);
    });

    // 3) referenceImages：拒绝空值/null/undefined，avatar 末尾追加且去重，上限 8
    const refs = [];
    const seenRef = new Set();
    const addRef = (v) => {
      if (typeof v !== 'string' || v.trim() === '') return;
      if (seenRef.has(v)) return;
      seenRef.add(v);
      refs.push(v);
    };
    upstream.forEach(({ node }) => { if (node.type === 'image') addRef(imageRefOf(node)); });
    if (target.type === 'panel') {
      const charId = normalizeId(dataOf(target.raw).characterId || (target.raw || {}).characterId);
      const char = charId !== null ? idx.byId.get(charId) : null;
      if (char && char.type === 'character') {
        const charAvatar = getString(dataOf(char.raw).avatar || (char.raw || {}).avatar);
        addRef(charAvatar);
      }
    }
    if (refs.length > REF_MAX) {
      refs.length = REF_MAX;
      warnings.push(`参考图超过 ${REF_MAX} 张，已截断`);
    }

    // 4) params：目标自身作为基底，上游仅白名单键浅合并 (后者覆盖)，键来自常量而非用户输入，天然阻断原型污染
    const params = {};
    const mergeParamObj = (pr) => {
      if (!isObject(pr)) return;
      PARAM_KEYS.forEach(key => {
        if (FORBIDDEN_KEYS.has(key)) return; // 双保险
        let val;
        try {
          if (!Object.prototype.hasOwnProperty.call(pr, key)) return;
          val = pr[key];
        } catch (_) { return; }
        const clean = validateParam(key, val);
        if (clean !== null) params[key] = clean;
      });
    };

    mergeParamObj(dataOf(target.raw).params || (target.raw || {}).params);
    upstream.forEach(({ node }) => {
      mergeParamObj(dataOf(node.raw).params || (node.raw || {}).params);
    });

    result.prompt = prompt;
    result.texts = texts;
    result.referenceImages = refs;
    result.allReferenceImages = [...refs];
    result.firstFrameUrl = refs[0] || '';
    result.lastFrameUrl = refs.length > 1 ? refs[refs.length - 1] : '';
    result.multiReferenceCount = refs.length;
    if (target.type === 'video') {
      result.mode = refs.length > 1 ? 'multi_reference' : (refs.length === 1 ? 'single_reference' : 'text_to_video');
    } else if (target.type === 'image' || target.type === 'panel') {
      result.mode = refs.length > 0 ? 'image_to_image' : 'text_to_image';
    } else {
      result.mode = 'default';
    }
    result.params = params;
  } catch (_) {
    warnings.push('生成上下文构建时遇到脏数据，已安全降级');
  }
  return result;
}

/** id 唯一性报告：ids 为按序全量列表，duplicates 为重复过的 id，纯函数不改入参 */
function normalizeNodeIds(nodes) {
  const ids = [];
  const duplicates = [];
  const seen = new Set();
  const dupSeen = new Set();
  const arr = Array.isArray(nodes) ? nodes : [];
  arr.forEach(n => {
    let id = '';
    try {
      id = isObject(n) ? String(n.id == null ? '' : n.id) : '';
    } catch (_) { id = ''; }
    ids.push(id);
    if (seen.has(id)) {
      if (!dupSeen.has(id)) { dupSeen.add(id); duplicates.push(id); }
    } else {
      seen.add(id);
    }
  });
  return { ids, duplicates };
}

module.exports = {
  NODE_TYPES,
  getNodeDefinition,
  listNodeTypes,
  listNodes,
  resolveEdgeEndpoint,
  collectUpstream,
  buildGenerationContext,
  normalizeNodeIds
};
