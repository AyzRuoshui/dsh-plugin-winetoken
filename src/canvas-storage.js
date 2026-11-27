// -*- coding: utf-8 -*-
/**
 * WineToken 漫剧画布独立持久化存储驱动 (CanvasProjectStorage)
 * 采用先写临时文件后原子重命名 (Atomic Rename) 与双备份机制，彻底防御断电与异常断流
 */
// v2.5.19：web 渲染进程无 Node 原生 fs/path/os（打包后 import 即崩）。
// Node 端（既有单测）走真实 fs；打包产物里 esbuild 把 fs/path/os alias 到空 stub，
// 下面的探测得到 false，于是这组实现走内存/LocalStorage 垫片。
// 关键：require 保持静态字面量（esbuild 才能 alias + 内联，产物不留运行时相对 require）。
let HAS_FS = false;
try {
  const _fsProbe = require('fs');
  HAS_FS = Boolean(_fsProbe && typeof _fsProbe.existsSync === 'function');
} catch (_) { HAS_FS = false; }
const _shim = HAS_FS ? null : require('./vendor/memfs-shim.cjs');
const fs = HAS_FS ? require('fs') : _shim.fs;
const path = HAS_FS ? require('path') : _shim.path;
const os = HAS_FS ? require('os') : _shim.os;

class CanvasProjectStorage {
  constructor(customStorageDir = null) {
    this.storageDir = customStorageDir || path.join(os.homedir(), '.dsh', 'storages');
    this.projectFilePath = path.join(this.storageDir, 'winetoken_canvas_project.json');
    this.backupFilePath = path.join(this.storageDir, 'winetoken_canvas_project.json.bak');
    this.tempFilePath = path.join(this.storageDir, 'winetoken_canvas_project.json.tmp');
    this._debounceTimer = null;
    this._ensureDir();
  }

  _ensureDir() {
    try {
      if (!fs.existsSync(this.storageDir)) {
        fs.mkdirSync(this.storageDir, { recursive: true });
      }
    } catch (err) {
      console.warn('[WineToken CanvasStorage] 创建存储目录失败:', err.message);
    }
  }

  /**
   * 获取默认初始工程数据结构
   */
  getDefaultProject() {
    return {
      version: '2.2.0',
      updatedAt: Date.now(),
      characters: [
        {
          id: 'char_chuyun',
          name: '主角·楚云',
          dna: '少年剑客，黑袍高领，银白碎发，剑眉星目，冷峻英气，电影质感',
          avatar: ''
        }
      ],
      panels: [
        {
          id: 'shot_01',
          num: 1,
          x: 360,
          y: 60,
          width: 280,
          height: 420,
          aspectRatio: '2:3',
          shot: 'CU',
          shotLabel: '特写',
          prompt: '少年剑客面部特写，发丝微动，冷峻眼神，侧逆光，细致皮肤纹理，虚化背景，电影光影',
          dialogue: '“这一剑，我已等了三年。”',
          characterId: 'char_chuyun',
          imageUrl: '',
          candidates: [],
          status: 'idle'
        }
      ],
      nodes: [
        {
          id: 'char_chuyun',
          type: 'characterNode',
          position: { x: 40, y: 60 },
          data: {
            name: '主角·楚云',
            dna: '少年剑客，黑袍高领，银白碎发，剑眉星目，冷峻英气，电影质感',
            avatar: '',
            tags: []
          }
        },
        {
          id: 'shot_01',
          type: 'panelNode',
          position: { x: 360, y: 60 },
          width: 280,
          height: 420,
          data: {
            num: 1,
            aspectRatio: '2:3',
            shot: 'CU',
            shotLabel: '特写',
            prompt: '少年剑客面部特写，发丝微动，冷峻眼神，侧逆光，细致皮肤纹理，虚化背景，电影光影',
            dialogue: '“这一剑，我已等了三年。”',
            characterId: 'char_chuyun',
            imageUrl: '',
            candidates: [],
            status: 'idle',
            tags: []
          }
        }
      ],
      canvasItems: [],
      edges: [
        {
          id: 'e_char_shot_01',
          source: 'char_chuyun',
          target: 'shot_01',
          type: 'default',
          from: { type: 'character', id: 'char_chuyun' },
          to: { type: 'panel', id: 'shot_01' }
        }
      ],
      groups: [],
      viewport: { x: 40, y: 30, zoom: 1 },
      activeModel: 'sensenova-u1.5-lite'
    };
  }

  /**
   * 安全加载工程：先读主文件，损坏则回退备份，再次回退默认模板
   */
  loadProject() {
    this._ensureDir();
    if (fs.existsSync(this.projectFilePath)) {
      try {
        const raw = fs.readFileSync(this.projectFilePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.characters) && Array.isArray(parsed.panels)) {
          // CANVAS-M2/M3: 增量字段向后兼容 (旧版本工程文件缺省补空，杜绝破坏性迁移)
          parsed.canvasItems = Array.isArray(parsed.canvasItems) ? parsed.canvasItems : [];
          parsed.edges = Array.isArray(parsed.edges) ? parsed.edges : [];
          parsed.groups = Array.isArray(parsed.groups) ? parsed.groups : [];
          parsed.nodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];
          return parsed;
        }
      } catch (err) {
        console.warn('[WineToken CanvasStorage] 主文件损坏，尝试从备份恢复:', err.message);
      }
    }

    if (fs.existsSync(this.backupFilePath)) {
      try {
        const rawBak = fs.readFileSync(this.backupFilePath, 'utf8');
        const parsedBak = JSON.parse(rawBak);
        if (parsedBak && Array.isArray(parsedBak.characters) && Array.isArray(parsedBak.panels)) {
          console.log('[WineToken CanvasStorage] 成功从备份文件恢复工程快照');
          parsedBak.canvasItems = Array.isArray(parsedBak.canvasItems) ? parsedBak.canvasItems : [];
          parsedBak.edges = Array.isArray(parsedBak.edges) ? parsedBak.edges : [];
          parsedBak.groups = Array.isArray(parsedBak.groups) ? parsedBak.groups : [];
          return parsedBak;
        }
      } catch (bakErr) {
        console.warn('[WineToken CanvasStorage] 备份文件恢复失败:', bakErr.message);
      }
    }

    return this.getDefaultProject();
  }

  /**
   * 原子写入保存
   */
  saveProject(data) {
    if (!data) return false;
    this._ensureDir();
    try {
      const payload = {
        ...data,
        version: '2.2.0',
        updatedAt: Date.now()
      };
      const jsonStr = JSON.stringify(payload, null, 2);

      // 1. 写入临时文件
      fs.writeFileSync(this.tempFilePath, jsonStr, 'utf8');

      // 2. 如果已有主文件，先复制为主备份
      if (fs.existsSync(this.projectFilePath)) {
        try {
          fs.copyFileSync(this.projectFilePath, this.backupFilePath);
        } catch (_) {}
      }

      // 3. 原子重命名覆盖
      fs.renameSync(this.tempFilePath, this.projectFilePath);
      return true;
    } catch (err) {
      console.error('[WineToken CanvasStorage] 保存工程失败:', err.message);
      return false;
    }
  }

  /**
   * 防抖原子写盘
   */
  debounceSave(data, delay = 500) {
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
    }
    this._debounceTimer = setTimeout(() => {
      this.saveProject(data);
      this._debounceTimer = null;
    }, delay);
  }
}

module.exports = { CanvasProjectStorage };
