// -*- coding: utf-8 -*-
/**
 * WineToken 漫剧画布独立持久化存储驱动 (CanvasProjectStorage)
 * 采用先写临时文件后原子重命名 (Atomic Rename) 与双备份机制，彻底防御断电与异常断流
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

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
      canvasItems: [],
      edges: [],
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
