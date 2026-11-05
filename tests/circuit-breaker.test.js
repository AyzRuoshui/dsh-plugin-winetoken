// -*- coding: utf-8 -*-
const test = require('node:test');
const assert = require('node:assert/strict');
const { SessionCircuitBreaker } = require('../src/tool.js');

test('SessionCircuitBreaker - 连续 2 次失败触发熔断与成功重置', () => {
  const cb = new SessionCircuitBreaker();
  const sessionId = 'test_session_1';

  // 初始未熔断
  assert.equal(cb.isTripped(sessionId), false);

  // 第 1 次失败
  cb.recordFailure(sessionId);
  assert.equal(cb.isTripped(sessionId), false);

  // 第 2 次失败 -> 触发熔断
  cb.recordFailure(sessionId);
  assert.equal(cb.isTripped(sessionId), true);

  // 成功调用 -> 清零并恢复正常
  cb.recordSuccess(sessionId);
  assert.equal(cb.isTripped(sessionId), false);
});
