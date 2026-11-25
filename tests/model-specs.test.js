// -*- coding: utf-8 -*-
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseModelList, isNonChatModel } = require('../src/parser.js');

test('ModelParser - 8 款生图与视频模型必须被 isNonChatModel 准确识别并过滤', () => {
  const nonChatIds = [
    'gpt-image-2.6-flare',
    'gpt-image-2.6-sunburst',
    'grok-imagine-image-2.0',
    'gemini-imagen-3',
    'sensenova-u1.5-lite',
    'MiniMax-H3',
    'MiniMax-H3-2K',
    'grok-imagine-video-1.5'
  ];

  for (const id of nonChatIds) {
    assert.equal(isNonChatModel(id), true, `模型 ${id} 必须被判定为非对话模型`);
  }

  const parsed = parseModelList(nonChatIds, true);
  assert.equal(parsed.length, 0, '过滤非对话模型后解析结果必须为空');
});

test('ModelParser - 21 款在架对话推理模型必须全部通过解析并具备正确元数据', () => {
  const activeChatIds = [
    'claude-fable-5-2',
    'claude-opus-5-5',
    'deepseek-v4-pro',
    'deepseek-v4.1-flash',
    'glm-5.2',
    'glm-5.3',
    'glm-5.3-flash',
    'gpt-5.6-luna',
    'gpt-5.6-terra',
    'gpt-6-luna',
    'gpt-6.2-astra',
    'gpt-6.2-sol',
    'grok-4.7',
    'hy4',
    'hy4-flash',
    'kimi-k3.1-pro',
    'mimo-v2.6-flash',
    'mimo-v2.6-pro',
    'minimax-m3.1-flash',
    'sensenova-6.8-flash'
  ];

  const parsed = parseModelList(activeChatIds, true);
  assert.equal(parsed.length, 20, '20 款对话模型必须全部通过解析且未被非对话正则误杀');

  for (const m of parsed) {
    assert.ok(!m.name.includes('(') && !m.name.includes('（'), `解析后的模型 ${m.id} 名称不应含括号: ${m.name}`);
  }

  // 1. 验证新增模型规格: gpt-5.6-luna / gpt-5.6-terra / gpt-6-luna / mimo-v2.6-flash
  const gpt56Luna = parsed.find(m => m.id === 'gpt-5.6-luna');
  assert.ok(gpt56Luna, '必须解析出 gpt-5.6-luna');
  assert.equal(gpt56Luna.name, 'GPT-5.6 Luna');
  assert.equal(gpt56Luna.contextWindow, 272000);
  assert.equal(gpt56Luna.maxTokens, 131072);
  assert.deepEqual(gpt56Luna.input, ['text', 'image']);
  assert.deepEqual(gpt56Luna.reasoningEfforts, {
    low: 'low',
    medium: 'medium',
    high: 'high',
    xhigh: 'xhigh',
    max: 'max'
  });

  const gpt56Terra = parsed.find(m => m.id === 'gpt-5.6-terra');
  assert.ok(gpt56Terra, '必须解析出 gpt-5.6-terra');
  assert.equal(gpt56Terra.name, 'GPT-5.6 Terra');
  assert.equal(gpt56Terra.contextWindow, 272000);
  assert.equal(gpt56Terra.maxTokens, 131072);
  assert.deepEqual(gpt56Terra.input, ['text', 'image']);
  assert.deepEqual(gpt56Terra.reasoningEfforts, {
    low: 'low',
    medium: 'medium',
    high: 'high',
    xhigh: 'xhigh',
    max: 'max',
    ultra: 'ultra'
  });

  const gpt6Luna = parsed.find(m => m.id === 'gpt-6-luna');
  assert.ok(gpt6Luna, '必须解析出 gpt-6-luna');
  assert.equal(gpt6Luna.name, 'GPT-6 Luna');
  assert.equal(gpt6Luna.contextWindow, 272000);
  assert.equal(gpt6Luna.maxTokens, 131072);
  assert.deepEqual(gpt6Luna.input, ['text', 'image']);
  assert.deepEqual(gpt6Luna.reasoningEfforts, {
    low: 'low',
    medium: 'medium',
    high: 'high',
    xhigh: 'xhigh',
    max: 'max'
  });

  const mimoFlash = parsed.find(m => m.id === 'mimo-v2.6-flash');
  assert.ok(mimoFlash, '必须解析出 mimo-v2.6-flash');
  assert.equal(mimoFlash.name, 'MiMo V2.6 Flash');
  assert.equal(mimoFlash.contextWindow, 200000);
  assert.equal(mimoFlash.maxTokens, 32768);
  assert.deepEqual(mimoFlash.input, ['text']);
  assert.deepEqual(mimoFlash.reasoningEfforts, {
    low: 'low',
    medium: 'medium',
    high: 'high'
  });

  // 2. 验证 claude-fable-5-2 规格
  const fable = parsed.find(m => m.id === 'claude-fable-5-2');
  assert.ok(fable, '必须解析出 claude-fable-5-2');
  assert.equal(fable.name, 'Claude 5.2 Fable');
  assert.equal(fable.contextWindow, 1048576);
  assert.equal(fable.maxTokens, 131072);
  assert.deepEqual(fable.input, ['text', 'image']);

  // 3. 验证 hy4 与 hy4-flash 规格
  const hy4 = parsed.find(m => m.id === 'hy4');
  assert.ok(hy4, '必须解析出 hy4');
  assert.equal(hy4.name, '腾讯混元 Hy4');
  assert.equal(hy4.contextWindow, 1048576);
  assert.deepEqual(hy4.input, ['text', 'image']);

  const hy4Flash = parsed.find(m => m.id === 'hy4-flash');
  assert.ok(hy4Flash, '必须解析出 hy4-flash');
  assert.equal(hy4Flash.name, '腾讯混元 Hy4 Flash');
  assert.equal(hy4Flash.contextWindow, 1048576);
  assert.deepEqual(hy4Flash.input, ['text', 'image']);
});
