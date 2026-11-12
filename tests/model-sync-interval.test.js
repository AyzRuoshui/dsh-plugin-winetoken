// -*- coding: utf-8 -*-
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveSyncIntervalMinutes } = require('../src/sync.js');

test('Sync Interval - 无配置时默认 1 分钟轮询', () => {
  assert.equal(resolveSyncIntervalMinutes(undefined), 1);
  assert.equal(resolveSyncIntervalMinutes({}), 1);
});

test('Sync Interval - syncIntervalMinutes 优先且最小钳制为 1 分钟', () => {
  assert.equal(resolveSyncIntervalMinutes({ syncIntervalMinutes: 10 }), 10);
  assert.equal(resolveSyncIntervalMinutes({ syncIntervalMinutes: 0.4 }), 1);
  assert.equal(resolveSyncIntervalMinutes({ syncIntervalMinutes: -3 }), 1);
  assert.equal(resolveSyncIntervalMinutes({ syncIntervalMinutes: 'abc' }), 1);
});

test('Sync Interval - 兼容旧 syncIntervalHours 配置换算为分钟', () => {
  assert.equal(resolveSyncIntervalMinutes({ syncIntervalHours: 1 }), 60);
  assert.equal(resolveSyncIntervalMinutes({ syncIntervalHours: 0.5 }), 30);
  assert.equal(resolveSyncIntervalMinutes({ syncIntervalHours: 0 }), 1);
});

test('Sync Interval - 新配置优先于旧配置', () => {
  assert.equal(resolveSyncIntervalMinutes({ syncIntervalMinutes: 3, syncIntervalHours: 2 }), 3);
});
