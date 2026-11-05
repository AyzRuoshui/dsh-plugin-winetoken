// -*- coding: utf-8 -*-
/**
 * WineToken 漫剧画布基于命令模式的撤销/重做堆栈 (HistoryManager)
 * 限制最大 30 步历史容量，支持 Ctrl+Z / Ctrl+Y
 */

class CanvasHistoryManager {
  constructor(maxSize = 30) {
    this.maxSize = maxSize;
    this.undoStack = [];
    this.redoStack = [];
  }

  /**
   * 记录一次新的快照状态
   */
  pushState(state) {
    if (!state) return;
    // 深拷贝以隔离状态变异
    const snapshot = JSON.parse(JSON.stringify(state));
    this.undoStack.push(snapshot);
    if (this.undoStack.length > this.maxSize) {
      this.undoStack.shift();
    }
    // 产生新动作时清空重做栈
    this.redoStack = [];
  }

  /**
   * 撤销 (Undo)
   */
  undo(currentState) {
    if (this.undoStack.length === 0) return null;
    const previous = this.undoStack.pop();
    if (currentState) {
      this.redoStack.push(JSON.parse(JSON.stringify(currentState)));
    }
    return previous;
  }

  /**
   * 重做 (Redo)
   */
  redo(currentState) {
    if (this.redoStack.length === 0) return null;
    const next = this.redoStack.pop();
    if (currentState) {
      this.undoStack.push(JSON.parse(JSON.stringify(currentState)));
    }
    return next;
  }

  canUndo() {
    return this.undoStack.length > 0;
  }

  canRedo() {
    return this.redoStack.length > 0;
  }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
  }
}

module.exports = { CanvasHistoryManager };
