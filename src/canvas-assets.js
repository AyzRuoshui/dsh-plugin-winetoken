// -*- coding: utf-8 -*-
/**
 * WineToken 画布本地资产库 (CanvasAssets)
 * 对位上游 infinite-canvas 的 image-storage.ts / file-storage.ts (Blob 存本地、节点只持键)，
 * 按 DSH 插件实际改为 ~/.dsh/storages/winetoken_assets/ 下的二进制文件：
 *   - DataURL 解码落盘，节点只保存 assetKey，避免超大 Base64 撑爆工程 JSON
 *   - 每次写盘后物理回读字节数强校验，失败真实抛错 (铁律 3)
 *   - 资产键白名单校验，彻底阻断路径穿越与任意扩展名写入
 * 仅依赖 Node 原生 fs/path/os，零第三方依赖、无网络、无动态代码执行。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const SAFE_KEY = /^[A-Za-z0-9_-]{1,120}\.(png|jpg|jpeg|webp|gif|mp4|webm)$/i;
const MIME_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm'
};
const EXT_MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  webp: 'image/webp', gif: 'image/gif', mp4: 'video/mp4', webm: 'video/webm'
};

function isSafeAssetKey(key) {
  return typeof key === 'string' && SAFE_KEY.test(key)
    && !key.includes('..') && !key.includes('/') && !key.includes('\\')
    && !key.includes('\u0000');
}

/** 从 DataURL 拆出 mime 与二进制；非法头部/空载荷一律拒绝 */
function decodeDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') return null;
  const match = /^data:([a-zA-Z0-9/+.-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl.trim());
  if (!match) return null;
  const mime = match[1].toLowerCase();
  const ext = MIME_EXT[mime];
  if (!ext) return null;
  let buffer;
  try {
    buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
  } catch (_) {
    return null;
  }
  if (!buffer || buffer.length === 0) return null;
  return { ext, mime, buffer };
}

/** 推断扩展名；未知一律拒绝，不猜测、不落可疑文件 */
function extOf(dataUrl) {
  const decoded = decodeDataUrl(dataUrl);
  return decoded ? decoded.ext : null;
}

function mimeOfKey(key) {
  if (!isSafeAssetKey(key)) return '';
  const ext = key.split('.').pop().toLowerCase();
  return EXT_MIME[ext] || '';
}

/** 收集工程内所有 asset: 引用键，供清理未使用资产使用 */
function collectAssetKeys(project) {
  const src = project && typeof project === 'object' ? project : {};
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
  for (const list of [src.characters, src.panels, src.canvasItems]) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      add(item.avatar);
      add(item.imageUrl);
      for (const url of Array.isArray(item.candidates) ? item.candidates : []) add(url);
      if (item.data && typeof item.data === 'object') {
        add(item.data.url);
        add(item.data.assetKey);
        add(item.data.videoUrl);
      }
    }
  }
  return keys;
}

class CanvasAssets {
  constructor(customStorageDir = null) {
    this.assetsDir = customStorageDir || path.join(os.homedir(), '.dsh', 'storages', 'winetoken_assets');
    this._ensureDir();
  }

  _ensureDir() {
    if (!fs.existsSync(this.assetsDir)) {
      fs.mkdirSync(this.assetsDir, { recursive: true });
    }
  }

  filePath(key) {
    if (!isSafeAssetKey(key)) throw new Error(`[WineToken CanvasAssets] 非法资产键: ${String(key)}`);
    return path.join(this.assetsDir, key);
  }

  /** 生成不与现有文件冲突的资产键 */
  newAssetKey(ext) {
    const safeExt = MIME_EXT[ext] || (typeof ext === 'string' && EXT_MIME[ext.toLowerCase()] ? ext.toLowerCase() : null);
    if (!safeExt) throw new Error(`[WineToken CanvasAssets] 不支持的扩展名: ${String(ext)}`);
    let key;
    do {
      key = 'asset_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8) + '.' + safeExt;
    } while (fs.existsSync(this.filePath(key)));
    return key;
  }

  /**
   * 把 DataURL 落盘为本地资产文件，返回 {assetKey, bytes, mime}。
   * 写后立即物理回读校验字节数与内容；任何失败真实抛错，绝不静默返回成功。
   */
  saveDataUrl(dataUrl) {
    const decoded = decodeDataUrl(dataUrl);
    if (!decoded) throw new Error('[WineToken CanvasAssets] 非法的图片/视频 DataURL，拒绝落盘');
    this._ensureDir();
    const key = this.newAssetKey(decoded.ext);
    const file = this.filePath(key);
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, decoded.buffer);
    fs.renameSync(tmp, file);
    // 铁律 3：落盘后物理回读强校验
    let readBack;
    try {
      readBack = fs.readFileSync(file);
    } catch (err) {
      throw new Error(`[WineToken CanvasAssets] 资产 ${key} 物理回读失败: ${err.message}`);
    }
    if (readBack.length !== decoded.buffer.length || !readBack.equals(decoded.buffer)) {
      throw new Error(`[WineToken CanvasAssets] 资产 ${key} 回读内容与写入不一致，已中止`);
    }
    return { assetKey: key, bytes: readBack.length, mime: decoded.mime };
  }

  /** 把已有的 Buffer 落盘 (供宿主 fetch 二进制流调用) */
  saveBuffer(buffer, ext) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new Error('[WineToken CanvasAssets] 资产内容为空，拒绝落盘');
    }
    const decoded = { ext: (MIME_EXT[ext] || (typeof ext === 'string' && EXT_MIME[ext.toLowerCase()] ? ext.toLowerCase() : null)), buffer };
    if (!decoded.ext) throw new Error(`[WineToken CanvasAssets] 不支持的扩展名: ${String(ext)}`);
    this._ensureDir();
    const key = this.newAssetKey(decoded.ext);
    const file = this.filePath(key);
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, buffer);
    fs.renameSync(tmp, file);
    const readBack = fs.readFileSync(file);
    if (readBack.length !== buffer.length || !readBack.equals(buffer)) {
      throw new Error(`[WineToken CanvasAssets] 资产 ${key} 回读内容与写入不一致，已中止`);
    }
    return { assetKey: key, bytes: readBack.length, mime: EXT_MIME[decoded.ext] || '' };
  }

  /** 读回资产为 DataURL，供 UI 渲染；缺失/非法键真实抛错 */
  readAsDataUrl(key) {
    if (!isSafeAssetKey(key)) throw new Error(`[WineToken CanvasAssets] 非法资产键: ${String(key)}`);
    const file = this.filePath(key);
    let buffer;
    try {
      buffer = fs.readFileSync(file);
    } catch (err) {
      throw new Error(`[WineToken CanvasAssets] 资产 ${key} 读取失败: ${err.message}`);
    }
    const mime = mimeOfKey(key);
    return `data:${mime};base64,${buffer.toString('base64')}`;
  }

  exists(key) {
    if (!isSafeAssetKey(key)) return false;
    try { return fs.existsSync(this.filePath(key)); } catch (_) { return false; }
  }

  /** 清理工程未引用的资产；只删除本模块生成的合法键文件，绝不误删其他文件 */
  cleanupUnused(project) {
    const used = new Set(collectAssetKeys(project));
    const removed = [];
    for (const name of fs.readdirSync(this.assetsDir)) {
      if (!isSafeAssetKey(name) || name.endsWith('.tmp')) continue;
      if (used.has(name)) continue;
      try {
        fs.unlinkSync(path.join(this.assetsDir, name));
        removed.push(name);
      } catch (err) {
        throw new Error(`[WineToken CanvasAssets] 清理资产 ${name} 失败: ${err.message}`);
      }
    }
    return removed;
  }
}

// =========================================================================
// 补充规格 S1 / S2 资产库元数据索引管理器 (AssetLibraryStore)
// 对标 LibTV 资产库：分类 (全部/角色/场景/道具/自定义)、命名、使用计数、搜索
// 底层二进制复用 CanvasAssets，索引落 ~/.dsh/storages/winetoken_asset_library.json
// =========================================================================
const ASSET_CATEGORIES = Object.freeze(['全部', '角色', '场景', '道具', '自定义']);
const LIBRARY_VERSION = 1;

function cleanString(v, maxLen = 120, fallback = '') {
  if (typeof v !== 'string') return fallback;
  const s = v.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return s ? s.slice(0, maxLen) : fallback;
}

function normalizeAssetCategory(cat) {
  const s = cleanString(cat, 20);
  if (['角色', '场景', '道具', '自定义'].includes(s)) return s;
  return '自定义';
}

function normalizeAssetTags(tags) {
  if (!Array.isArray(tags)) return [];
  const out = [];
  const seen = new Set();
  for (const t of tags) {
    const s = cleanString(t, 40);
    if (s && !seen.has(s)) {
      seen.add(s);
      out.push(s);
      if (out.length >= 8) break;
    }
  }
  return out;
}

function normalizeAssetEntry(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const assetKey = cleanString(raw.assetKey, 120);
  if (!isSafeAssetKey(assetKey)) return null;
  const id = cleanString(raw.id, 120) || `ast_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const name = cleanString(raw.name, 120) || assetKey;
  const category = normalizeAssetCategory(raw.category);
  const description = cleanString(raw.description, 500);
  const tags = normalizeAssetTags(raw.tags);
  const usageCount = Number.isFinite(raw.usageCount) && raw.usageCount >= 0 ? Math.floor(raw.usageCount) : 0;
  const createdAt = Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now();
  const updatedAt = Number.isFinite(raw.updatedAt) ? raw.updatedAt : createdAt;
  return { id, assetKey, name, category, description, tags, usageCount, createdAt, updatedAt };
}

function defaultStorageDir() {
  return path.join(os.homedir(), '.dsh', 'storages');
}

class AssetLibraryStore {
  constructor(storageDir = defaultStorageDir()) {
    this.storageDir = storageDir;
    this.libraryPath = path.join(this.storageDir, 'winetoken_asset_library.json');
    this.backupPath = path.join(this.storageDir, 'winetoken_asset_library.json.bak');
  }

  _ensureDir() {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  _atomicWriteJson(filePath, data, label) {
    this._ensureDir();
    const expected = JSON.stringify(data, null, 2);
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, expected, 'utf8');
    if (fs.existsSync(filePath)) {
      try { fs.copyFileSync(filePath, this.backupPath); } catch (_) {}
    }
    fs.renameSync(tmp, filePath);
    // 铁律 3：落盘后物理回读强校验
    let readBack;
    try {
      readBack = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      throw new Error(`[WineToken AssetLibrary] ${label} 物理回读失败: ${err.message}`);
    }
    let parsed;
    try {
      parsed = JSON.parse(readBack);
    } catch (err) {
      throw new Error(`[WineToken AssetLibrary] ${label} 回读内容非合法 JSON: ${err.message}`);
    }
    if (JSON.stringify(parsed, null, 2) !== expected) {
      throw new Error(`[WineToken AssetLibrary] ${label} 回读内容与写入不一致，已中止`);
    }
    return true;
  }

  loadLibrary() {
    const candidates = [this.libraryPath, this.backupPath];
    for (const file of candidates) {
      if (!fs.existsSync(file)) continue;
      try {
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
        const list = Array.isArray(raw?.items) ? raw.items : (Array.isArray(raw) ? raw : []);
        const items = [];
        const seenIds = new Set();
        for (const entry of list) {
          const norm = normalizeAssetEntry(entry);
          if (norm && !seenIds.has(norm.id)) {
            seenIds.add(norm.id);
            items.push(norm);
          }
        }
        return { version: LIBRARY_VERSION, items };
      } catch (err) {
        console.warn(`[WineToken AssetLibrary] 资产库文件损坏: ${err.message}`);
      }
    }
    return { version: LIBRARY_VERSION, items: [] };
  }

  saveLibrary(lib) {
    const items = Array.isArray(lib?.items) ? lib.items : [];
    const normalized = {
      version: LIBRARY_VERSION,
      items: items.map(normalizeAssetEntry).filter(Boolean)
    };
    return this._atomicWriteJson(this.libraryPath, normalized, '资产库索引');
  }

  addItem({ assetKey, name = '', category = '自定义', description = '', tags = [] } = {}) {
    if (!isSafeAssetKey(assetKey)) {
      throw new Error(`[WineToken AssetLibrary] 非法资产键: ${String(assetKey)}`);
    }
    const current = this.loadLibrary();
    const entry = normalizeAssetEntry({
      id: `ast_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      assetKey,
      name: name || assetKey,
      category,
      description,
      tags,
      usageCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
    if (!entry) throw new Error('[WineToken AssetLibrary] 资产条目归一化失败');
    current.items.unshift(entry);
    this.saveLibrary(current);
    return entry;
  }

  updateItem(id, patch = {}) {
    if (typeof id !== 'string' || !id.trim()) {
      throw new Error('[WineToken AssetLibrary] 缺少资产 ID');
    }
    const current = this.loadLibrary();
    const idx = current.items.findIndex(it => it.id === id);
    if (idx === -1) {
      throw new Error(`[WineToken AssetLibrary] 未找到 ID 为 ${id} 的资产`);
    }
    const existing = current.items[idx];
    const updated = normalizeAssetEntry({
      ...existing,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.category !== undefined ? { category: patch.category } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
      updatedAt: Date.now()
    });
    current.items[idx] = updated;
    this.saveLibrary(current);
    return updated;
  }

  removeItem(id) {
    if (typeof id !== 'string') return false;
    const current = this.loadLibrary();
    const before = current.items.length;
    current.items = current.items.filter(it => it.id !== id);
    if (current.items.length === before) return false;
    this.saveLibrary(current);
    return true;
  }

  incrementUsage(id) {
    if (typeof id !== 'string') return 0;
    const current = this.loadLibrary();
    const item = current.items.find(it => it.id === id);
    if (!item) return 0;
    item.usageCount = (item.usageCount || 0) + 1;
    item.updatedAt = Date.now();
    this.saveLibrary(current);
    return item.usageCount;
  }

  searchItems({ query = '', category = '全部', sortBy = 'updatedAt' } = {}) {
    const current = this.loadLibrary();
    const q = cleanString(query, 100).toLowerCase();
    const cat = cleanString(category, 20);

    let res = current.items.filter(it => {
      if (cat && cat !== '全部' && it.category !== cat) return false;
      if (!q) return true;
      return it.name.toLowerCase().includes(q) ||
        it.description.toLowerCase().includes(q) ||
        it.assetKey.toLowerCase().includes(q) ||
        it.tags.some(t => t.toLowerCase().includes(q));
    });

    if (sortBy === 'usageCount') {
      res.sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0));
    } else {
      res.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    }
    return res;
  }
}

module.exports = {
  CanvasAssets,
  AssetLibraryStore,
  ASSET_CATEGORIES,
  isSafeAssetKey,
  decodeDataUrl,
  extOf,
  mimeOfKey,
  collectAssetKeys
};
