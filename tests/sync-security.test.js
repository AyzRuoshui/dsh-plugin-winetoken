// -*- coding: utf-8 -*-
const test = require('node:test');
const assert = require('node:assert/strict');
const sync = require('../src/sync.js');

test('Sync Security - 无 API Key 时安全返回而非误杀宿主进程 (ARCH-03)', async () => {
  const result = await sync.runSync({ forceNoKey: true });
  assert.equal(result.success, false);
  assert.equal(result.reason, 'MISSING_API_KEY');
});
