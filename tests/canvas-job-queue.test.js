// -*- coding: utf-8 -*-
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { CanvasJobQueue } = require('../src/canvas-job-queue.js');

test('CanvasJobQueue - WAL 任务状态生命周期与持久化', () => {
  const testDir = path.join(__dirname, '..', '.tmp', 'test_queue_' + Date.now());
  const queue = new CanvasJobQueue(testDir);

  // 1. 创建任务并校验写入
  const job = queue.createJob({
    panelId: 'shot_99',
    prompt: '测试生图提示词',
    model: 'sensenova-u1.5-lite'
  });
  assert.equal(job.status, 'pending');
  assert.equal(job.panelId, 'shot_99');
  assert.equal(queue.getPendingJobs().length, 1);

  // 2. 完成任务
  const completed = queue.completeJob(job.id, 'https://example.com/result.png');
  assert.equal(completed.status, 'completed');
  assert.equal(completed.resultUrl, 'https://example.com/result.png');
  assert.equal(queue.getPendingJobs().length, 0);

  // 清理临时测试目录
  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch (_) {}
});
