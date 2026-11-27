// -*- coding: utf-8 -*-
/**
 * WineToken 漫剧画布后台异步任务队列与 WAL (Write-Ahead Log) 预写日志器
 * 确保生图/生成任务脱离 React UI 生命周期，防止切 Tab 导致资产丢失并支持断点恢复
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

class CanvasJobQueue {
  constructor(customStorageDir = null) {
    this.storageDir = customStorageDir || path.join(os.homedir(), '.dsh', 'storages');
    this.taskFilePath = path.join(this.storageDir, 'winetoken_canvas_tasks.json');
    this.tempFilePath = path.join(this.storageDir, 'winetoken_canvas_tasks.json.tmp');
    this.listeners = new Set();
    this.tasks = new Map();
    this._ensureDir();
    this._loadTasks();
  }

  _ensureDir() {
    try {
      if (!fs.existsSync(this.storageDir)) {
        fs.mkdirSync(this.storageDir, { recursive: true });
      }
    } catch (_) {}
  }

  _loadTasks() {
    this._ensureDir();
    if (fs.existsSync(this.taskFilePath)) {
      try {
        const raw = fs.readFileSync(this.taskFilePath, 'utf8');
        const list = JSON.parse(raw);
        if (Array.isArray(list)) {
          list.forEach(t => {
            if (t && t.id) this.tasks.set(t.id, t);
          });
        }
      } catch (err) {
        console.warn('[WineToken JobQueue] 读取任务存根失败:', err.message);
      }
    }
  }

  _persist() {
    try {
      const list = Array.from(this.tasks.values()).slice(-100); // 最多保留最近 100 条任务日志
      const str = JSON.stringify(list, null, 2);
      fs.writeFileSync(this.tempFilePath, str, 'utf8');
      fs.renameSync(this.tempFilePath, this.taskFilePath);
    } catch (err) {
      console.warn('[WineToken JobQueue] WAL 任务持久化失败:', err.message);
    }
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  _notify(task) {
    this.listeners.forEach(fn => {
      try {
        fn(task);
      } catch (_) {}
    });
  }

  /**
   * WAL 预写日志：发起实际 HTTP 请求前，先将任务写入磁盘
   */
  createJob({ id, panelId, prompt, model, size, characterId }) {
    const taskId = id || 'job_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const job = {
      id: taskId,
      panelId,
      prompt,
      model: model || 'sensenova-u1.5-lite',
      size: size || '1024x1024',
      characterId: characterId || null,
      status: 'pending',
      resultUrl: null,
      error: null,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    this.tasks.set(taskId, job);
    this._persist();
    this._notify(job);
    return job;
  }

  /**
   * 任务状态跃迁：成功完成
   */
  completeJob(taskId, resultUrl) {
    const job = this.tasks.get(taskId);
    if (!job) return null;
    job.status = 'completed';
    job.resultUrl = resultUrl;
    job.updatedAt = Date.now();
    this._persist();
    this._notify(job);
    return job;
  }

  /**
   * 任务状态跃迁：失败
   */
  failJob(taskId, errorMsg) {
    const job = this.tasks.get(taskId);
    if (!job) return null;
    job.status = 'failed';
    job.error = errorMsg;
    job.updatedAt = Date.now();
    this._persist();
    this._notify(job);
    return job;
  }

  getJob(taskId) {
    return this.tasks.get(taskId) || null;
  }

  getPendingJobs() {
    return Array.from(this.tasks.values()).filter(t => t.status === 'pending');
  }

  getJobsForPanel(panelId) {
    return Array.from(this.tasks.values()).filter(t => t.panelId === panelId);
  }
}

// v2.5.19：惰性全局单例——import 本模块不得触发任何 fs I/O 或抛错（打包后 import 即崩的隐患）。
// 保留 module.exports.canvasJobQueue 的原语义（读属性时才构造，之后恒为同一实例），
// client.js:201 `queueMod.canvasJobQueue` 与既有单测的读取方式逐字不变。
let _canvasJobQueueInstance = null;
function getCanvasJobQueue() {
  if (!_canvasJobQueueInstance) _canvasJobQueueInstance = new CanvasJobQueue();
  return _canvasJobQueueInstance;
}

module.exports = {
  CanvasJobQueue,
  get canvasJobQueue() { return getCanvasJobQueue(); }
};
