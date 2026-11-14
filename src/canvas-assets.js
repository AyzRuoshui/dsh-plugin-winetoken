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

module.exports = {
  CanvasAssets,
  isSafeAssetKey,
  decodeDataUrl,
  extOf,
  mimeOfKey,
  collectAssetKeys
};
