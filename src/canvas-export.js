// -*- coding: utf-8 -*-
/**
 * WineToken 漫剧画布工程导入导出清单 (CanvasExport)
 * 对位上游 infinite-canvas 的 canvas-export.ts / CanvasExportFile：
 *   - 版本化清单 {app, version, exportedAt, project, assets[]}
 *   - 媒体资产以 assetKey 引用，实际二进制随包落盘 (由宿主 fs 通道执行)
 *   - 导入时严格校验 app/version/结构、拒绝路径穿越，缺字段增量补默认
 * 纯函数：不读写文件、不访问网络、零依赖，可独立单测。
 */
const APP_ID = 'winetoken-canvas';
const EXPORT_VERSION = 1;
const SAFE_ASSET_KEY = /^[A-Za-z0-9_-]{1,120}\.(png|jpg|jpeg|webp|gif|mp4|webm)$/i;

// 仅允许这些字段进入导出工程，避免把运行时敏感数据 (Key / 凭据) 带入工程包
const PROJECT_FIELDS = Object.freeze([
  'characters', 'panels', 'canvasItems', 'edges', 'groups',
  'viewport', 'activeModel', 'version', 'updatedAt', 'nodes'
]);

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** 校验资产键：防路径穿越、防控制字符、限定扩展名白名单 */
function isSafeAssetKey(key) {
  return typeof key === 'string' && SAFE_ASSET_KEY.test(key)
    && !key.includes('..') && !key.includes('/') && !key.includes('\\')
    && !key.includes('\u0000');
}

/** 剥除工程里的运行时敏感字段，仅保留白名单键 */
function sanitizeProject(project) {
  const src = isObject(project) ? project : {};
  const out = {};
  for (const key of PROJECT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(src, key)) out[key] = src[key];
  }
  return out;
}

/**
 * 收集工程内引用的资产键 (imageUrl / data.url / data.assetKey / avatar)。
 * 只收形如 asset:<key> 的本地引用；远程 URL 与 data: URL 不随包导出。
 */
function collectAssetKeys(project) {
  const src = isObject(project) ? project : {};
  const keys = [];
  const seen = new Set();
  const add = (value) => {
    if (typeof value !== 'string') return;
    let key = '';
    if (value.startsWith('asset:')) key = value.slice(6);
    else if (isSafeAssetKey(value)) key = value;
    if (!key || !isSafeAssetKey(key) || seen.has(key)) return;
    seen.add(key);
    keys.push(key);
  };
  const lists = [src.characters, src.panels, src.canvasItems, src.nodes];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!isObject(item)) continue;
      add(item.avatar);
      add(item.imageUrl);
      for (const url of Array.isArray(item.candidates) ? item.candidates : []) add(url);
      const data = item.data;
      if (isObject(data)) {
        add(data.url);
        add(data.assetKey);
        add(data.videoUrl);
        add(data.avatar);
        add(data.imageUrl);
        for (const url of Array.isArray(data.candidates) ? data.candidates : []) add(url);
      }
    }
  }
  return keys;
}

/**
 * 构建导出清单。缺字段补默认、非法资产键剔除并给出 warnings。
 * @returns {{app,version,exportedAt,project,assets,warnings}}
 */
function buildExportManifest(project, exportedAt = Date.now()) {
  const warnings = [];
  const keys = collectAssetKeys(project);
  const cleanProject = sanitizeProject(project);
  // 增量兼容：旧工程缺数组字段时补空，保证导入端零迁移
  for (const key of ['characters', 'panels', 'canvasItems', 'edges', 'groups']) {
    if (!Array.isArray(cleanProject[key])) {
      cleanProject[key] = [];
      warnings.push(`工程缺少 ${key} 字段，已补空数组`);
    }
  }
  if (!isObject(cleanProject.viewport)) {
    cleanProject.viewport = { x: 40, y: 30, zoom: 1 };
    warnings.push('工程缺少 viewport 字段，已补默认值');
  }
  const stamp = Number.isFinite(exportedAt) ? exportedAt : Date.now();
  return {
    app: APP_ID,
    version: EXPORT_VERSION,
    exportedAt: stamp,
    project: cleanProject,
    assets: keys.map(key => ({ assetKey: key, path: `assets/${key}` })),
    warnings
  };
}

/**
 * 解析并校验导入清单 (接受对象或 JSON 字符串)。
 * 严格拒绝：错误 app、不兼容 version、结构非法、资产键路径穿越。
 * 校验通过返回 {ok:true, manifest, warnings}；失败返回 {ok:false, error, warnings}。
 * 绝不抛错、绝不静默吞错——错误以结构化 error 透传给 UI。
 */
function parseImportManifest(raw) {
  const warnings = [];
  let data = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch (err) {
      return { ok: false, error: `工程文件不是合法 JSON: ${err.message}`, warnings };
    }
  }
  if (!isObject(data)) {
    return { ok: false, error: '工程文件根节点必须是对象', warnings };
  }
  if (data.app !== APP_ID) {
    return { ok: false, error: `工程来源标识不匹配 (期望 ${APP_ID})`, warnings };
  }
  if (data.version !== EXPORT_VERSION) {
    return { ok: false, error: `工程版本不兼容 (期望 ${EXPORT_VERSION}，实际 ${String(data.version)})`, warnings };
  }
  if (!isObject(data.project)) {
    return { ok: false, error: '工程缺少 project 数据', warnings };
  }

  // 资产清单：非法键一律剔除并告警，绝不因为一条脏数据放行路径穿越
  const assets = [];
  const seen = new Set();
  const rawAssets = Array.isArray(data.assets) ? data.assets : [];
  for (const entry of rawAssets) {
    if (!isObject(entry) || !isSafeAssetKey(entry.assetKey)) {
      warnings.push('已剔除非法资产键 (路径穿越/扩展名白名单之外)');
      continue;
    }
    if (seen.has(entry.assetKey)) continue;
    seen.add(entry.assetKey);
    assets.push({ assetKey: entry.assetKey, path: `assets/${entry.assetKey}` });
  }

  const project = sanitizeProject(data.project);
  for (const key of ['characters', 'panels', 'canvasItems', 'edges', 'groups']) {
    if (!Array.isArray(project[key])) {
      project[key] = [];
      warnings.push(`导入工程缺少 ${key} 字段，已补空数组`);
    }
  }
  if (!isObject(project.viewport)) {
    project.viewport = { x: 40, y: 30, zoom: 1 };
    warnings.push('导入工程缺少 viewport 字段，已补默认值');
  }

  return {
    ok: true,
    manifest: {
      app: APP_ID,
      version: EXPORT_VERSION,
      exportedAt: Number.isFinite(data.exportedAt) ? data.exportedAt : Date.now(),
      project,
      assets
    },
    warnings
  };
}

module.exports = {
  APP_ID,
  EXPORT_VERSION,
  isSafeAssetKey,
  collectAssetKeys,
  buildExportManifest,
  parseImportManifest
};
