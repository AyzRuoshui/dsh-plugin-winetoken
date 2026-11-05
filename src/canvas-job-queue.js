// -*- coding: utf-8 -*-
/**
 * WineToken 漫剧画布后台异步任务队列与 WAL (Write-Ahead Log) 预写日志器
 * 确保生图/生成任务脱离 React UI 生命周期，防止切 Tab 导致资产丢失并支持断点恢复
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

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

// 导出全局单例
const canvasJobQueueInstance = new CanvasJobQueue();

module.exports = {
  CanvasJobQueue,
  canvasJobQueue: canvasJobQueueInstance
};
