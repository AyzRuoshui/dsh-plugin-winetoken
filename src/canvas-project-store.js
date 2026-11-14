// -*- coding: utf-8 -*-
/**
 * WineToken 漫剧画布多工程注册表 (CanvasProjectStore)
 * 对位上游 infinite-canvas 的 zustand canvas store (projects[] / deletedProjects[])，
 * 但按 DSH 插件实际调整为纯 fs 落盘，零外部依赖：
 *   - 工程注册表 index.json + 每工程独立 <id>.json，全部落 ~/.dsh/storages/winetoken_projects/
 *   - 旧单文件 winetoken_canvas_project.json 首次运行零迁移接入为默认工程 (不改动原文件)
 *   - 所有写盘一律原子 rename + 双备份 + 物理回读强校验，失败向调用者真实抛错
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const REGISTRY_VERSION = 1;
const PROJECT_VERSION = '2.3.0';
const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;

/** 过滤控制字符并限制长度，杜绝把换行/ANSI 写进注册表 */
function sanitizeName(name, fallback) {
  if (typeof name !== 'string') return fallback;
  const cleaned = name.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!cleaned) return fallback;
  return cleaned.slice(0, 80);
}

/** 校验工程 id：防路径穿越、防空字节、防斜杠 */
function isValidId(id) {
  return typeof id === 'string' && SAFE_ID.test(id) && !id.includes('\u0000');
}

/** 归一化任意来源的注册表对象，脏数据一律修复而非抛错 */
function normalizeRegistry(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const seen = new Set();
  const normalizeList = (list) => {
    if (!Array.isArray(list)) return [];
    const out = [];
    for (const item of list) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      if (!isValidId(item.id)) continue;
      if (seen.has(item.id)) continue; // 跨 projects/deleted 去重
      seen.add(item.id);
      out.push({
        id: item.id,
        name: sanitizeName(item.name, '未命名工程'),
        createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
        updatedAt: Number.isFinite(item.updatedAt) ? item.updatedAt : Date.now()
      });
    }
    return out;
  };
  const projects = normalizeList(src.projects);
  const deleted = normalizeList(src.deleted || src.deletedProjects);
  const activeId = isValidId(src.activeId) && projects.some(p => p.id === src.activeId)
    ? src.activeId
    : (projects[0] ? projects[0].id : null);
  return { version: REGISTRY_VERSION, activeId, projects, deleted };
}

function emptyRegistry() {
  return { version: REGISTRY_VERSION, activeId: null, projects: [], deleted: [] };
}

/** 复用 canvas-storage.js 的增量兼容语义，绝不破坏性迁移旧工程 */
function normalizeProject(raw, id, name) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const viewport = src.viewport && typeof src.viewport === 'object' ? src.viewport : { x: 40, y: 30, zoom: 1 };
  return {
    ...src,
    id,
    name,
    version: PROJECT_VERSION,
    updatedAt: Number.isFinite(src.updatedAt) ? src.updatedAt : Date.now(),
    characters: Array.isArray(src.characters) ? src.characters : [],
    panels: Array.isArray(src.panels) ? src.panels : [],
    canvasItems: Array.isArray(src.canvasItems) ? src.canvasItems : [],
    edges: Array.isArray(src.edges) ? src.edges : [],
    groups: Array.isArray(src.groups) ? src.groups : [],
    viewport: {
      x: Number.isFinite(viewport.x) ? viewport.x : 40,
      y: Number.isFinite(viewport.y) ? viewport.y : 30,
      zoom: Number.isFinite(viewport.zoom) ? viewport.zoom : 1
    },
    activeModel: typeof src.activeModel === 'string' ? src.activeModel : ''
  };
}

class CanvasProjectStore {
  constructor(customStorageDir = null) {
    this.storageDir = customStorageDir || path.join(os.homedir(), '.dsh', 'storages');
    this.projectsDir = path.join(this.storageDir, 'winetoken_projects');
    this.registryPath = path.join(this.projectsDir, 'index.json');
    this.backupPath = path.join(this.projectsDir, 'index.json.bak');
    this.tempPath = path.join(this.projectsDir, 'index.json.tmp');
    this.legacyPath = path.join(this.storageDir, 'winetoken_canvas_project.json');
    this._ensureDir();
  }

  _ensureDir() {
    if (!fs.existsSync(this.projectsDir)) {
      fs.mkdirSync(this.projectsDir, { recursive: true });
    }
  }

  /** 原子写入任意 JSON 文件：临时文件 -> 旧文件备份 -> rename -> 物理回读强校验 */
  _atomicWriteJson(filePath, payload, label) {
    const tmp = filePath + '.tmp';
    const bak = filePath + '.bak';
    const expected = JSON.stringify(payload, null, 2);
    fs.writeFileSync(tmp, expected, 'utf8');
    if (fs.existsSync(filePath)) {
      try {
        fs.copyFileSync(filePath, bak);
      } catch (err) {
        throw new Error(`[WineToken ProjectStore] ${label} 备份失败: ${err.message}`);
      }
    }
    fs.renameSync(tmp, filePath);
    // 铁律 3：落盘后立即物理回读强校验，失败必须真实抛错，绝不静默返回成功
    let readBack;
    try {
      readBack = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      throw new Error(`[WineToken ProjectStore] ${label} 物理回读失败: ${err.message}`);
    }
    let parsed;
    try {
      parsed = JSON.parse(readBack);
    } catch (err) {
      throw new Error(`[WineToken ProjectStore] ${label} 回读内容非合法 JSON: ${err.message}`);
    }
    if (JSON.stringify(parsed, null, 2) !== expected) {
      throw new Error(`[WineToken ProjectStore] ${label} 回读内容与写入不一致，已中止`);
    }
    return true;
  }

  /** 读注册表：主文件 -> 备份 -> 全新注册表，任何损坏都不抛错、不丢可用数据 */
  _readRegistry() {
    const candidates = [this.registryPath, this.backupPath];
    for (const file of candidates) {
      if (!fs.existsSync(file)) continue;
      try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        return normalizeRegistry(parsed);
      } catch (err) {
        console.warn(`[WineToken ProjectStore] 注册表 ${path.basename(file)} 损坏: ${err.message}`);
      }
    }
    return emptyRegistry();
  }

  _writeRegistry(reg) {
    this._ensureDir();
    const normalized = normalizeRegistry(reg);
    return this._atomicWriteJson(this.registryPath, normalized, '工程注册表');
  }

  /**
   * 旧单文件零迁移接入：仅当注册表为空且旧文件合法时，复制内容成为默认工程。
   * 重复调用幂等；旧文件保持原样，绝不删除或改写用户既有档案。
   */
  ensureLegacyMigration() {
    const reg = this._readRegistry();
    if (reg.projects.length > 0 || reg.deleted.length > 0) return false;
    if (!fs.existsSync(this.legacyPath)) return false;
    let legacy;
    try {
      legacy = JSON.parse(fs.readFileSync(this.legacyPath, 'utf8'));
    } catch (err) {
      console.warn(`[WineToken ProjectStore] 旧工程文件损坏，跳过迁移: ${err.message}`);
      return false;
    }
    if (!legacy || !Array.isArray(legacy.characters) || !Array.isArray(legacy.panels)) return false;
    const id = 'project_default';
    const name = '默认工程';
    const meta = { id, name, createdAt: Date.now(), updatedAt: Date.now() };
    // 先写工程内容，再写注册表：中途失败不会留下"注册表指向空文件"的坏状态
    this._atomicWriteJson(this.projectFilePath(id), normalizeProject(legacy, id, name), '迁移工程');
    this._writeRegistry({ version: REGISTRY_VERSION, activeId: id, projects: [meta], deleted: [] });
    return true;
  }

  projectFilePath(id) {
    if (!isValidId(id)) throw new Error(`[WineToken ProjectStore] 非法工程 id: ${String(id)}`);
    return path.join(this.projectsDir, `${id}.json`);
  }

  listProjects() {
    return this._readRegistry().projects.slice();
  }

  listDeleted() {
    return this._readRegistry().deleted.slice();
  }

  getActiveId() {
    return this._readRegistry().activeId;
  }

  setActiveId(id) {
    const reg = this._readRegistry();
    if (!reg.projects.some(p => p.id === id)) return false;
    reg.activeId = id;
    return this._writeRegistry(reg);
  }

  createProject(name) {
    const reg = this._readRegistry();
    let id;
    do {
      id = 'project_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
    } while (reg.projects.some(p => p.id === id) || reg.deleted.some(p => p.id === id));
    const meta = {
      id,
      name: sanitizeName(name, '未命名工程'),
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    reg.projects.push(meta);
    if (!reg.activeId) reg.activeId = id;
    // 先落工程文件再落注册表，避免悬空引用
    const { CanvasProjectStorage } = require('./canvas-storage.js');
    const blank = new CanvasProjectStorage(this.projectsDir).getDefaultProject();
    this._atomicWriteJson(this.projectFilePath(id), normalizeProject(blank, id, meta.name), '新建工程');
    this._writeRegistry(reg);
    return meta;
  }

  renameProject(id, name) {
    if (!isValidId(id)) return null;
    const reg = this._readRegistry();
    const meta = reg.projects.find(p => p.id === id) || reg.deleted.find(p => p.id === id);
    if (!meta) return null;
    meta.name = sanitizeName(name, meta.name);
    meta.updatedAt = Date.now();
    this._writeRegistry(reg);
    return { ...meta };
  }

  deleteProject(id) {
    if (!isValidId(id)) return false;
    const reg = this._readRegistry();
    const idx = reg.projects.findIndex(p => p.id === id);
    if (idx < 0) return false;
    const [meta] = reg.projects.splice(idx, 1);
    meta.updatedAt = Date.now();
    reg.deleted.push(meta);
    if (reg.activeId === id) {
      reg.activeId = reg.projects.length ? reg.projects[0].id : null;
    }
    this._writeRegistry(reg);
    return true;
  }

  restoreProject(id) {
    if (!isValidId(id)) return false;
    const reg = this._readRegistry();
    const idx = reg.deleted.findIndex(p => p.id === id);
    if (idx < 0) return false;
    const [meta] = reg.deleted.splice(idx, 1);
    meta.updatedAt = Date.now();
    reg.projects.push(meta);
    if (!reg.activeId) reg.activeId = id;
    this._writeRegistry(reg);
    return true;
  }

  purgeProject(id) {
    if (!isValidId(id)) return false;
    const reg = this._readRegistry();
    const before = reg.projects.length + reg.deleted.length;
    reg.projects = reg.projects.filter(p => p.id !== id);
    reg.deleted = reg.deleted.filter(p => p.id !== id);
    if (reg.projects.length + reg.deleted.length === before) return false;
    if (reg.activeId === id) {
      reg.activeId = reg.projects.length ? reg.projects[0].id : null;
    }
    this._writeRegistry(reg);
    const file = this.projectFilePath(id);
    if (fs.existsSync(file)) fs.unlinkSync(file);
    return true;
  }

  /** 载入工程：损坏/缺失一律真实抛错，由 UI 明确透传，绝不静默降级为空画布 */
  loadProject(id) {
    if (!isValidId(id)) throw new Error(`[WineToken ProjectStore] 非法工程 id: ${String(id)}`);
    const file = this.projectFilePath(id);
    const reg = this._readRegistry();
    const meta = reg.projects.find(p => p.id === id) || reg.deleted.find(p => p.id === id);
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      throw new Error(`[WineToken ProjectStore] 工程 ${id} 读取失败: ${err.message}`);
    }
    return normalizeProject(parsed, id, meta ? meta.name : '未命名工程');
  }

  saveProject(id, data) {
    if (!isValidId(id)) throw new Error(`[WineToken ProjectStore] 非法工程 id: ${String(id)}`);
    const reg = this._readRegistry();
    const meta = reg.projects.find(p => p.id === id);
    if (!meta) throw new Error(`[WineToken ProjectStore] 工程 ${id} 不在注册表中，拒绝写入`);
    const payload = normalizeProject({ ...data, updatedAt: Date.now() }, id, meta.name);
    this._atomicWriteJson(this.projectFilePath(id), payload, '工程内容');
    meta.updatedAt = payload.updatedAt;
    this._writeRegistry(reg);
    return true;
  }
}

module.exports = { CanvasProjectStore, REGISTRY_VERSION, PROJECT_VERSION, isValidId };
