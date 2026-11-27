// -*- coding: utf-8 -*-
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const CLIENT_PATH = path.resolve(__dirname, '..', 'src', 'client.js');
const REACTFLOW_PATH = path.resolve(__dirname, '..', 'src', 'canvas-reactflow.js');
const realCanvasVideo = require('../src/canvas-video.js');

function makeStatefulTestReact() {
  const slots = [];
  let cursor = 0;
  return {
    beginRender() { cursor = 0; },
    createContext(defaultVal) {
      return { Provider: 'MockProvider', _defaultValue: defaultVal };
    },
    createElement(type, props, ...children) {
      return {
        type,
        props: {
          ...(props || {}),
          children: children.length <= 1 ? children[0] : children
        }
      };
    },
    useState(init) {
      const idx = cursor++;
      if (!(idx in slots)) {
        slots[idx] = typeof init === 'function' ? init() : init;
      }
      const setState = (updater) => {
        slots[idx] = typeof updater === 'function' ? updater(slots[idx]) : updater;
      };
      return [slots[idx], setState];
    },
    useRef(init) {
      const idx = cursor++;
      if (!(idx in slots)) slots[idx] = { current: init };
      return slots[idx];
    },
    useEffect() { cursor++; },
    useMemo(fn) {
      cursor++;
      return fn();
    },
    useCallback(fn) {
      cursor++;
      return fn;
    },
    useContext() { return {}; }
  };
}

function findReactFlowNodesProp(el) {
  if (!el || typeof el !== 'object') return null;
  if (el.props && Array.isArray(el.props.nodes) && el.props.nodeTypes) return el.props.nodes;
  const children = el.props && el.props.children;
  if (Array.isArray(children)) {
    for (const c of children) {
      const found = findReactFlowNodesProp(c);
      if (found) return found;
    }
  } else if (children) {
    return findReactFlowNodesProp(children);
  }
  return null;
}

function createSiblingMockRequire({ videoBehavior = 'ok', requested = [] } = {}) {
  const siblings = {
    './canvas-storage.js': { CanvasProjectStorage: class MockCanvasProjectStorage {} },
    './canvas-job-queue.js': { canvasJobQueue: { subscribe: () => () => {} } },
    './canvas-math.js': { snapToGrid: (v) => v },
    './canvas-history.js': { CanvasHistoryManager: class MockCanvasHistoryManager {} },
    './canvas-project-store.js': { CanvasProjectStore: class MockCanvasProjectStore {} },
    './canvas-minimap.js': { MINIMAP_DEFAULTS: { width: 240, height: 160, padding: 500 } },
    './canvas-nodes.js': { buildGenerationContext: () => ({ prompt: '', referenceImages: [], params: {} }) },
    './canvas-export.js': { buildExportManifest: () => ({}) },
    './canvas-assets.js': {
      CanvasAssets: class MockCanvasAssets {},
      AssetLibraryStore: class MockAssetLibraryStore {}
    },
    './canvas-prompts.js': { normalizeLibrary: () => ({ version: 1, items: [] }) },
    './canvas-pricing.js': { calculateImagePrice: () => ({}) },
    './vendor/xyflow.factory.cjs': () => ({
      ReactFlow: 'MockReactFlow',
      MiniMap: 'MockMiniMap',
      Controls: 'MockControls',
      Background: 'MockBackground',
      Panel: 'MockPanel',
      Handle: 'MockHandle',
      Position: { Left: 'left', Right: 'right' }
    }),
    fs: { existsSync: () => false },
    path: { join: (...parts) => parts.join('/') },
    os: { homedir: () => '/tmp' }
  };

  return function mockRequire(id) {
    requested.push(id);
    if (id === './canvas-video.js') {
      if (videoBehavior === 'throw') {
        throw new Error("Cannot find module './canvas-video.js'");
      }
      if (typeof videoBehavior === 'function') {
        return videoBehavior();
      }
      return realCanvasVideo;
    }
    if (Object.prototype.hasOwnProperty.call(siblings, id)) {
      return siblings[id];
    }
    throw new Error(`Unexpected module request: ${id}`);
  };
}

function loadClientInVm({ hasGlobalRequire = false, globalRequire = null, windowObj } = {}) {
  const code = fs.readFileSync(CLIENT_PATH, 'utf8');
  const mod = { exports: {} };
  const errors = [];
  const sandbox = {
    module: mod,
    exports: mod.exports,
    console: {
      log() {},
      warn() {},
      error(...args) { errors.push(args); }
    },
    setInterval: () => ({ unref() {} }),
    clearInterval: () => {},
    setTimeout: () => ({ unref() {} }),
    clearTimeout: () => {},
    Buffer
  };
  if (hasGlobalRequire) {
    sandbox.require = globalRequire;
  }
  if (windowObj !== undefined) {
    sandbox.window = windowObj;
  }
  vm.runInNewContext(code, sandbox, { filename: CLIENT_PATH });
  return { exports: mod.exports, sandbox, errors };
}

function loadReactFlowInVm({ hasGlobalRequire = false, globalRequire = null, windowObj } = {}) {
  const code = fs.readFileSync(REACTFLOW_PATH, 'utf8');
  const mod = { exports: {} };
  const errors = [];
  const sandbox = {
    module: mod,
    exports: mod.exports,
    console: {
      log() {},
      warn() {},
      error(...args) { errors.push(args); }
    },
    Buffer
  };
  if (hasGlobalRequire) {
    sandbox.require = globalRequire;
  }
  if (windowObj !== undefined) {
    sandbox.window = windowObj;
  }
  vm.runInNewContext(code, sandbox, { filename: REACTFLOW_PATH });
  return { exports: mod.exports, sandbox, errors };
}

test('LoaderGuard - client.js 无全局 require、只有 window.require 时兄弟模块仍能正常加载', () => {
  const requested = [];
  const winRequire = createSiblingMockRequire({ videoBehavior: 'ok', requested });
  let capturedDeps = null;
  const loaderReq = createSiblingMockRequire({ videoBehavior: 'ok', requested });
  const testReact = makeStatefulTestReact();
  let registeredPlugin = null;

  const windowObj = {
    require: winRequire,
    __ModuleLoader__: {
      load(def) { registeredPlugin = def; }
    }
  };

  const { exports } = loadClientInVm({ hasGlobalRequire: false, windowObj });

  // 12 个顶层兄弟模块全部走 window.require 成功触发加载
  const expectedSiblings = [
    './canvas-storage.js',
    './canvas-job-queue.js',
    './canvas-math.js',
    './canvas-history.js',
    './canvas-project-store.js',
    './canvas-minimap.js',
    './canvas-nodes.js',
    './canvas-export.js',
    './canvas-assets.js',
    './canvas-video.js',
    './canvas-prompts.js',
    './canvas-pricing.js'
  ];
  for (const modId of expectedSiblings) {
    assert.ok(requested.includes(modId), `应通过 window.require 加载兄弟模块 ${modId}`);
  }
  assert.equal(exports.getCanvasVideoUnavailableError(), '', 'window.require 加载 canvas-video.js 后应判定可用');

  // ModuleLoader factory 内的 require 只认 react、相对路径抛错时，也应回退 window.require
  const factoryRequire = (id) => {
    if (id === 'react') return testReact;
    throw new Error(`ModuleLoader cannot resolve ${id}`);
  };
  windowObj.require = (id) => {
    if (id === './canvas-reactflow.js') {
      return {
        createReactFlowWorkspace: (deps) => {
          capturedDeps = deps;
          return function MockRFWorkspace() { return null; };
        }
      };
    }
    return loaderReq(id);
  };
  assert.ok(registeredPlugin && typeof registeredPlugin.factory === 'function');
  registeredPlugin.factory(factoryRequire);
  assert.ok(capturedDeps, 'factory 内应回退 window.require 成功加载 canvas-reactflow.js 与 xyflow.factory.cjs');
  assert.equal(capturedDeps.CanvasVideoUtils, realCanvasVideo);
});

test('LoaderGuard - canvas-reactflow.js 无全局 require、只有 window.require 时兄弟模块仍能正常加载', () => {
  const requested = [];
  const testReact = makeStatefulTestReact();
  const baseMock = createSiblingMockRequire({ videoBehavior: 'ok', requested });
  const winRequire = (id) => {
    requested.push(id);
    if (id === 'react') return testReact;
    return baseMock(id);
  };

  const { exports } = loadReactFlowInVm({
    hasGlobalRequire: false,
    windowObj: { require: winRequire }
  });

  for (const modId of [
    'react',
    './canvas-nodes.js',
    './canvas-pricing.js',
    './canvas-prompts.js',
    './canvas-video.js',
    './canvas-export.js',
    './vendor/xyflow.factory.cjs'
  ]) {
    assert.ok(requested.includes(modId), `canvas-reactflow.js 应通过 window.require 加载 ${modId}`);
  }
  assert.equal(typeof exports.createReactFlowWorkspace, 'function');
});

test('LoaderGuard - require 与 window.require 都没有时模块为 null 且不抛异常，报错保持原文案', async () => {
  // 1. client.js: 无 require 且无 window
  const clientNoWin = loadClientInVm({ hasGlobalRequire: false, windowObj: undefined });
  assert.equal(
    clientNoWin.exports.getCanvasVideoUnavailableError(),
    clientNoWin.exports.VIDEO_MODULE_LOAD_ERROR_MSG,
    '无异常对象时应保持原文案'
  );
  const clientNoWinRes = clientNoWin.exports.loadSiblingModule('./canvas-video.js', { primaryRequire: null, windowObj: null });
  assert.equal(clientNoWinRes.mod, null, '无 require 时 mod 应为 null');
  assert.equal(clientNoWinRes.error, null, '无 require 时 error 应为 null');
  assert.equal(clientNoWin.exports.resolveNodeRequire({ primaryRequire: null, windowObj: {} }), null);

  // 2. client.js: window 存在但没有 window.require
  const clientEmptyWin = loadClientInVm({ hasGlobalRequire: false, windowObj: {} });
  assert.equal(
    clientEmptyWin.exports.getCanvasVideoUnavailableError(),
    clientEmptyWin.exports.VIDEO_MODULE_LOAD_ERROR_MSG
  );

  // 3. canvas-reactflow.js: 无 require 且无 window.require、无 window.React 时顶层加载不抛
  const rfBare = loadReactFlowInVm({ hasGlobalRequire: false, windowObj: undefined });
  assert.equal(typeof rfBare.exports.createReactFlowWorkspace, 'function');
  const rfBareRes = rfBare.exports.loadSiblingModule('./canvas-video.js', { primaryRequire: null, windowObj: null });
  assert.equal(rfBareRes.mod, null, '无 require 时 mod 应为 null');
  assert.equal(rfBareRes.error, null, '无 require 时 error 应为 null');

  // 4. canvas-reactflow.js: 注入测试 React（仍无 require 与 window.require），触发视频节点报错保持原文案
  const testReact = makeStatefulTestReact();
  const rfWithReact = loadReactFlowInVm({ hasGlobalRequire: false, windowObj: { React: testReact } });
  const WorkspaceComp = rfWithReact.exports.createReactFlowWorkspace({
    React: testReact,
    initXyFlow: () => ({
      ReactFlow: 'MockReactFlow',
      MiniMap: 'MockMiniMap',
      Controls: 'MockControls',
      Background: 'MockBackground',
      Panel: 'MockPanel',
      Handle: 'MockHandle',
      Position: { Left: 'left', Right: 'right' }
    }),
    canvasProjectStore: {
      ensureLegacyMigration() {},
      getActiveId: () => 'proj_no_req',
      loadProject: () => ({
        version: '2.5.1',
        nodes: [{ id: 'vid_1', type: 'videoNode', position: { x: 0, y: 0 }, data: { name: 'v', prompt: 'p', params: {} } }],
        edges: []
      }),
      saveProject() {}
    }
  });
  testReact.beginRender();
  const tree1 = WorkspaceComp({ theme: { isDark: true } });
  await tree1.props.value.generateNode('vid_1');
  testReact.beginRender();
  const tree2 = WorkspaceComp({ theme: { isDark: true } });
  const vidNode = findReactFlowNodesProp(tree2).find((n) => n.id === 'vid_1');
  assert.equal(vidNode.data.videoState.status, 'failed');
  assert.equal(vidNode.data.videoState.error, rfWithReact.exports.VIDEO_MODULE_LOAD_ERROR_MSG);
});

test('LoaderGuard - 加载异常时 client.js 与 canvas-reactflow.js 报错文案均带上真实原因（截断 120 字）', async () => {
  // 1. client.js: require 抛异常时 getCanvasVideoUnavailableError 带原因
  const winReqFail = createSiblingMockRequire({ videoBehavior: 'throw' });
  const clientFail = loadClientInVm({ hasGlobalRequire: false, windowObj: { require: winReqFail } });
  const clientErrMsg = clientFail.exports.getCanvasVideoUnavailableError();
  assert.ok(clientErrMsg.startsWith(clientFail.exports.VIDEO_MODULE_LOAD_ERROR_MSG));
  assert.equal(
    clientErrMsg,
    `${clientFail.exports.VIDEO_MODULE_LOAD_ERROR_MSG}（原因：Cannot find module './canvas-video.js'）`
  );

  // 2. 全局 require 无法解析相对路径、且无 window.require 时，同样带真实异常原因
  const brokenGlobalReq = (id) => {
    throw new Error(`Relative module '${id}' is not allowed in sandbox`);
  };
  const clientBrokenGlobal = loadClientInVm({
    hasGlobalRequire: true,
    globalRequire: brokenGlobalReq,
    windowObj: {}
  });
  assert.match(
    clientBrokenGlobal.exports.getCanvasVideoUnavailableError(),
    /（原因：Relative module '\.\/canvas-video\.js' is not allowed in sandbox）/
  );

  // 3. 全局 require 抛异常但 window.require 可用时，自动回退 window.require 成功加载
  const winReqOk = createSiblingMockRequire({ videoBehavior: 'ok' });
  const clientFallbackOk = loadClientInVm({
    hasGlobalRequire: true,
    globalRequire: brokenGlobalReq,
    windowObj: { require: winReqOk }
  });
  assert.equal(clientFallbackOk.exports.getCanvasVideoUnavailableError(), '');

  // 4. canvas-reactflow.js: 加载 ./canvas-video.js 抛异常时，视频节点 error 带原因
  const testReact = makeStatefulTestReact();
  const rfReqFail = (id) => {
    if (id === 'react') return testReact;
    if (id === './canvas-video.js') throw new Error('EACCES: permission denied on canvas-video.js');
    return createSiblingMockRequire({ videoBehavior: 'ok' })(id);
  };
  const rfFail = loadReactFlowInVm({
    hasGlobalRequire: false,
    windowObj: { require: rfReqFail }
  });
  const WorkspaceComp = rfFail.exports.createReactFlowWorkspace({
    React: testReact,
    initXyFlow: () => ({
      ReactFlow: 'MockReactFlow',
      MiniMap: 'MockMiniMap',
      Controls: 'MockControls',
      Background: 'MockBackground',
      Panel: 'MockPanel',
      Handle: 'MockHandle',
      Position: { Left: 'left', Right: 'right' }
    }),
    canvasProjectStore: {
      ensureLegacyMigration() {},
      getActiveId: () => 'proj_err_msg',
      loadProject: () => ({
        version: '2.5.1',
        nodes: [{ id: 'vid_err', type: 'videoNode', position: { x: 0, y: 0 }, data: { name: 'v', prompt: 'p', params: {} } }],
        edges: []
      }),
      saveProject() {}
    }
  });
  testReact.beginRender();
  const tree1 = WorkspaceComp({ theme: { isDark: true } });
  await tree1.props.value.generateNode('vid_err');
  testReact.beginRender();
  const tree2 = WorkspaceComp({ theme: { isDark: true } });
  const vidErrNode = findReactFlowNodesProp(tree2).find((n) => n.id === 'vid_err');
  assert.equal(vidErrNode.data.videoState.status, 'failed');
  assert.equal(
    vidErrNode.data.videoState.error,
    `${rfFail.exports.VIDEO_MODULE_LOAD_ERROR_MSG}（原因：EACCES: permission denied on canvas-video.js）`
  );

  // 5. 超长异常信息（> 120 字）与换行符截断清洗验证
  const longReason = 'A'.repeat(60) + '\n' + 'B'.repeat(140);
  const formatted = clientFail.exports.formatVideoModuleLoadError(new Error(longReason));
  const expectedReason = ('A'.repeat(60) + ' ' + 'B'.repeat(140)).slice(0, 120);
  assert.equal(formatted, `${clientFail.exports.VIDEO_MODULE_LOAD_ERROR_MSG}（原因：${expectedReason}）`);
  assert.equal(
    clientFail.exports.formatVideoModuleLoadError(new Error('   ')),
    clientFail.exports.VIDEO_MODULE_LOAD_ERROR_MSG,
    '空白 message 应回退原文案'
  );
});

test('LoaderGuard - 静态审计: client.js 与 canvas-reactflow.js 中不再存在裸 require("./...")', () => {
  for (const filePath of [CLIENT_PATH, REACTFLOW_PATH]) {
    const raw = fs.readFileSync(filePath, 'utf8');
    const codeOnly = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const bareRelativeMatches = codeOnly.match(/(?:^|[^\w.])require\s*\(\s*['"]\.\//gm) || [];
    assert.deepEqual(
      bareRelativeMatches,
      [],
      `${path.basename(filePath)} 不应再包含裸 require('./...') 调用`
    );
  }
});
