// -*- coding: utf-8 -*-
const test = require('node:test');
const assert = require('node:assert/strict');
const sync = require('../src/sync.js');

test('Sync Security - 无 API Key 时安全返回而非误杀宿主进程 (ARCH-03)', async () => {
  const result = await sync.runSync({ forceNoKey: true });
  assert.equal(result.success, false);
  assert.equal(result.reason, 'MISSING_API_KEY');
});

test('Manifest 档位 - 服务器下发档位优先 (含 deepseek max 与 xhigh/ultra)', () => {
  const out = sync.buildManifestModels([
    { id: 'deepseek-v4.1-flash', reasoning: true, reasoningEfforts: { low: 'low', medium: 'medium', high: 'high', max: 'max' } },
    { id: 'gpt-5.6-terra', reasoning: true, reasoningEfforts: { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max', ultra: 'ultra' } },
  ]);
  assert.deepEqual(out[0].reasoningEfforts, { low: 'low', medium: 'medium', high: 'high', max: 'max' });
  assert.deepEqual(out[1].reasoningEfforts, { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max', ultra: 'ultra' });
});

test('Manifest 档位 - 服务器档位非法时清洗/兜底并透传 xhigh/ultra', () => {
  const out = sync.buildManifestModels([
    { id: 'gpt-5.6-terra', reasoning: true, reasoningEfforts: { low: 'low', xhigh: 'xhigh', ultra: 'ultra', bogus: 'bogus', max: 42 } },
    { id: 'hy4', reasoning: true },
    { id: 'sensenova-u1.5-lite', reasoning: false },
  ]);
  assert.deepEqual(out[0].reasoningEfforts, { low: 'low', xhigh: 'xhigh', ultra: 'ultra' });
  assert.deepEqual(out[1].reasoningEfforts, { low: 'low', medium: 'medium', high: 'high' });
  assert.equal(out[2].reasoningEfforts, undefined);
});

test('Manifest 档位 - 无服务器档位时 deepseek 兜底四档', () => {
  const out = sync.buildManifestModels([
    { id: 'deepseek-v4-pro', reasoning: true },
  ]);
  assert.deepEqual(out[0].reasoningEfforts, { low: 'low', medium: 'medium', high: 'high', max: 'max' });
});

test('Manifest 名称清洗 - buildManifestModels 剥离尾部括号且空结果保留原名', () => {
  const out = sync.buildManifestModels([
    { id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash (多模态推理)' },
    { id: 'grok-4.7', name: 'Grok 4.7（全模态）' },
    { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra (旗舰) （推理）' },
    { id: 'm-tight', name: 'MiMo V2.6 Flash(纯文本)(高速)' },
    { id: 'm-mid', name: 'Model (v1) Pro' },
    { id: 'm-only-ascii', name: '(Preview)' },
    { id: 'm-only-fullwidth', name: '（仅限免）' },
    { id: 'm-fallback' }
  ]);
  assert.equal(out[0].name, 'DeepSeek V4.1 Flash');
  assert.equal(out[1].name, 'Grok 4.7');
  assert.equal(out[2].name, 'GPT-5.6 Terra');
  assert.equal(out[3].name, 'MiMo V2.6 Flash');
  assert.equal(out[4].name, 'Model (v1) Pro');
  assert.equal(out[5].name, '(Preview)');
  assert.equal(out[6].name, '（仅限免）');
  assert.equal(out[7].name, 'm-fallback');
});
