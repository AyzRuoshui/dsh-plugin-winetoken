// -*- coding: utf-8 -*-
const test = require('node:test');
const assert = require('node:assert/strict');
const sync = require('../src/sync.js');

test('Sync Security - 无 API Key 时安全返回而非误杀宿主进程 (ARCH-03)', async () => {
  const result = await sync.runSync({ forceNoKey: true });
  assert.equal(result.success, false);
  assert.equal(result.reason, 'MISSING_API_KEY');
});

test('Manifest 档位 - 服务器下发档位优先 (含 deepseek max)', () => {
  const out = sync.buildManifestModels([
    { id: 'deepseek-v4.1-flash', reasoning: true, reasoningEfforts: { low: 'low', medium: 'medium', high: 'high', max: 'max' } },
    { id: 'gemini-3.8-flash', reasoning: true, reasoningEfforts: { low: 'low', high: 'high' } },
  ]);
  assert.deepEqual(out[0].reasoningEfforts, { low: 'low', medium: 'medium', high: 'high', max: 'max' });
  assert.deepEqual(out[1].reasoningEfforts, { low: 'low', high: 'high' });
});

test('Manifest 档位 - 服务器档位非法时清洗/兜底', () => {
  const out = sync.buildManifestModels([
    { id: 'deepseek-v4-pro', reasoning: true, reasoningEfforts: { low: 'low', ultra: 'ultra', max: 42 } },
    { id: 'hy4', reasoning: true },
    { id: 'sensenova-u1.5-lite', reasoning: false },
  ]);
  assert.deepEqual(out[0].reasoningEfforts, { low: 'low' });
  assert.deepEqual(out[1].reasoningEfforts, { low: 'low', medium: 'medium', high: 'high' });
  assert.equal(out[2].reasoningEfforts, undefined);
});

test('Manifest 档位 - 无服务器档位时 deepseek 兜底四档', () => {
  const out = sync.buildManifestModels([
    { id: 'deepseek-v4-pro', reasoning: true },
  ]);
  assert.deepEqual(out[0].reasoningEfforts, { low: 'low', medium: 'medium', high: 'high', max: 'max' });
});
