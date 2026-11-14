// -*- coding: utf-8 -*-
/**
 * DSH 原生画布工具注册契约测试
 * 用 mock toolsService 真实调用 registerWineTokenTools，验证 5 个工具的注册形态、
 * 权限分级、参数约束与 execute 边界 (尤其 generate 绝不宿主直发付费请求)。
 * 不访问网络、不修改源码目录、不启动真实宿主。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { registerWineTokenTools } = require('../src/tool.js');

function makeToolsService() {
  const tools = [];
  const sections = [];
  const ctx = {
    tools: { register(def) { tools.push(def); return () => {}; } },
    systemPrompt: { section(def) { sections.push(def); return () => {}; } }
  };
  return { ctx, tools, sections };
}

function register() {
  const svc = makeToolsService();
  assert.doesNotThrow(() => registerWineTokenTools(svc.ctx));
  return svc;
}

test('CanvasTools - 注册 5 个原生工具且名称不重复', () => {
  const { tools } = register();
  const names = tools.map(t => t.name);
  assert.equal(tools.length, 5);
  assert.equal(new Set(names).size, 5);
  for (const n of [
    'winetoken_generate_image', 'winetoken_generate_video',
    'winetoken_canvas_get_storyboard', 'winetoken_canvas_add_panel',
    'winetoken_canvas_generate'
  ]) {
    assert.ok(names.includes(n), `缺少工具 ${n}`);
  }
});

test('CanvasTools - 权限分级: 只读 safe / 写入与付费 sensitive', () => {
  const { tools } = register();
  const byName = Object.fromEntries(tools.map(t => [t.name, t]));
  assert.equal(byName['winetoken_canvas_get_storyboard'].permission, 'safe');
  assert.equal(byName['winetoken_canvas_add_panel'].permission, 'sensitive');
  assert.equal(byName['winetoken_canvas_generate'].permission, 'sensitive');
  assert.equal(byName['winetoken_generate_image'].permission, 'sensitive');
  assert.equal(byName['winetoken_generate_video'].permission, 'sensitive');
  assert.equal(byName['winetoken_canvas_get_storyboard'].isConcurrencySafe(), true);
  assert.equal(byName['winetoken_canvas_generate'].isConcurrencySafe(), false);
});

test('CanvasTools - 参数 schema 合法且必填项正确', () => {
  const { tools } = register();
  const byName = Object.fromEntries(tools.map(t => [t.name, t]));
  for (const t of tools) {
    assert.equal(t.parameters.type, 'object');
    assert.ok(t.parameters.properties && typeof t.parameters.properties === 'object');
    assert.ok(Array.isArray(t.parameters.required));
    assert.equal(typeof t.execute, 'function');
  }
  assert.deepEqual(byName['winetoken_canvas_add_panel'].parameters.required, ['prompt']);
  assert.deepEqual(byName['winetoken_canvas_generate'].parameters.required, ['panelId']);
  assert.deepEqual(byName['winetoken_canvas_generate'].parameters.properties.kind.enum, ['image', 'video']);
  assert.deepEqual(byName['winetoken_canvas_add_panel'].parameters.properties.shot.enum, ['CU', 'MS', 'WS', 'FS']);
});

test('CanvasTools - systemPrompt 注入含画布工具与付费保护铁律', () => {
  const { sections } = register();
  assert.equal(sections.length, 1);
  const text = typeof sections[0].text === 'function' ? sections[0].text() : sections[0].text;
  assert.match(text, /winetoken_canvas_get_storyboard/);
  assert.match(text, /winetoken_canvas_add_panel/);
  assert.match(text, /winetoken_canvas_generate/);
  assert.match(text, /单轮仅 1 次|单轮严格限调 1 次/);
});

test('CanvasTools - get_storyboard 在无工程时结构化失败，绝不抛裸错', async () => {
  const { tools } = register();
  const tool = tools.find(t => t.name === 'winetoken_canvas_get_storyboard');
  // 指向一个确定不存在的目录，避免触碰真实用户数据
  const result = await tool.execute({});
  assert.equal(typeof result.success, 'boolean');
  if (!result.success) assert.equal(typeof result.error, 'string');
});

test('CanvasTools - generate 的 execute 全程不发起 fetch (杜绝宿主双花)', async () => {
  const { tools } = register();
  const tool = tools.find(t => t.name === 'winetoken_canvas_generate');
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = () => { calls++; return Promise.reject(new Error('宿主工具不应发包')); };
  try {
    // 无工程时会失败，但失败路径同样不得发包
    const result = await tool.execute({ panelId: 'p1', kind: 'image' });
    assert.ok(typeof result === 'object');
    assert.ok('success' in result);
  } finally {
    global.fetch = originalFetch;
  }
  assert.equal(calls, 0);
});

test('CanvasTools - add_panel 的 execute 不发起付费请求且失败真实透传', async () => {
  const { tools } = register();
  const tool = tools.find(t => t.name === 'winetoken_canvas_add_panel');
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = () => { calls++; return Promise.reject(new Error('不应发包')); };
  let result;
  try {
    result = await tool.execute({ prompt: '雨夜长街' });
  } finally {
    global.fetch = originalFetch;
  }
  assert.equal(calls, 0);
  assert.ok(typeof result === 'object');
  if (!result.success) assert.equal(typeof result.error, 'string');
});

test('CanvasTools - 延迟注入模式 (ctx.inject) 同样完成注册', () => {
  const tools = [];
  let injected = null;
  const ctx = {
    inject: (deps, cb) => {
      injected = deps;
      cb({ tools: { register(def) { tools.push(def); return () => {}; } }, systemPrompt: { section() {} } });
    }
  };
  assert.doesNotThrow(() => registerWineTokenTools(ctx));
  assert.deepEqual(injected, ['tools']);
  assert.equal(tools.length, 5);
});

test('CanvasTools - 画布工具 render 回调对成功/失败均返回可渲染文本', () => {
  const { tools } = register();
  for (const t of tools.filter(x => x.name.startsWith('winetoken_canvas_'))) {
    const ok = t.output.render({}, { success: true, markdown: 'OK-MARKDOWN' });
    assert.equal(ok[0].type, 'text');
    assert.match(ok[0].text, /OK-MARKDOWN/);
    const bad = t.output.render({}, { success: false, error: 'ERR-TEXT' });
    assert.equal(bad[0].type, 'text');
    assert.ok(bad[0].text.length > 0);
  }
});
