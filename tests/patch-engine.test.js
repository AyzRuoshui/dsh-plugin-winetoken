// -*- coding: utf-8 -*-
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  mergeProviderIntoPatchContent,
  getBaselineModels,
  serializeProviderYaml
} = require('../src/patch-engine.js');

test('PatchEngine - 增量合并保留用户已有 provider (如 zhaizhu) 与注释 (P0 核心回归)', () => {
  const existingUserPatch = [
    '# 用户个性化注释 A',
    '- id: agent-default-model',
    '  name: "@deepseek-ai/dsh-agent-default-model"',
    '  config:',
    '    provider: zhaizhu',
    '    model: gpt-6-astra',
    '# 用户个性化注释 B (绝不可丢失)',
    '- id: llm-pi-ai',
    '  name: "@deepseek-ai/dsh-llm-pi-ai"',
    '  config:',
    '    providers:',
    '      zhaizhu:',
    '        displayName: 寨主自配网关',
    '        api: openai-completions',
    '        baseURL: https://www.winetoken.asia/v1',
    '        apiKeyEnv: ZHAIZHU_API_KEY',
    '        models:',
    '          - id: gpt-6-astra',
    '            name: "GPT-6 Astra"'
  ].join('\n');

  const targetProvider = {
    id: 'winetoken',
    displayName: 'WineToken 聚合平台',
    baseURL: 'https://www.winetoken.asia/v1',
    apiKeyEnv: 'WINETOKEN_API_KEY',
    models: [
      { id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', contextWindow: 1048576, maxTokens: 393216 }
    ]
  };

  const merged = mergeProviderIntoPatchContent(existingUserPatch, targetProvider);

  // 断言 1: 用户原有注释完整保留
  assert.ok(merged.includes('# 用户个性化注释 A'), '必须保留注释 A');
  assert.ok(merged.includes('# 用户个性化注释 B (绝不可丢失)'), '必须保留注释 B');

  // 断言 2: 用户原有 zhaizhu provider 完好无损
  assert.ok(merged.includes('zhaizhu:'), '必须保留 zhaizhu provider');
  assert.ok(merged.includes('apiKeyEnv: ZHAIZHU_API_KEY'), '必须保留 zhaizhu 的 apiKeyEnv');
  assert.ok(merged.includes('displayName: 寨主自配网关'), '必须保留 zhaizhu 的 displayName');

  // 断言 3: 新增的 winetoken provider 成功注入
  assert.ok(merged.includes('winetoken:'), '必须包含注入的 winetoken provider');
  assert.ok(merged.includes('apiKeyEnv: WINETOKEN_API_KEY'), '必须包含 winetoken 的 apiKeyEnv');
  assert.ok(merged.includes('id: deepseek-v4.1-flash'), '必须包含 winetoken 模型');
});

test('PatchEngine - 绝对幂等性测试 (内容一致时不产生字符变动)', () => {
  const provider = {
    id: 'winetoken',
    displayName: 'WineToken 聚合平台',
    baseURL: 'https://www.winetoken.asia/v1',
    apiKeyEnv: 'WINETOKEN_API_KEY',
    models: [{ id: 'm1', name: 'Model 1' }]
  };

  const initial = mergeProviderIntoPatchContent('', provider);
  const second = mergeProviderIntoPatchContent(initial, provider);

  assert.equal(second, initial, '重复合并相同配置时必须完全幂等，不改变任何文本');
});

test('PatchEngine - 基线模型读取完整性', () => {
  const models = getBaselineModels();
  assert.ok(Array.isArray(models), '基线模型必须为数组');
  assert.ok(models.length >= 10, '基线模型数量必须大于等于 10');
  const foundDeepseek = models.some(m => m.id.includes('deepseek'));
  assert.ok(foundDeepseek, '必须包含 DeepSeek 经典模型');
});
