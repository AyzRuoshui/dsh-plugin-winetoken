// -*- coding: utf-8 -*-
/**
 * WineToken 漫剧画布多工程注册表 (CanvasProjectStore)
 * 对位上游 infinite-canvas 的 zustand canvas store (projects[] / deletedProjects[])，
 * 但按 DSH 插件实际调整为纯 fs 落盘，零外部依赖：
 *   - 工程注册表 index.json + 每工程独立 <id>.json，全部落 ~/.dsh/storages/winetoken_projects/
 *   - 旧单文件 winetoken_canvas_project.json 首次运行零迁移接入为默认工程 (不改动原文件)
 *   - 所有写盘一律原子 rename + 双备份 + 物理回读强校验，失败向调用者真实抛错
 */
// v2.5.19：web 渲染进程无 Node 原生 fs/path/os（打包后 import 即崩）。
// Node 端（既有单测）走真实 fs；打包产物里 esbuild 把 fs/path/os alias 到空 stub，
// 探测得到 false，走内存/LocalStorage 垫片。
let HAS_FS = false;
try {
  const _fsProbe = require('fs');
  HAS_FS = Boolean(_fsProbe && typeof _fsProbe.existsSync === 'function');
} catch (_) { HAS_FS = false; }
const _shim = HAS_FS ? null : require('./vendor/memfs-shim.cjs');
const fs = HAS_FS ? require('fs') : _shim.fs;
const path = HAS_FS ? require('path') : _shim.path;
const os = HAS_FS ? require('os') : _shim.os;

const REGISTRY_VERSION = 1;
const PROJECT_VERSION = '2.5.1';
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

function toFiniteNumber(v, fallback) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

function extractEndpointId(endpoint) {
  if (typeof endpoint === 'string' || typeof endpoint === 'number') {
    const s = String(endpoint).trim();
    return s.length > 0 ? s : null;
  }
  if (endpoint && typeof endpoint === 'object' && !Array.isArray(endpoint)) {
    const keys = ['id', 'nodeId', 'fromNodeId', 'toNodeId', 'targetId', 'sourceId'];
    for (const k of keys) {
      if (endpoint[k] !== undefined && endpoint[k] !== null) {
        const s = String(endpoint[k]).trim();
        if (s.length > 0) return s;
      }
    }
  }
  return null;
}

/** 一次性无损转换器：旧工程结构 -> React Flow nodes/edges */
function migrateToReactFlow(legacyProject) {
  const src = legacyProject && typeof legacyProject === 'object' && !Array.isArray(legacyProject) ? legacyProject : {};
  const nodes = [];
  const edges = [];
  const chars = Array.isArray(src.characters) ? src.characters : [];
  const panels = Array.isArray(src.panels) ? src.panels : [];
  const items = Array.isArray(src.canvasItems) ? src.canvasItems : [];
  const groups = Array.isArray(src.groups) ? src.groups : [];

  // 1. Characters -> characterNode
  chars.forEach((c, idx) => {
    if (!c || typeof c !== 'object') return;
    const cid = String(c.id || `char_${idx}`);
    nodes.push({
      id: cid,
      type: 'characterNode',
      position: {
        x: toFiniteNumber(c.x, 40),
        y: toFiniteNumber(c.y, 60 + idx * 246)
      },
      data: {
        name: typeof c.name === 'string' ? c.name : (typeof c.name === 'number' ? String(c.name) : '未命名角色'),
        dna: typeof c.dna === 'string' ? c.dna : '',
        avatar: typeof c.avatar === 'string' ? c.avatar : '',
        tags: Array.isArray(c.tags) ? c.tags : []
      }
    });
  });

  // 2. Panels -> panelNode
  panels.forEach((p, idx) => {
    if (!p || typeof p !== 'object') return;
    const pid = String(p.id || `shot_${idx + 1}`);
    const num = Number.isFinite(p.num) ? p.num : (idx + 1);
    nodes.push({
      id: pid,
      type: 'panelNode',
      position: {
        x: toFiniteNumber(p.x, 360 + idx * 320),
        y: toFiniteNumber(p.y, 60)
      },
      width: toFiniteNumber(p.width, 280),
      height: toFiniteNumber(p.height, 420),
      data: {
        num,
        prompt: typeof p.prompt === 'string' ? p.prompt : '',
        dialogue: typeof p.dialogue === 'string' ? p.dialogue : '',
        shot: typeof p.shot === 'string' ? p.shot : 'CU',
        shotLabel: typeof p.shotLabel === 'string' ? p.shotLabel : '特写',
        aspectRatio: typeof p.aspectRatio === 'string' ? p.aspectRatio : '2:3',
        characterId: typeof p.characterId === 'string' ? p.characterId : (chars[0]?.id || ''),
        imageUrl: typeof p.imageUrl === 'string' ? p.imageUrl : '',
        stagingCandidateUrl: typeof p.stagingCandidateUrl === 'string' ? p.stagingCandidateUrl : null,
        candidates: Array.isArray(p.candidates) ? p.candidates : [],
        status: typeof p.status === 'string' ? p.status : 'idle',
        isGenerating: Boolean(p.isGenerating),
        tags: Array.isArray(p.tags) ? p.tags : []
      }
    });
  });

  // 3. CanvasItems -> imageNode / videoNode / textNode
  items.forEach((item, idx) => {
    if (!item || typeof item !== 'object') return;
    const iid = String(item.id || `item_${idx}`);
    const itemData = item.data && typeof item.data === 'object' ? item.data : {};
    const itemType = (item.type === 'video' || item.type === 'text') ? item.type : 'image';
    const nodeType = itemType === 'video' ? 'videoNode' : (itemType === 'text' ? 'textNode' : 'imageNode');
    nodes.push({
      id: iid,
      type: nodeType,
      position: {
        x: toFiniteNumber(item.x, 700 + idx * 50),
        y: toFiniteNumber(item.y, 100 + idx * 50)
      },
      width: toFiniteNumber(item.width, itemType === 'video' ? 330 : 290),
      height: toFiniteNumber(item.height, itemType === 'video' ? 470 : (itemType === 'text' ? 160 : 460)),
      data: {
        ...itemData,
        name: typeof itemData.name === 'string' ? itemData.name : (itemType === 'video' ? '视频生成节点' : (itemType === 'text' ? '文本便签' : '图片生成节点')),
        tags: Array.isArray(itemData.tags) ? itemData.tags : [],
        params: itemData.params && typeof itemData.params === 'object' ? { ...itemData.params } : {}
      }
    });
  });

  // 4. Groups -> groupNode
  groups.forEach((g, idx) => {
    if (!g || typeof g !== 'object') return;
    const gid = String(g.id || `group_${idx}`);
    nodes.push({
      id: gid,
      type: 'groupNode',
      position: {
        x: toFiniteNumber(g.x, 0),
        y: toFiniteNumber(g.y, 0)
      },
      data: {
        name: typeof g.name === 'string' ? g.name : (typeof g.label === 'string' ? g.label : '未命名分组'),
        memberIds: Array.isArray(g.memberIds) ? g.memberIds : []
      },
      style: {
        width: toFiniteNumber(g.width, 400),
        height: toFiniteNumber(g.height, 300)
      }
    });
  });

  // 5. Edges -> React Flow edge (type 统一为 'default'，杜绝 'bezier')
  const rawEdges = Array.isArray(src.edges) ? src.edges : [];
  rawEdges.forEach((e, idx) => {
    if (!e || typeof e !== 'object') return;
    const fromId = extractEndpointId(e.from !== undefined ? e.from : (e.fromNodeId !== undefined ? e.fromNodeId : e.source));
    const toId = extractEndpointId(e.to !== undefined ? e.to : (e.toNodeId !== undefined ? e.toNodeId : e.target));
    if (!fromId || !toId || fromId === toId) return;
    const eid = String(e.id || `edge_${fromId}_${toId}_${idx}`);
    edges.push({
      id: eid,
      source: fromId,
      target: toId,
      type: 'default',
      from: { type: 'item', id: fromId },
      to: { type: 'panel', id: toId }
    });
  });

  const viewport = src.viewport && typeof src.viewport === 'object' ? src.viewport : {};

  return {
    ...src,
    version: '2.5.1',
    nodes,
    edges,
    characters: chars,
    panels,
    canvasItems: items,
    groups,
    viewport: {
      x: toFiniteNumber(viewport.x, 40),
      y: toFiniteNumber(viewport.y, 30),
      zoom: toFiniteNumber(viewport.zoom, 1)
    },
    activeModel: typeof src.activeModel === 'string' ? src.activeModel : ''
  };
}

/** 归一化工程数据：支持 React Flow 原生 nodes/edges 与向后兼容双向映射 */
function normalizeProject(raw, id, name) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const viewport = src.viewport && typeof src.viewport === 'object' ? src.viewport : {};

  let nodes = [];
  let edges = [];
  let characters = Array.isArray(src.characters) ? src.characters.filter(Boolean) : [];
  let panels = Array.isArray(src.panels) ? src.panels.filter(Boolean) : [];
  let canvasItems = Array.isArray(src.canvasItems) ? src.canvasItems.filter(Boolean) : [];
  let groups = Array.isArray(src.groups) ? src.groups.filter(Boolean) : [];

  if (Array.isArray(src.nodes)) {
    // 已经包含 nodes，归一化每个节点
    src.nodes.forEach(n => {
      if (!n || typeof n !== 'object') return;
      const nid = String(n.id || '');
      if (!nid) return;
      const pos = n.position && typeof n.position === 'object' ? n.position : {};
      const data = n.data && typeof n.data === 'object' ? n.data : {};
      const t = String(n.type || 'imageNode');
      nodes.push({
        ...n,
        id: nid,
        type: t,
        position: {
          x: toFiniteNumber(pos.x !== undefined ? pos.x : n.x, 0),
          y: toFiniteNumber(pos.y !== undefined ? pos.y : n.y, 0)
        },
        data
      });
    });

    // 从 nodes 派生/同步 legacy 数组（若 legacy 数组为空）
    if (characters.length === 0) {
      nodes.filter(n => n.type === 'characterNode' || n.type === 'character').forEach(n => {
        characters.push({
          id: n.id,
          name: n.data?.name || '未命名角色',
          dna: n.data?.dna || '',
          avatar: n.data?.avatar || '',
          tags: Array.isArray(n.data?.tags) ? n.data.tags : [],
          x: n.position.x,
          y: n.position.y
        });
      });
    }
    if (panels.length === 0) {
      nodes.filter(n => n.type === 'panelNode' || n.type === 'panel').forEach(n => {
        panels.push({
          id: n.id,
          num: n.data?.num || 1,
          prompt: n.data?.prompt || '',
          dialogue: n.data?.dialogue || '',
          shot: n.data?.shot || 'CU',
          shotLabel: n.data?.shotLabel || '特写',
          aspectRatio: n.data?.aspectRatio || '2:3',
          characterId: n.data?.characterId || '',
          imageUrl: n.data?.imageUrl || '',
          stagingCandidateUrl: n.data?.stagingCandidateUrl || null,
          candidates: Array.isArray(n.data?.candidates) ? n.data.candidates : [],
          status: n.data?.status || 'idle',
          isGenerating: Boolean(n.data?.isGenerating),
          tags: Array.isArray(n.data?.tags) ? n.data.tags : [],
          x: n.position.x,
          y: n.position.y,
          width: toFiniteNumber(n.width, 280),
          height: toFiniteNumber(n.height, 420)
        });
      });
    }
    if (canvasItems.length === 0) {
      nodes.filter(n => ['imageNode', 'videoNode', 'textNode', 'image', 'video', 'text'].includes(n.type)).forEach(n => {
        const itemType = (n.type === 'videoNode' || n.type === 'video') ? 'video'
          : ((n.type === 'textNode' || n.type === 'text') ? 'text' : 'image');
        canvasItems.push({
          id: n.id,
          type: itemType,
          x: n.position.x,
          y: n.position.y,
          width: toFiniteNumber(n.width, itemType === 'video' ? 330 : 290),
          height: toFiniteNumber(n.height, itemType === 'video' ? 470 : (itemType === 'text' ? 160 : 460)),
          data: n.data
        });
      });
    }
    if (groups.length === 0) {
      nodes.filter(n => n.type === 'groupNode' || n.type === 'group').forEach(n => {
        groups.push({
          id: n.id,
          name: n.data?.name || '未命名分组',
          memberIds: Array.isArray(n.data?.memberIds) ? n.data.memberIds : [],
          width: toFiniteNumber(n.style?.width || n.width, 400),
          height: toFiniteNumber(n.style?.height || n.height, 300),
          x: n.position.x,
          y: n.position.y
        });
      });
    }
  } else {
    // 缺少 nodes，执行完整迁移
    const migrated = migrateToReactFlow(src);
    nodes = migrated.nodes;
    edges = migrated.edges;
    characters = migrated.characters;
    panels = migrated.panels;
    canvasItems = migrated.canvasItems;
    groups = migrated.groups;
  }

  // 归一化 edges
  const rawEdges = Array.isArray(src.edges) ? src.edges : edges;
  const normalizedEdges = [];
  rawEdges.forEach((e, idx) => {
    if (!e || typeof e !== 'object') return;
    const fromId = extractEndpointId(e.from !== undefined ? e.from : (e.fromNodeId !== undefined ? e.fromNodeId : e.source));
    const toId = extractEndpointId(e.to !== undefined ? e.to : (e.toNodeId !== undefined ? e.toNodeId : e.target));
    if (!fromId || !toId || fromId === toId) return;
    const eid = String(e.id || `edge_${fromId}_${toId}_${idx}`);
    normalizedEdges.push({
      id: eid,
      source: fromId,
      target: toId,
      type: 'default', // React Flow 边的注册名统一为 default，杜绝 bezier
      from: { type: 'item', id: fromId },
      to: { type: 'panel', id: toId }
    });
  });

  return {
    ...src,
    id,
    name,
    version: PROJECT_VERSION,
    updatedAt: Number.isFinite(src.updatedAt) ? src.updatedAt : Date.now(),
    nodes,
    edges: normalizedEdges,
    characters,
    panels,
    canvasItems,
    groups,
    viewport: {
      x: toFiniteNumber(viewport.x, 40),
      y: toFiniteNumber(viewport.y, 30),
      zoom: toFiniteNumber(viewport.zoom, 1)
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
    // v2.5.19：优先从打包兄弟表取（web 生产）；Node 单测下回退到静态 require（由 esbuild 构建期内联）。
    const bundled = (typeof globalThis !== 'undefined' && globalThis)
      ? globalThis.__WINETOKEN_BUNDLED_SIBLINGS__ : null;
    const storageMod = (bundled && bundled['./canvas-storage.js']) || require('./canvas-storage.js');
    const { CanvasProjectStorage } = storageMod;
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
    const needsMigration = !Array.isArray(parsed.nodes) || parsed.version !== PROJECT_VERSION;
    const normalized = normalizeProject(parsed, id, meta ? meta.name : '未命名工程');
    if (needsMigration) {
      try {
        this._atomicWriteJson(file, normalized, '无损迁移升级工程');
      } catch (err) {
        console.warn(`[WineToken ProjectStore] 工程 ${id} 迁移写盘告警: ${err.message}`);
      }
    }
    return normalized;
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

module.exports = { CanvasProjectStore, REGISTRY_VERSION, PROJECT_VERSION, isValidId, normalizeProject, migrateToReactFlow };
