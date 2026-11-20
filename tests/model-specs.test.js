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

test('ModelParser - 19 款在架对话推理模型必须全部通过解析并具备正确元数据', () => {
  const activeChatIds = [
    'grok-4.7',
    'minimax-m3.1-flash',
    'kimi-k2.8-preview',
    'claude-opus-5-5',
    'claude-fable-5-2',
    'glm-5.2',
    'sensenova-6.8-flash',
    'glm-5.3',
    'deepseek-v4.1-flash',
    'gpt-6.2-astra',
    'kimi-k3.1-pro',
    'mimo-v2.6-pro',
    'deepseek-v4-pro',
    'glm-5.3-flash',
    'step-5-preview',
    'gpt-6.2-sol',
    'gemini-3.8-flash',
    'hy4',
    'hy4-flash'
  ];

  const parsed = parseModelList(activeChatIds, true);
  assert.equal(parsed.length, 19, '19 款对话模型必须全部通过解析且未被非对话正则误杀');

  // 1. 验证 gemini-3.8-flash 规格
  const gemini = parsed.find(m => m.id === 'gemini-3.8-flash');
  assert.ok(gemini, '必须解析出 gemini-3.8-flash');
  assert.equal(gemini.contextWindow, 1048576);
  assert.equal(gemini.maxTokens, 65536);
  assert.deepEqual(gemini.input, ['text', 'image']);
  assert.equal(gemini.reasoningEfforts.low, 'low');
  assert.equal(gemini.reasoningEfforts.medium, 'medium');
  assert.equal(gemini.reasoningEfforts.high, 'high');
  // parseModelList 会注入通用档位，但确保基础三档存在
  assert.ok(gemini.reasoningEfforts.high);

  // 2. 验证 claude-fable-5-2 规格
  const fable = parsed.find(m => m.id === 'claude-fable-5-2');
  assert.ok(fable, '必须解析出 claude-fable-5-2');
  assert.equal(fable.contextWindow, 1048576);
  assert.equal(fable.maxTokens, 131072);
  assert.deepEqual(fable.input, ['text', 'image']);

  // 3. 验证 hy4 与 hy4-flash 规格
  const hy4 = parsed.find(m => m.id === 'hy4');
  assert.ok(hy4, '必须解析出 hy4');
  assert.equal(hy4.contextWindow, 1048576);
  assert.deepEqual(hy4.input, ['text', 'image']);

  const hy4Flash = parsed.find(m => m.id === 'hy4-flash');
  assert.ok(hy4Flash, '必须解析出 hy4-flash');
  assert.equal(hy4Flash.contextWindow, 1048576);
  assert.deepEqual(hy4Flash.input, ['text', 'image']);

});
