// -*- coding: utf-8 -*-
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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

test('PatchEngine - 基线模型读取完整性与 v2.5.5 线上对齐阵容契约', () => {
  const models = getBaselineModels();
  assert.ok(Array.isArray(models), '基线模型必须为数组');
  assert.equal(models.length, 20, '基线模型数量必须严格为 20 个');

  const expectedNames = {
    'claude-fable-5-2': 'Claude 5.2 Fable',
    'claude-opus-5-5': 'Claude 5.5 Opus',
    'deepseek-v4-pro': 'DeepSeek V4 Pro',
    'deepseek-v4.1-flash': 'DeepSeek V4.1 Flash',
    'glm-5.2': 'GLM-5.2',
    'glm-5.3': 'GLM-5.3',
    'glm-5.3-flash': 'GLM-5.3 Flash',
    'gpt-5.6-luna': 'GPT-5.6 Luna',
    'gpt-5.6-terra': 'GPT-5.6 Terra',
    'gpt-6-luna': 'GPT-6 Luna',
    'gpt-6.2-astra': 'GPT-6.2 Astra',
    'gpt-6.2-sol': 'GPT-6.2 Sol',
    'grok-4.7': 'Grok 4.7',
    'hy4': '腾讯混元 Hy4',
    'hy4-flash': '腾讯混元 Hy4 Flash',
    'kimi-k3.1-pro': 'Kimi K3.1 Pro',
    'mimo-v2.6-flash': 'MiMo V2.6 Flash',
    'mimo-v2.6-pro': 'MiMo V2.6 Pro',
    'minimax-m3.1-flash': 'MiniMax M3.1 Flash',
    'sensenova-6.8-flash': 'SenseNova 6.8 Flash'
  };

  const modelIds = new Set(models.map(m => m.id));
  assert.deepEqual(
    [...modelIds].sort(),
    Object.keys(expectedNames).sort(),
    '基线模型 ID 集合必须与 21 款预期阵容完全一致'
  );

  for (const m of models) {
    assert.equal(m.name, expectedNames[m.id], `模型 ${m.id} 显示名称必须与 Manifest 一致`);
  }

  // 1. 验证全部 4 个新增模型存在
  const newModels = ['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-6-luna', 'mimo-v2.6-flash'];
  for (const id of newModels) {
    assert.ok(modelIds.has(id), `必须包含新增模型: ${id}`);
  }

  // 2. 验证下架模型已被彻底移除
  const removedModels = [
    'kimi-k2.8-preview',
    'step-5-preview',
    'gemini-3.8-flash',
    '王者荣耀灵宝',
    'gpt-oss-120b-medium',
    'claude-opus-4-6-thinking',
    'claude-sonnet-4-6',
    'mimo-v2-omni',
    'deepseek-chat',
    'deepseek-reasoner',
    'deepseek-v4-flash'
  ];
  for (const id of removedModels) {
    assert.ok(!modelIds.has(id), `已下架模型严禁出现: ${id}`);
  }

  // 3. 验证新增 4 款模型规格与思考档位
  const gpt56Luna = models.find(m => m.id === 'gpt-5.6-luna');
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

  const gpt56Terra = models.find(m => m.id === 'gpt-5.6-terra');
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

  const gpt6Luna = models.find(m => m.id === 'gpt-6-luna');
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

  const mimoFlash = models.find(m => m.id === 'mimo-v2.6-flash');
  assert.equal(mimoFlash.contextWindow, 200000);
  assert.equal(mimoFlash.maxTokens, 32768);
  assert.deepEqual(mimoFlash.input, ['text']);
  assert.deepEqual(mimoFlash.reasoningEfforts, {
    low: 'low',
    medium: 'medium',
    high: 'high'
  });

  // 4. 验证 DeepSeek 系列保留 4 档思考与 393216 maxTokens
  for (const dsId of ['deepseek-v4-pro', 'deepseek-v4.1-flash']) {
    const ds = models.find(m => m.id === dsId);
    assert.equal(ds.maxTokens, 393216);
    assert.deepEqual(ds.reasoningEfforts, {
      low: 'low',
      medium: 'medium',
      high: 'high',
      max: 'max'
    });
  }
});

test('PatchEngine - 所有基线模型名称均不含 "(" 或 "（" 且硬编码兜底完全一致', () => {
  const fromPatch = getBaselineModels();
  assert.equal(fromPatch.length, 20);
  for (const m of fromPatch) {
    assert.ok(!m.name.includes('(') && !m.name.includes('（'), `基线模型 ${m.id} 名称不应包含括号: ${m.name}`);
  }

  const origExistsSync = fs.existsSync;
  const bundlePatchPath = path.resolve(__dirname, '..', 'cordis.patch.yml');
  let fallbackModels;
  try {
    fs.existsSync = (p) => (path.resolve(p) === bundlePatchPath ? false : origExistsSync(p));
    fallbackModels = getBaselineModels();
  } finally {
    fs.existsSync = origExistsSync;
  }

  assert.deepEqual(fallbackModels, fromPatch, '内存硬编码兜底必须与 cordis.patch.yml 完全一致');
});

test('PatchEngine - serializeProviderYaml 与 mergeProviderIntoPatchContent 自动剥离模型尾部括号', () => {
  const provider = {
    id: 'winetoken',
    displayName: 'WineToken (全平台推理模型)',
    baseURL: 'https://www.winetoken.asia/v1',
    apiKeyEnv: 'WINETOKEN_API_KEY',
    models: [
      { id: 'm-ascii', name: 'GPT-5.6 Luna (全模态推理)' },
      { id: 'm-fullwidth', name: 'Grok 4.7（全模态）' },
      { id: 'm-multi', name: 'Claude 5.5 Opus (旗舰) （长文本）' },
      { id: 'm-tight', name: 'GLM-5.3(推理)(限免)' },
      { id: 'm-mid', name: 'Model (v1) Pro' },
      { id: 'm-only-ascii', name: '(Preview)' },
      { id: 'm-only-fullwidth', name: '（仅限免）' }
    ]
  };

  const yamlBlock = serializeProviderYaml(provider);
  assert.ok(yamlBlock.includes('displayName: "WineToken (全平台推理模型)"'), 'provider displayName 应保持原样');
  assert.ok(yamlBlock.includes('name: "GPT-5.6 Luna"'));
  assert.ok(yamlBlock.includes('name: "Grok 4.7"'));
  assert.ok(yamlBlock.includes('name: "Claude 5.5 Opus"'));
  assert.ok(yamlBlock.includes('name: "GLM-5.3"'));
  assert.ok(yamlBlock.includes('name: "Model (v1) Pro"'));
  assert.ok(yamlBlock.includes('name: "(Preview)"'), '剥离后为空时必须保留原名');
  assert.ok(yamlBlock.includes('name: "（仅限免）"'), '剥离后为空时必须保留原全角括号名');

  const merged = mergeProviderIntoPatchContent('', provider);
  assert.ok(merged.includes('name: "GPT-5.6 Luna"'));
  assert.ok(!merged.includes('(全模态推理)'));
  assert.ok(!merged.includes('（全模态）'));
  assert.ok(merged.includes('name: "(Preview)"'));
  assert.equal(mergeProviderIntoPatchContent(merged, provider), merged, '清洗后合并必须保持幂等');
});

test('PatchEngine - 空流式列表 "[]" 与 "[ ]" (含行尾注释) 按空文档处理且幂等', () => {
  const provider = {
    id: 'winetoken',
    displayName: 'WineToken 聚合平台',
    baseURL: 'https://www.winetoken.asia/v1',
    apiKeyEnv: 'WINETOKEN_API_KEY',
    models: [{ id: 'm1', name: 'Model 1' }]
  };

  const expectedEmpty = mergeProviderIntoPatchContent('', provider);

  for (const input of ['[]', '[]\n', '[ ]\n', '  [  ]  # empty list\n']) {
    const merged = mergeProviderIntoPatchContent(input, provider);
    assert.equal(merged, expectedEmpty, `输入 ${JSON.stringify(input)} 应生成与空文件一致的干净根序列`);
    assert.ok(merged.startsWith('- id: llm-pi-ai\n'), '必须以顶层 - id: llm-pi-ai 开头');
    assert.ok(!merged.includes('[]'), '结果中绝不可残留 []');

    const second = mergeProviderIntoPatchContent(merged, provider);
    assert.equal(second, merged, `输入 ${JSON.stringify(input)} 二次合并必须完全幂等`);
  }
});

test('PatchEngine - 带前置注释的空列表 "# c1\\n# c2\\n# c3\\n[]\\n" 不损坏 YAML 且幂等', () => {
  const provider = {
    id: 'winetoken',
    displayName: 'WineToken 聚合平台',
    baseURL: 'https://www.winetoken.asia/v1',
    apiKeyEnv: 'WINETOKEN_API_KEY',
    models: [{ id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash' }]
  };

  const reproInput = '# c1\n# c2\n# c3\n[]\n';
  const expectedEmpty = mergeProviderIntoPatchContent('', provider);
  const merged = mergeProviderIntoPatchContent(reproInput, provider);

  assert.equal(merged, expectedEmpty, '带前置注释的 [] 应被视为空文档，生成干净根序列');
  assert.ok(merged.startsWith('- id: llm-pi-ai\n'), '首行必须为 - id: llm-pi-ai');
  assert.ok(!merged.includes('[]'), '合并输出中绝不可包含 []');

  const second = mergeProviderIntoPatchContent(merged, provider);
  assert.equal(second, merged, '带前置注释的 [] 二次合并必须完全幂等');
});

test('PatchEngine - 空文件/纯空白/纯注释文件均生成标准根序列且幂等', () => {
  const provider = {
    id: 'winetoken',
    displayName: 'WineToken 聚合平台',
    baseURL: 'https://www.winetoken.asia/v1',
    apiKeyEnv: 'WINETOKEN_API_KEY',
    models: [{ id: 'm1', name: 'Model 1' }]
  };

  const expectedEmpty = mergeProviderIntoPatchContent('', provider);

  for (const input of ['', '   \n\t\n', '# only comment 1\n# only comment 2\n']) {
    const merged = mergeProviderIntoPatchContent(input, provider);
    assert.equal(merged, expectedEmpty);
    assert.ok(merged.startsWith('- id: llm-pi-ai\n'));
    assert.equal(mergeProviderIntoPatchContent(merged, provider), merged, '二次合并必须完全幂等');
  }
});

test('PatchEngine - 正常块级列表保留已有其他 provider 与注释', () => {
  const existing = [
    '# 顶部用户注释',
    '- id: llm-pi-ai',
    '  name: "@deepseek-ai/dsh-llm-pi-ai"',
    '  config:',
    '    providers:',
    '      custom_gw:',
    '        displayName: Custom GW',
    '        api: openai-completions',
    '        baseURL: https://example.com/v1',
    '        apiKeyEnv: CUSTOM_API_KEY',
    '        models:',
    '          - id: custom-model',
    '            name: "Custom Model"',
    ''
  ].join('\n');

  const provider = {
    id: 'winetoken',
    displayName: 'WineToken 聚合平台',
    baseURL: 'https://www.winetoken.asia/v1',
    apiKeyEnv: 'WINETOKEN_API_KEY',
    models: [{ id: 'm1', name: 'Model 1' }]
  };

  const merged = mergeProviderIntoPatchContent(existing, provider);
  assert.ok(merged.includes('# 顶部用户注释'));
  assert.ok(merged.includes('custom_gw:'));
  assert.ok(merged.includes('apiKeyEnv: CUSTOM_API_KEY'));
  assert.ok(merged.includes('winetoken:'));
  assert.ok(merged.includes('- id: m1'));
  assert.equal(mergeProviderIntoPatchContent(merged, provider), merged);
});

test('PatchEngine - 无 llm-pi-ai 的块级列表安全追加到文末且二次合并幂等', () => {
  const blockWithoutLlm = [
    '# 用户头部注释',
    '- id: agent-default-model',
    '  name: "@deepseek-ai/dsh-agent-default-model"',
    '  config:',
    '    provider: zhaizhu',
    '    model: gpt-6-astra',
    ''
  ].join('\n');

  const provider = {
    id: 'winetoken',
    displayName: 'WineToken 聚合平台',
    baseURL: 'https://www.winetoken.asia/v1',
    apiKeyEnv: 'WINETOKEN_API_KEY',
    models: [{ id: 'm1', name: 'Model 1' }]
  };

  const merged = mergeProviderIntoPatchContent(blockWithoutLlm, provider);
  assert.ok(merged.startsWith('# 用户头部注释\n- id: agent-default-model\n'), '必须保留原有前置内容');
  assert.ok(merged.includes('\n- id: llm-pi-ai\n'), '必须追加顶层 - id: llm-pi-ai');
  assert.ok(merged.includes('winetoken:'), '必须包含 winetoken provider');
  assert.equal(mergeProviderIntoPatchContent(merged, provider), merged, '追加后二次合并必须完全幂等');
});

test('PatchEngine - 映射根节点、非空流式列表与其他不支持格式严格原样返回并告警', () => {
  const provider = {
    id: 'winetoken',
    displayName: 'WineToken 聚合平台',
    baseURL: 'https://www.winetoken.asia/v1',
    apiKeyEnv: 'WINETOKEN_API_KEY',
    models: [{ id: 'm1', name: 'Model 1' }]
  };

  const unsupportedCases = [
    ['mapping-root', 'foo: bar\nbaz:\n  qux: 1\n'],
    ['mapping-with-nested-llm', 'patches:\n  - id: llm-pi-ai\n    config: {}\n'],
    ['non-empty-flow-list', '[a, b]'],
    ['flow-mapping', '{ a: 1 }'],
    ['scalar', 'just-a-scalar\n'],
    ['indented-sequence', '  - id: other\n    name: other\n'],
    ['multi-document', '---\n- id: other\n']
  ];

  const origWarn = console.warn;
  try {
    for (const [label, input] of unsupportedCases) {
      const warnings = [];
      console.warn = (...args) => warnings.push(args.join(' '));
      const result = mergeProviderIntoPatchContent(input, provider);
      assert.strictEqual(result, input, `${label}: 必须原样返回输入字符串`);
      assert.equal(warnings.length, 1, `${label}: 必须输出一条 console.warn 告警`);
      assert.match(warnings[0], /unsupported|left untouched/i, `${label}: 告警内容必须明确说明格式不支持且未修改`);
    }
  } finally {
    console.warn = origWarn;
  }
});
