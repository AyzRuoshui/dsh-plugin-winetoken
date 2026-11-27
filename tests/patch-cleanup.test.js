// -*- coding: utf-8 -*-
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  LEGACY_HEADER_COMMENT,
  MANAGED_START_PREFIX,
  MANAGED_END_LINE,
  cleanWineTokenFromPatchContent,
  mergeProviderIntoPatchContent,
  getBaselineModels,
  serializeProviderYaml,
  inspectPatchState
} = require('../src/patch-engine.js');
const {
  cleanupCordisPatchFile,
  ensureBaselineProviderInPatch
} = require('../src/sync.js');
const { runUninstall } = require('../scripts/safe_uninstall.cjs');

function buildCleanBaseline() {
  return [
    '# 用户全局补丁配置注释（不可丢失）',
    '- id: ui-theme',
    '  name: "@deepseek-ai/dsh-ui-theme"',
    '  config:',
    '    theme: dark',
    '    fontSize: 14',
    '    accentColor: "#3b82f6"',
    '    compactMode: false',
    '    showLineNumbers: true',
    '',
    '- id: agent-default-model',
    '  name: "@deepseek-ai/dsh-agent-default-model"',
    '  config:',
    '    provider: zhaizhu',
    '    model: gpt-6-astra',
    '    temperature: 0.7',
    '',
    '- id: custom-shortcuts',
    '  name: "@deepseek-ai/dsh-shortcuts"',
    '  config:',
    '    sendOnEnter: true',
    '    toggleSidebar: "Ctrl+B"',
    '    sidebarWidth: 280',
    '',
    '- id: workspace-defaults',
    '  name: "@deepseek-ai/dsh-workspace"',
    '  config:',
    '    autoSave: true',
    '    tabSize: 2',
    '    wordWrap: on',
    ''
  ].join('\n');
}

function buildLargeWineTokenModelsBlock(count = 16) {
  const lines = [];
  for (let i = 1; i <= count; i++) {
    lines.push(`          - id: test-model-${i}`);
    lines.push(`            name: "Test Model ${i}"`);
    lines.push('            contextWindow: 1048576');
    lines.push('            maxTokens: 131072');
    lines.push('            input:');
    lines.push('              - text');
    lines.push('              - image');
  }
  return lines.join('\n');
}

function buildDirtyFixture(cleanBaseline) {
  // 边界陷阱：在 ui-theme 末尾紧贴悬挂插件注释行
  const withTrapComment = cleanBaseline.replace(
    '    showLineNumbers: true\n',
    `    showLineNumbers: true\n${LEGACY_HEADER_COMMENT}\n`
  );

  const manyModels = buildLargeWineTokenModelsBlock(16);

  const stackedDirtyTail = [
    '',
    LEGACY_HEADER_COMMENT,
    '- id: llm-pi-ai',
    '  name: "@deepseek-ai/dsh-llm-pi-ai"',
    '  config:',
    '    providers:',
    '      winetoken:',
    '        displayName: "WineToken (全平台推理模型)"',
    '        api: openai-completions',
    '        baseURL: https://www.winetoken.asia/v1',
    '        apiKeyEnv: WINETOKEN_API_KEY',
    '        models:',
    manyModels,
    '',
    '- id: llm-pi-ai',
    '  name: "@deepseek-ai/dsh-llm-pi-ai"',
    '  config:',
    '    providers:',
    '      winetoken:',
    '        displayName: "WineToken Duplicate"',
    '        api: openai-completions',
    '        baseURL: https://www.winetoken.asia/v1',
    '        apiKeyEnv: WINETOKEN_API_KEY',
    '        models:',
    manyModels,
    '',
    '- insert:',
    '    - id: winetoken-plugin',
    '      name: "@winetoken/dsh-plugin-winetoken"',
    '',
    `${MANAGED_START_PREFIX} (mode=full-entry) >>>`,
    '- id: llm-pi-ai',
    '  name: "@deepseek-ai/dsh-llm-pi-ai"',
    '  config:',
    '    providers:',
    '      winetoken:',
    '        displayName: "WineToken Managed"',
    '        api: openai-completions',
    '        baseURL: https://www.winetoken.asia/v1',
    '        apiKeyEnv: WINETOKEN_API_KEY',
    '        models:',
    '          - id: deepseek-v4.1-flash',
    '            name: "DeepSeek V4.1 Flash"',
    MANAGED_END_LINE,
    ''
  ].join('\n');

  return withTrapComment + stackedDirtyTail;
}

test('PatchCleanup - 脏 fixture 清理后与干净基线逐行严格相等且二次执行幂等 (already_clean)', () => {
  const cleanBaseline = buildCleanBaseline();
  const dirtyFixture = buildDirtyFixture(cleanBaseline);

  assert.ok(dirtyFixture.split('\n').length > 250, '脏 fixture 应模拟 250+ 行叠层注入场景');

  const first = cleanWineTokenFromPatchContent(dirtyFixture);
  assert.strictEqual(first.changed, true);
  assert.strictEqual(first.status, 'cleaned');
  assert.strictEqual(first.content, cleanBaseline, '清理后必须与干净基线逐行严格相等');

  const second = cleanWineTokenFromPatchContent(first.content);
  assert.strictEqual(second.changed, false);
  assert.strictEqual(second.status, 'already_clean');
  assert.strictEqual(second.content, cleanBaseline, '二次执行必须保持原样与幂等');
});

test('PatchCleanup - cleanupCordisPatchFile 磁盘态 dry-run、一次性备份与二次不写盘幂等', () => {
  const cleanBaseline = buildCleanBaseline();
  const dirtyFixture = buildDirtyFixture(cleanBaseline);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'winetoken-cleanup-'));
  const patchFile = path.join(tmpDir, 'cordis.patch.yml');

  try {
    fs.writeFileSync(patchFile, dirtyFixture, 'utf-8');

    // dry-run 不改写文件也不生成备份
    const dryRes = cleanupCordisPatchFile({ patchFile, dryRun: true });
    assert.strictEqual(dryRes.exists, true);
    assert.strictEqual(dryRes.changed, true);
    assert.strictEqual(dryRes.status, 'cleaned');
    assert.strictEqual(dryRes.content, cleanBaseline);
    assert.strictEqual(fs.readFileSync(patchFile, 'utf-8'), dirtyFixture);
    assert.strictEqual(fs.existsSync(`${patchFile}.bak`), false);

    // 正式清理：写回干净基线并创建单份 .bak
    const firstRes = cleanupCordisPatchFile({ patchFile });
    assert.strictEqual(firstRes.changed, true);
    assert.strictEqual(firstRes.status, 'cleaned');
    assert.strictEqual(fs.readFileSync(patchFile, 'utf-8'), cleanBaseline);
    assert.strictEqual(fs.existsSync(`${patchFile}.bak`), true);

    const mtimeAfterFirst = fs.statSync(patchFile).mtimeMs;
    const filesAfterFirst = fs.readdirSync(tmpDir).sort();

    // 第二次执行：already_clean，不写盘、不改 mtime、不产生多余 .bak
    const secondRes = cleanupCordisPatchFile({ patchFile });
    assert.strictEqual(secondRes.changed, false);
    assert.strictEqual(secondRes.status, 'already_clean');
    assert.strictEqual(secondRes.backupFile, null);
    assert.strictEqual(fs.statSync(patchFile).mtimeMs, mtimeAfterFirst);
    assert.deepStrictEqual(fs.readdirSync(tmpDir).sort(), filesAfterFirst);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('PatchCleanup - 共存多 Provider 场景保留 zhaizhu 与两者间用户注释', () => {
  const zhaizhuFirst = [
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
    '            name: "GPT-6 Astra"',
    '      # 用户在 zhaizhu 与 winetoken 之间的分隔注释',
    '      winetoken:',
    '        displayName: WineToken',
    '        api: openai-completions',
    '        baseURL: https://www.winetoken.asia/v1',
    '        apiKeyEnv: WINETOKEN_API_KEY',
    '        models:',
    '          - id: deepseek-v4.1-flash',
    '            name: "DeepSeek V4.1 Flash"',
    ''
  ].join('\n');

  const res1 = cleanWineTokenFromPatchContent(zhaizhuFirst);
  assert.strictEqual(res1.changed, true);
  assert.ok(res1.content.includes('- id: llm-pi-ai'));
  assert.ok(res1.content.includes('zhaizhu:'));
  assert.ok(res1.content.includes('# 用户在 zhaizhu 与 winetoken 之间的分隔注释'));
  assert.ok(!res1.content.includes('winetoken:'));
  assert.strictEqual(cleanWineTokenFromPatchContent(res1.content).status, 'already_clean');

  const winetokenFirst = [
    '- id: llm-pi-ai',
    '  name: "@deepseek-ai/dsh-llm-pi-ai"',
    '  config:',
    '    providers:',
    '      winetoken:',
    '        displayName: WineToken',
    '        api: openai-completions',
    '        baseURL: https://www.winetoken.asia/v1',
    '        apiKeyEnv: WINETOKEN_API_KEY',
    '        models:',
    '          - id: gpt-5.6-luna',
    '            name: "GPT-5.6 Luna"',
    '      # 寨主保留分隔注释',
    '      zhaizhu:',
    '        displayName: 寨主自配网关',
    '        apiKeyEnv: ZHAIZHU_API_KEY',
    ''
  ].join('\n');

  const res2 = cleanWineTokenFromPatchContent(winetokenFirst);
  assert.strictEqual(res2.changed, true);
  assert.ok(res2.content.includes('zhaizhu:'));
  assert.ok(res2.content.includes('# 寨主保留分隔注释'));
  assert.ok(!res2.content.includes('winetoken:'));
  assert.strictEqual(cleanWineTokenFromPatchContent(res2.content).status, 'already_clean');
});

test('PatchCleanup - 普通条目内部含用户注释写着 winetoken 绝不误删', () => {
  const input = [
    '- id: ui-theme',
    '  name: "@deepseek-ai/dsh-ui-theme"',
    '  config:',
    '    # refer to winetoken theme color',
    '    theme: dark',
    ''
  ].join('\n');

  const res = cleanWineTokenFromPatchContent(input);
  assert.strictEqual(res.changed, false);
  assert.strictEqual(res.status, 'already_clean');
  assert.strictEqual(res.content, input);
});

test('PatchCleanup - 标记区间被用户污染时降级保护，仅剥离标记与 winetoken 并保留无关条目/provider', () => {
  const pollutedProviderBlock = [
    '- id: llm-pi-ai',
    '  name: "@deepseek-ai/dsh-llm-pi-ai"',
    '  config:',
    '    providers:',
    `      ${MANAGED_START_PREFIX} (mode=provider) >>>`,
    '      winetoken:',
    '        displayName: WineToken',
    '        apiKeyEnv: WINETOKEN_API_KEY',
    '        models:',
    '          - id: glm-5.4',
    '            name: "GLM-5.4"',
    '      openai:',
    '        displayName: OpenAI Custom',
    '        apiKeyEnv: OPENAI_API_KEY',
    `      ${MANAGED_END_LINE}`,
    ''
  ].join('\n');

  const res1 = cleanWineTokenFromPatchContent(pollutedProviderBlock);
  assert.strictEqual(res1.changed, true);
  assert.ok(!res1.content.includes('winetoken:'));
  assert.ok(!res1.content.includes('winetoken-managed:'));
  assert.ok(res1.content.includes('openai:'));
  assert.ok(res1.content.includes('OPENAI_API_KEY'));

  const pollutedFullEntry = [
    `${MANAGED_START_PREFIX} (mode=full-entry) >>>`,
    '- id: llm-pi-ai',
    '  name: "@deepseek-ai/dsh-llm-pi-ai"',
    '  config:',
    '    providers:',
    '      winetoken:',
    '        displayName: WineToken',
    '        apiKeyEnv: WINETOKEN_API_KEY',
    '        models:',
    '          - id: glm-5.4',
    '            name: "GLM-5.4"',
    '- id: ui-theme',
    '  config:',
    '    theme: light',
    MANAGED_END_LINE,
    ''
  ].join('\n');

  const res2 = cleanWineTokenFromPatchContent(pollutedFullEntry);
  assert.strictEqual(res2.changed, true);
  assert.ok(!res2.content.includes('winetoken:'));
  assert.ok(!res2.content.includes('winetoken-managed:'));
  assert.ok(res2.content.includes('- id: ui-theme'));
  assert.ok(res2.content.includes('theme: light'));
});

test('PatchCleanup - insert 列表部分剥离 vs 整条剥离', () => {
  const mixedInsert = [
    '- insert:',
    '    - id: other-plugin',
    '      name: "@someone/other-plugin"',
    '    - id: winetoken-plugin',
    '      name: "@winetoken/dsh-plugin-winetoken"',
    ''
  ].join('\n');

  const resMixed = cleanWineTokenFromPatchContent(mixedInsert);
  assert.strictEqual(resMixed.changed, true);
  assert.ok(resMixed.content.includes('- insert:'));
  assert.ok(resMixed.content.includes('other-plugin'));
  assert.ok(!resMixed.content.includes('winetoken-plugin'));

  const soloInsert = [
    '- insert:',
    '    - id: winetoken-plugin',
    '      name: "@winetoken/dsh-plugin-winetoken"',
    '- id: ui-theme',
    '  config:',
    '    theme: dark',
    ''
  ].join('\n');

  const resSolo = cleanWineTokenFromPatchContent(soloInsert);
  assert.strictEqual(resSolo.changed, true);
  assert.ok(!resSolo.content.includes('- insert:'));
  assert.ok(!resSolo.content.includes('winetoken-plugin'));
  assert.ok(resSolo.content.includes('- id: ui-theme'));
});

test('PatchCleanup - 装时先清后写自愈幂等与 ensureBaselineProviderInPatch 结构自愈', () => {
  const cleanBaseline = buildCleanBaseline();
  const dirtyFixture = buildDirtyFixture(cleanBaseline);
  const baselineModels = getBaselineModels();

  const healed = mergeProviderIntoPatchContent(dirtyFixture, {
    id: 'winetoken',
    displayName: 'WineToken (全平台推理模型)',
    api: 'openai-completions',
    baseURL: 'https://www.winetoken.asia/v1',
    apiKeyEnv: 'WINETOKEN_API_KEY',
    models: baselineModels
  });

  const state = inspectPatchState(healed);
  assert.strictEqual(state.isCleanSingleWineToken, true);
  assert.strictEqual(state.hasManagedMarkers, true);
  assert.strictEqual(state.llmPiAiEntryCount, 1);
  assert.strictEqual(state.winetokenProviderCount, 1);
  assert.strictEqual(state.winetokenPluginCount, 0);
  assert.strictEqual(state.hasLegacyComments, false);
  assert.strictEqual(state.winetokenModelCount, baselineModels.length);
  assert.ok(healed.includes('- id: ui-theme'));

  // 幂等快路径验证
  const secondMerge = mergeProviderIntoPatchContent(healed, {
    id: 'winetoken',
    displayName: 'WineToken (全平台推理模型)',
    api: 'openai-completions',
    baseURL: 'https://www.winetoken.asia/v1',
    apiKeyEnv: 'WINETOKEN_API_KEY',
    models: baselineModels
  });
  assert.strictEqual(secondMerge, healed);

  // ensureBaselineProviderInPatch 自愈测试：即使存在残留或空骨架也会触发自愈，而干净线上配置不会被覆盖
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'winetoken-heal-'));
  const patchFile = path.join(tmpDir, 'cordis.patch.yml');
  try {
    // 1. 脏文件自愈
    fs.writeFileSync(patchFile, dirtyFixture, 'utf-8');
    assert.strictEqual(ensureBaselineProviderInPatch({ patchFile }), true);
    const afterHeal = fs.readFileSync(patchFile, 'utf-8');
    assert.strictEqual(inspectPatchState(afterHeal).isCleanSingleWineToken, true);
    assert.strictEqual(inspectPatchState(afterHeal).winetokenModelCount, baselineModels.length);

    // 2. 干净单段动态同步清单（模拟无标记的 configEditor 持久化）不应被基线覆盖
    const customOnline = [
      '- id: llm-pi-ai',
      '  name: "@deepseek-ai/dsh-llm-pi-ai"',
      '  config:',
      '    providers:',
      serializeProviderYaml({
        id: 'winetoken',
        displayName: 'WineToken 聚合平台',
        baseURL: 'https://www.winetoken.asia/v1',
        apiKeyEnv: 'WINETOKEN_API_KEY',
        models: [
          { id: 'online-model-1', name: 'Online 1' },
          { id: 'online-model-2', name: 'Online 2' }
        ]
      }, '      '),
      ''
    ].join('\n');
    fs.writeFileSync(patchFile, customOnline, 'utf-8');
    assert.strictEqual(ensureBaselineProviderInPatch({ patchFile }), true);
    assert.strictEqual(fs.readFileSync(patchFile, 'utf-8'), customOnline, '干净单段线上模型配置不得被基线覆盖');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('PatchCleanup - CRLF 与无末尾换行兼容性', () => {
  const cleanLf = buildCleanBaseline();
  const cleanCrlf = cleanLf.replace(/\n/g, '\r\n');
  const dirtyCrlf = buildDirtyFixture(cleanLf).replace(/\n/g, '\r\n');

  const res = cleanWineTokenFromPatchContent(dirtyCrlf);
  assert.strictEqual(res.changed, true);
  assert.strictEqual(res.content, cleanCrlf);
  assert.strictEqual(/(?<!\r)\n/.test(res.content), false, '不得引入孤立 LF');

  const noTrailingBase = '- id: ui-theme\r\n  config:\r\n    theme: dark';
  const noTrailingDirty = `${noTrailingBase}\r\n${MANAGED_START_PREFIX} (mode=full-entry) >>>\r\n- id: winetoken-plugin\r\n  name: "@winetoken/dsh-plugin-winetoken"\r\n${MANAGED_END_LINE}`;
  const resNoTrail = cleanWineTokenFromPatchContent(noTrailingDirty);
  assert.strictEqual(resNoTrail.changed, true);
  assert.strictEqual(resNoTrail.content, noTrailingBase);
});

test('PatchCleanup - safe_uninstall CLI 入口幂等退出 0', () => {
  const cleanBaseline = buildCleanBaseline();
  const dirtyFixture = buildDirtyFixture(cleanBaseline);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'winetoken-cli-'));
  const patchFile = path.join(tmpDir, 'cordis.patch.yml');

  try {
    fs.writeFileSync(patchFile, dirtyFixture, 'utf-8');

    const dry = runUninstall(['--patch-file', patchFile, '--dry-run']);
    assert.strictEqual(dry.exitCode, 0);
    assert.strictEqual(dry.result.changed, true);
    assert.strictEqual(fs.readFileSync(patchFile, 'utf-8'), dirtyFixture);

    const first = runUninstall(['--patch-file', patchFile]);
    assert.strictEqual(first.exitCode, 0);
    assert.strictEqual(first.result.changed, true);
    assert.strictEqual(fs.readFileSync(patchFile, 'utf-8'), cleanBaseline);

    const logs = [];
    const origLog = console.log;
    try {
      console.log = (...args) => logs.push(args.join(' '));
      const second = runUninstall(['--patch-file', patchFile]);
      assert.strictEqual(second.exitCode, 0);
      assert.strictEqual(second.result.changed, false);
    } finally {
      console.log = origLog;
    }
    assert.ok(logs.some(line => line.includes('cordis.patch.yml is already clean (no changes).')));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
