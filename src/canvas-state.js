// -*- coding: utf-8 -*-
/**
 * WineToken 画布宿主侧状态桥 (CanvasStateBridge)
 * 对位上游 infinite-canvas 的本地 Canvas Agent: 让宿主 Node 进程里的 DSH 原生 Tool
 * 能读取/修改当前漫剧画布。渲染进程状态在 React 内存中、宿主无法直连，且铁律要求
 * 「宿主机制零假设」，因此以磁盘工程文件作为唯一权威桥：
 *   - 读: ~/.dsh/storages/winetoken_projects/index.json -> activeId -> <id>.json
 *   - 写: 原子 .tmp -> .bak -> rename -> 物理回读强校验，失败真实抛错
 *   - 生成请求不在此直接发付费 HTTP，只写 WAL 任务存根，由渲染进程消费执行
 * 零外部依赖、无动态代码执行、不访问渲染进程内存。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;
const MAX_PROMPT = 4000;
const MAX_PANELS = 500;

function isValidId(id) {
  return typeof id === 'string' && SAFE_ID.test(id) && !id.includes('\u0000');
}

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** 名称/提示词清洗：剔除控制字符、限长，杜绝把换行注进工程文件 */
function cleanText(value, max, fallback) {
  if (typeof value !== 'string') return fallback;
  const cleaned = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim();
  return cleaned ? cleaned.slice(0, max) : fallback;
}

/** 归一化工程增量字段，与 canvas-project-store.js 口径一致 (旧工程零迁移) */
function normalizeProject(raw) {
  const src = isObject(raw) ? raw : {};
  const vp = isObject(src.viewport) ? src.viewport : {};
  return {
    ...src,
    characters: Array.isArray(src.characters) ? src.characters : [],
    panels: Array.isArray(src.panels) ? src.panels : [],
    canvasItems: Array.isArray(src.canvasItems) ? src.canvasItems : [],
    edges: Array.isArray(src.edges) ? src.edges : [],
    groups: Array.isArray(src.groups) ? src.groups : [],
    nodes: Array.isArray(src.nodes) ? src.nodes : [],
    viewport: {
      x: Number.isFinite(vp.x) ? vp.x : 40,
      y: Number.isFinite(vp.y) ? vp.y : 30,
      zoom: Number.isFinite(vp.zoom) ? vp.zoom : 1
    },
    activeModel: typeof src.activeModel === 'string' ? src.activeModel : ''
  };
}

class CanvasStateBridge {
  constructor(customStorageDir = null) {
    this.storageDir = customStorageDir || path.join(os.homedir(), '.dsh', 'storages');
    this.projectsDir = path.join(this.storageDir, 'winetoken_projects');
    this.registryPath = path.join(this.projectsDir, 'index.json');
    this.registryBakPath = this.registryPath + '.bak';
    this.legacyPath = path.join(this.storageDir, 'winetoken_canvas_project.json');
    this.tasksPath = path.join(this.storageDir, 'winetoken_canvas_tasks.json');
  }

  _ensureDir() {
    if (!fs.existsSync(this.projectsDir)) fs.mkdirSync(this.projectsDir, { recursive: true });
  }

  /** 读注册表：主文件 -> 备份 -> 空，永不抛错 */
  _readRegistry() {
    for (const file of [this.registryPath, this.registryBakPath]) {
      try {
        if (!fs.existsSync(file)) continue;
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!isObject(parsed)) continue;
        const projects = Array.isArray(parsed.projects)
          ? parsed.projects.filter(p => isObject(p) && isValidId(p.id)) : [];
        return {
          activeId: isValidId(parsed.activeId) && projects.some(p => p.id === parsed.activeId)
            ? parsed.activeId
            : (projects[0] ? projects[0].id : null),
          projects
        };
      } catch (_) {}
    }
    return { activeId: null, projects: [] };
  }

  /** 原子写 JSON + 物理回读强校验，任何失败真实抛错 (铁律 3) */
  _atomicWrite(filePath, payload, label) {
    this._ensureDir();
    const expected = JSON.stringify(payload, null, 2);
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, expected, 'utf8');
    if (fs.existsSync(filePath)) fs.copyFileSync(filePath, filePath + '.bak');
    fs.renameSync(tmp, filePath);
    let readBack;
    try {
      readBack = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      throw new Error(`[WineToken CanvasBridge] ${label} 物理回读失败: ${err.message}`);
    }
    let parsed;
    try {
      parsed = JSON.parse(readBack);
    } catch (err) {
      throw new Error(`[WineToken CanvasBridge] ${label} 回读内容非合法 JSON: ${err.message}`);
    }
    if (JSON.stringify(parsed, null, 2) !== expected) {
      throw new Error(`[WineToken CanvasBridge] ${label} 回读内容与写入不一致，已中止`);
    }
    return true;
  }

  /** 解析当前激活工程：优先注册表，注册表为空时回退旧单文件 (只读，不迁移) */
  resolveActive() {
    const reg = this._readRegistry();
    if (reg.activeId) {
      const file = path.join(this.projectsDir, `${reg.activeId}.json`);
      if (fs.existsSync(file)) return { id: reg.activeId, file, source: 'registry' };
      throw new Error(`[WineToken CanvasBridge] 激活工程 ${reg.activeId} 文件缺失，请先打开一次画布`);
    }
    if (fs.existsSync(this.legacyPath)) return { id: null, file: this.legacyPath, source: 'legacy' };
    throw new Error('[WineToken CanvasBridge] 未找到任何画布工程，请先打开一次漫剧画布');
  }

  /** 读取当前故事板摘要 (只读工具用) */
  getStoryboard() {
    const active = this.resolveActive();
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(active.file, 'utf8'));
    } catch (err) {
      throw new Error(`[WineToken CanvasBridge] 工程读取失败: ${err.message}`);
    }
    const project = normalizeProject(parsed);
    const panels = project.panels.map(p => ({
      id: String(p.id || ''),
      num: Number.isFinite(p.num) ? p.num : null,
      prompt: cleanText(p.prompt, 300, ''),
      dialogue: cleanText(p.dialogue, 200, ''),
      shot: typeof p.shot === 'string' ? p.shot : '',
      characterId: typeof p.characterId === 'string' ? p.characterId : '',
      hasImage: Boolean(p.imageUrl || p.stagingCandidateUrl)
    }));
    const characters = project.characters.map(c => ({
      id: String(c.id || ''),
      name: cleanText(c.name, 80, '未命名角色')
    }));
    return {
      projectId: active.id,
      source: active.source,
      totalPanels: panels.length,
      totalItems: project.canvasItems.length,
      totalEdges: project.edges.length,
      totalGroups: project.groups.length,
      activeModel: project.activeModel,
      characters,
      panels
    };
  }

  /** 追加分镜 (写工具用)，返回新分镜与工程文件路径 */
  addPanel({ prompt = '', dialogue = '', shot = 'MS', characterId = '', aspectRatio = '2:3', model = '' } = {}) {
    const active = this.resolveActive();
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(active.file, 'utf8'));
    } catch (err) {
      throw new Error(`[WineToken CanvasBridge] 工程读取失败: ${err.message}`);
    }
    const project = normalizeProject(parsed);
    if (project.panels.length >= MAX_PANELS) {
      throw new Error(`[WineToken CanvasBridge] 分镜数已达上限 ${MAX_PANELS}，拒绝继续追加`);
    }
    const maxNum = project.panels.reduce((m, p) => Math.max(m, Number.isFinite(p.num) ? p.num : 0), 0);
    const maxX = project.panels.reduce((m, p) => Math.max(m, Number.isFinite(p.x) ? p.x : 0), 360);
    const shotLabels = { CU: '特写', MS: '中景', WS: '远景', FS: '全景' };
    const safeShot = Object.prototype.hasOwnProperty.call(shotLabels, shot) ? shot : 'MS';
    const stamp = Date.now();
    const panel = {
      id: `shot_tool_${stamp}_${Math.random().toString(36).slice(2, 6)}`,
      num: maxNum + 1,
      x: Math.round((maxX + 320) / 8) * 8,
      y: 60,
      width: 280,
      height: 420,
      aspectRatio: ['2:3', '16:9', '1:1'].includes(aspectRatio) ? aspectRatio : '2:3',
      shot: safeShot,
      shotLabel: shotLabels[safeShot],
      prompt: cleanText(prompt, MAX_PROMPT, ''),
      dialogue: cleanText(dialogue, 500, ''),
      characterId: cleanText(characterId, 80, ''),
      imageUrl: '',
      candidates: [],
      status: 'idle',
      createdBy: 'tool'
    };
    project.panels.push(panel);
    if (!Array.isArray(project.nodes)) project.nodes = [];
    project.nodes.push({
      id: panel.id,
      type: 'panelNode',
      position: { x: panel.x, y: panel.y },
      width: panel.width,
      height: panel.height,
      data: {
        num: panel.num,
        prompt: panel.prompt,
        dialogue: panel.dialogue,
        shot: panel.shot,
        shotLabel: panel.shotLabel,
        aspectRatio: panel.aspectRatio,
        characterId: panel.characterId,
        imageUrl: panel.imageUrl,
        candidates: panel.candidates,
        status: panel.status,
        isGenerating: false,
        tags: []
      }
    });
    project.updatedAt = stamp;
    this._atomicWrite(active.file, project, '追加分镜');
    return { projectId: active.id, projectFile: active.file, panel };
  }

  /**
   * 生成请求入队: 只写 WAL 存根，绝不在此发付费 HTTP。
   * 渲染进程的 CanvasJobQueue 订阅同一文件，由它执行真实请求并回写结果。
   * 返回结构化状态，杜绝「宿主扣一次费、前端再扣一次」的双花风险。
   */
  enqueueGeneration({ panelId = '', prompt = '', model = '', size = '1024x1024', kind = 'image' } = {}) {
    const active = this.resolveActive();
    const taskId = `job_tool_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const job = {
      id: taskId,
      panelId: cleanText(panelId, 120, ''),
      prompt: cleanText(prompt, MAX_PROMPT, ''),
      model: cleanText(model, 200, ''),
      size: cleanText(size, 40, '1024x1024'),
      kind: kind === 'video' ? 'video' : 'image',
      characterId: null,
      status: 'pending',
      resultUrl: null,
      error: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      source: 'tool'
    };
    let list = [];
    try {
      if (fs.existsSync(this.tasksPath)) {
        const parsed = JSON.parse(fs.readFileSync(this.tasksPath, 'utf8'));
        if (Array.isArray(parsed)) list = parsed;
      }
    } catch (_) {
      // 存根损坏时从空列表重建，并把损坏情况如实记入警告 (不静默吞)
      console.warn('[WineToken CanvasBridge] WAL 存根损坏，已重建为空列表');
    }
    list.push(job);
    this._atomicWrite(this.tasksPath, list.slice(-100), '生成任务入队');
    return { taskId, projectId: active.id, status: 'queued', dispatched: false };
  }
}

module.exports = {
  CanvasStateBridge,
  isValidId,
  cleanText,
  normalizeProject
};
