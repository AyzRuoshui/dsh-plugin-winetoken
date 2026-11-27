// -*- coding: utf-8 -*-
// v2.5.19 全量打包：loader/产物防护回归测试。
// 重写依赖"万能 require 桩"的 5 项用例：生产路径 = 打包表查表（同步命中），
// 宿主 require 只认 seed；相对 require 一律抛 missed the module table。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const CLIENT_PATH = path.resolve(__dirname, '..', 'src', 'client.js');
const REACTFLOW_PATH = path.resolve(__dirname, '..', 'src', 'canvas-reactflow.js');
const SRC_DIR = path.resolve(__dirname, '..', 'src');
const DIST_CLIENT = path.resolve(__dirname, '..', 'dist', 'client.js');
const realRequire = require;
const { makeHostRequire, HOST_RELATIVE_ERROR } = require('./helpers/host-require-stub.cjs');

const EXPECTED_SIBLINGS = [
  './canvas-storage.js', './canvas-job-queue.js', './canvas-math.js',
  './canvas-history.js', './canvas-project-store.js', './canvas-minimap.js',
  './canvas-nodes.js', './canvas-export.js', './canvas-assets.js',
  './canvas-video.js', './canvas-prompts.js', './canvas-pricing.js'
];

function makeStatefulTestReact() {
  const slots = [];
  let cursor = 0;
  return {
    beginRender() { cursor = 0; },
    createContext(defaultVal) { return { Provider: 'MockProvider', _defaultValue: defaultVal }; },
    createElement(type, props, ...children) {
      return { type, props: { ...(props || {}), children: children.length <= 1 ? children[0] : children } };
    },
    useState(init) {
      const idx = cursor++;
      if (!(idx in slots)) slots[idx] = typeof init === 'function' ? init() : init;
      return [slots[idx], (u) => { slots[idx] = typeof u === 'function' ? u(slots[idx]) : u; }];
    },
    useRef(init) {
      const idx = cursor++;
      if (!(idx in slots)) slots[idx] = { current: init };
      return slots[idx];
    },
    useEffect() { cursor++; },
    useMemo(fn) { cursor++; return fn(); },
    useCallback(fn) { cursor++; return fn; },
    useContext() { return {}; }
  };
}

function findReactFlowNodesProp(el) {
  if (!el || typeof el !== 'object') return null;
  if (el.props && Array.isArray(el.props.nodes) && el.props.nodeTypes) return el.props.nodes;
  const children = el.props && el.props.children;
  if (Array.isArray(children)) {
    for (const c of children) { const found = findReactFlowNodesProp(c); if (found) return found; }
  } else if (children) {
    return findReactFlowNodesProp(children);
  }
  return null;
}

// 构造打包表（真实 src 模块）；overrides 可令某模块缺失/替身。
function makeBundledTable({ overrides = {} } = {}) {
  const table = {};
  for (const id of EXPECTED_SIBLINGS) {
    if (Object.prototype.hasOwnProperty.call(overrides, id)) {
      if (overrides[id] === '__THROW__') continue;
      table[id] = overrides[id];
    } else {
      table[id] = realRequire(path.join(SRC_DIR, id));
    }
  }
  return table;
}

function loadClientInVm({ bundled, factoryRequire, windowObj, hasGlobalRequire = false, globalRequire = null } = {}) {
  const code = fs.readFileSync(CLIENT_PATH, 'utf8');
  const mod = { exports: {} };
  const errors = [];
  const sandbox = {
    module: mod, exports: mod.exports,
    console: { log() {}, warn() {}, error(...args) { errors.push(args); } },
    setInterval: () => ({ unref() {} }), clearInterval: () => {},
    setTimeout: () => ({ unref() {} }), clearTimeout: () => {},
    Buffer
  };
  if (bundled) sandbox.__WINETOKEN_BUNDLED_SIBLINGS__ = bundled;
  if (hasGlobalRequire) sandbox.require = globalRequire;
  if (windowObj !== undefined) sandbox.window = windowObj;
  // v2.5.19：忠实宿主装载流程——factory 由 __ModuleLoader__.load 注册后，宿主在装载
  // 阶段用注入的 require 执行它（与 noload-factory.test.js 的 harness 同款）。
  // 旧 harness 收下 factoryRequire 却从不执行 factory，宿主 require 根本进不了
  // ensureSiblingModules 的兜底链，loadSiblingModule 因此返回 error:null，报出无后缀
  // 原文案——这是"测试场景与新架构不符"，不是实现缺陷。
  // 只在显式注入 factoryRequire 时补建 __ModuleLoader__ 并执行 factory：
  // 无 require 场景（用例 3）保持原样，仍走"完全没有任何 require 可用"的原文案语义。
  if (typeof factoryRequire === 'function') {
    let win = sandbox.window;
    if (!win || typeof win !== 'object') {
      win = {};
      sandbox.window = win;
    }
    if (!win.__ModuleLoader__) {
      win.__ModuleLoader__ = {
        load(def) {
          if (def && typeof def.factory === 'function') def.factory(factoryRequire);
        }
      };
    }
  }
  vm.runInNewContext(code, sandbox, { filename: CLIENT_PATH });
  return { exports: mod.exports, sandbox, errors };
}

function loadReactFlowInVm({ bundled, hasGlobalRequire = false, globalRequire = null, windowObj } = {}) {
  const code = fs.readFileSync(REACTFLOW_PATH, 'utf8');
  const mod = { exports: {} };
  const errors = [];
  const sandbox = {
    module: mod, exports: mod.exports,
    console: { log() {}, warn() {}, error(...args) { errors.push(args); } },
    Buffer
  };
  if (bundled) sandbox.__WINETOKEN_BUNDLED_SIBLINGS__ = bundled;
  if (hasGlobalRequire) sandbox.require = globalRequire;
  if (windowObj !== undefined) sandbox.window = windowObj;
  vm.runInNewContext(code, sandbox, { filename: REACTFLOW_PATH });
  return { exports: mod.exports, sandbox, errors };
}

// 用例 1：仅 seed require + 打包表（无 window.require）时兄弟全命中，视频判定可用。
test('LoaderGuard - 仅 seed require + 打包表时 12 兄弟全命中且视频可用', () => {
  const bundled = makeBundledTable();
  const hostReq = makeHostRequire({ seedValues: { react: makeStatefulTestReact() } });
  const { exports } = loadClientInVm({ bundled, factoryRequire: hostReq });

  for (const modId of EXPECTED_SIBLINGS) {
    assert.ok(exports.WT_SIBLING_REGISTRY[modId] != null, `打包表应命中 ${modId}`);
  }
  assert.equal(exports.getCanvasVideoUnavailableError(), '', '打包表命中后视频组件应判定可用');
});

// 用例 2：canvas-reactflow.js 打包表 hydrate 后组件可用；宿主相对 require 仍保持原文错误。
test('LoaderGuard - canvas-reactflow.js 打包表 hydrate 后组件可用', () => {
  const testReact = makeStatefulTestReact();
  const bundled = makeBundledTable();
  bundled['react'] = testReact;
  bundled['./vendor/xyflow.factory.cjs'] = () => ({ ReactFlow: 'RF', cssText: '.react-flow{}' });
  const { exports } = loadReactFlowInVm({ bundled, windowObj: { React: testReact } });
  assert.equal(typeof exports.createReactFlowWorkspace, 'function');
  assert.equal(exports.hydrateSiblingModules(makeHostRequire({ seedValues: { react: testReact } })), true);
});

// 用例 3：require 与 window.require 都没有、打包表也没有时模块为 null 且不抛异常，报错保持原文案。
test('LoaderGuard - 无打包表无 require 时模块为 null 且不抛异常，报错保持原文案', async () => {
  const clientNoWin = loadClientInVm({ windowObj: undefined });
  assert.equal(clientNoWin.exports.getCanvasVideoUnavailableError(), clientNoWin.exports.VIDEO_MODULE_LOAD_ERROR_MSG);
  const clientNoWinRes = clientNoWin.exports.loadSiblingModule('./canvas-video.js', { primaryRequire: null, windowObj: null });
  assert.equal(clientNoWinRes.mod, null);
  assert.equal(clientNoWinRes.error, null);
  assert.equal(clientNoWin.exports.resolveNodeRequire({ primaryRequire: null, windowObj: {} }), null);

  const clientEmptyWin = loadClientInVm({ windowObj: {} });
  assert.equal(clientEmptyWin.exports.getCanvasVideoUnavailableError(), clientEmptyWin.exports.VIDEO_MODULE_LOAD_ERROR_MSG);

  const rfBare = loadReactFlowInVm({ windowObj: undefined });
  assert.equal(typeof rfBare.exports.createReactFlowWorkspace, 'function');
  const rfBareRes = rfBare.exports.loadSiblingModule('./canvas-video.js', { primaryRequire: null, windowObj: null });
  assert.equal(rfBareRes.mod, null);
  assert.equal(rfBareRes.error, null);

  // 注入测试 React（仍无 require / 打包表），视频节点报错保持原文案
  const testReact = makeStatefulTestReact();
  const rfWithReact = loadReactFlowInVm({ windowObj: { React: testReact } });
  const WorkspaceComp = rfWithReact.exports.createReactFlowWorkspace({
    React: testReact,
    initXyFlow: () => ({ ReactFlow: 'RF', MiniMap: 'MM', Controls: 'C', Background: 'B', Panel: 'P', Handle: 'H', Position: {} }),
    canvasProjectStore: {
      ensureLegacyMigration() {},
      getActiveId: () => 'proj_no_req',
      loadProject: () => ({ version: '2.5.1', nodes: [{ id: 'vid_1', type: 'videoNode', position: { x: 0, y: 0 }, data: { name: 'v', prompt: 'p', params: {} } }], edges: [] }),
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

// 用例 4：加载异常时报错文案带真实原因（原文错误 + 120 字截断清洗）。
test('LoaderGuard - 加载异常时 client.js 与 canvas-reactflow.js 报错文案均带上真实原因（截断 120 字）', async () => {
  // 1. 打包表缺 canvas-video.js，宿主相对 require 抛原文错误 → 带原因
  const bundled = makeBundledTable({ overrides: { './canvas-video.js': '__THROW__' } });
  const hostReq = makeHostRequire({ seedValues: { react: makeStatefulTestReact() } });
  const clientFail = loadClientInVm({ bundled, factoryRequire: hostReq });
  const clientErrMsg = clientFail.exports.getCanvasVideoUnavailableError();
  assert.ok(clientErrMsg.startsWith(clientFail.exports.VIDEO_MODULE_LOAD_ERROR_MSG));
  assert.match(clientErrMsg, new RegExp(`（原因：.*${HOST_RELATIVE_ERROR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}）`));

  // 2. 无打包表、宿主相对 require 抛原文错误 → 同样带真实原因
  const brokenHostReq = makeHostRequire({ seedValues: { react: makeStatefulTestReact() } });
  const clientBroken = loadClientInVm({ factoryRequire: brokenHostReq, windowObj: {} });
  assert.match(clientBroken.exports.getCanvasVideoUnavailableError(), new RegExp(HOST_RELATIVE_ERROR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  // 3. 打包表命中时即便宿主报错也判可用
  const clientOk = loadClientInVm({ bundled: makeBundledTable(), factoryRequire: makeHostRequire({ seedValues: { react: makeStatefulTestReact() } }), windowObj: {} });
  assert.equal(clientOk.exports.getCanvasVideoUnavailableError(), '');

  // 4. canvas-reactflow.js：打包表缺视频 → 视频节点 error 带原因
  const testReact = makeStatefulTestReact();
  const rfBundled = makeBundledTable({ overrides: { './canvas-video.js': '__THROW__' } });
  const rfHostReq = makeHostRequire({ seedValues: { react: testReact } });
  const rfFail = loadReactFlowInVm({ bundled: rfBundled, windowObj: { React: testReact } });
  rfFail.exports.hydrateSiblingModules(rfHostReq);
  const WorkspaceComp = rfFail.exports.createReactFlowWorkspace({
    React: testReact,
    initXyFlow: () => ({ ReactFlow: 'RF', MiniMap: 'MM', Controls: 'C', Background: 'B', Panel: 'P', Handle: 'H', Position: {} }),
    // client.js 在 factory 内把真实加载错误经 deps.canvasVideoLoadError 传入（见 client.js:8641）
    canvasVideoLoadError: (() => { try { rfHostReq('./canvas-video.js'); } catch (e) { return e; } return null; })(),
    canvasProjectStore: {
      ensureLegacyMigration() {},
      getActiveId: () => 'proj_err_msg',
      loadProject: () => ({ version: '2.5.1', nodes: [{ id: 'vid_err', type: 'videoNode', position: { x: 0, y: 0 }, data: { name: 'v', prompt: 'p', params: {} } }], edges: [] }),
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
  assert.match(vidErrNode.data.videoState.error, new RegExp(`（原因：.*${HOST_RELATIVE_ERROR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}）`));

  // 5. 超长异常信息（>120 字）与换行符截断清洗
  const longReason = 'A'.repeat(60) + '\n' + 'B'.repeat(140);
  const formatted = clientFail.exports.formatVideoModuleLoadError(new Error(longReason));
  const expectedReason = ('A'.repeat(60) + ' ' + 'B'.repeat(140)).slice(0, 120);
  assert.equal(formatted, `${clientFail.exports.VIDEO_MODULE_LOAD_ERROR_MSG}（原因：${expectedReason}）`);
  assert.equal(clientFail.exports.formatVideoModuleLoadError(new Error('   ')), clientFail.exports.VIDEO_MODULE_LOAD_ERROR_MSG);
});

// 用例 5：静态审计 —— 源码与产物中不再有裸相对 require('./...')
test('LoaderGuard - 静态审计: client.js / canvas-reactflow.js（及产物）中无裸 require("./...")', () => {
  for (const filePath of [CLIENT_PATH, REACTFLOW_PATH]) {
    const raw = fs.readFileSync(filePath, 'utf8');
    const codeOnly = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const bareRelativeMatches = codeOnly.match(/(?:^|[^\w.])require\s*\(\s*['"]\.\//gm) || [];
    assert.deepEqual(bareRelativeMatches, [], `${path.basename(filePath)} 不应再包含裸 require('./...') 调用`);
  }
  if (fs.existsSync(DIST_CLIENT)) {
    const raw = fs.readFileSync(DIST_CLIENT, 'utf8');
    const matches = raw.match(/require\s*\(\s*['"]\.\/[^'"]+['"]\s*\)/g) || [];
    assert.deepEqual(matches, [], 'dist/client.js 不应残留相对 require');
  } else {
    console.log('[skip] dist/client.js 不存在，产物静态审计跳过（下游构建后执行）');
  }
});
