// -*- coding: utf-8 -*-
/**
 * WineToken 创作工坊持久化历史管理模块
 * 自动同步聊天中大模型自主调用的生成记录与工坊手动生成记录
 */
const fs = require('fs');
const path = require('path');
const { homedir } = require('os');

const DSH_STORAGES_DIR = path.join(homedir(), '.dsh', 'storages');
const HISTORY_FILE = path.join(DSH_STORAGES_DIR, 'winetoken_studio_history.json');
const MAX_HISTORY_ITEMS = 200;

/**
 * 确保存储目录存在
 */
function ensureStorageDir() {
  try {
    if (!fs.existsSync(DSH_STORAGES_DIR)) {
      fs.mkdirSync(DSH_STORAGES_DIR, { recursive: true });
    }
  } catch (_) {}
}

/**
 * 读取历史列表
 */
function getHistoryList() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const raw = fs.readFileSync(HISTORY_FILE, 'utf8');
      const list = JSON.parse(raw);
      if (Array.isArray(list)) return list;
    }
  } catch (err) {
    console.warn('[WineToken History] 读取历史记录失败:', err.message);
  }
  return [];
}

/**
 * 保存一条新的生成记录
 * @param {Object} item - { id, type, model, prompt, url, size, duration, createdAt, source }
 */
function addHistoryItem(item) {
  if (!item || !item.url) return;
  ensureStorageDir();

  try {
    const list = getHistoryList();
    // 头部追加
    list.unshift({
      id: item.id || `winetoken_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      type: item.type || 'image', // 'image' | 'video'
      model: item.model || 'unknown',
      prompt: item.prompt || '',
      url: item.url,
      size: item.size || '1024x1024',
      duration: item.duration || null,
      createdAt: item.createdAt || new Date().toISOString(),
      source: item.source || 'llm_skill' // 'llm_skill' | 'studio_ui'
    });

    // 保留最近 MAX_HISTORY_ITEMS 条
    const trimmed = list.slice(0, MAX_HISTORY_ITEMS);
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(trimmed, null, 2), 'utf8');
    return trimmed[0];
  } catch (err) {
    console.warn('[WineToken History] 写入历史记录失败:', err.message);
  }
}

module.exports = {
  HISTORY_FILE,
  getHistoryList,
  addHistoryItem
};
