// -*- coding: utf-8 -*-
// v2.5.19 全量打包：无模块加载器 / 忠实宿主 makeRequire 下的 sibling 加载回归测试。
// 依赖"万能 require 桩"（把 ./canvas-*.js 映射到 src 真实文件）的旧用例已全部重写：
// 生产路径 = 构建期把兄弟模块打进 globalThis.__WINETOKEN_BUNDLED_SIBLINGS__，
// 运行时同步查表；宿主 require 只认 seed，相对 require 必抛 missed the module table。
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

function makeTestReact() {
  const slots = [];
  let cursor = 0;
  const React = {
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
    useCallback(fn) { cursor++; return fn(); },
    useContext() { return {}; }
  };
  return React;
}

// 真实加载 12 兄弟 + reactflow + xyflow，构造"打包表"（模拟构建期内联模块对象）。
// 测试进程有真实 require，故可直接加载 src 模块；vm 沙箱内的 client.js 只查这张表，
// 不依赖任何 ./ 相对 require。
function makeBundledTable({ overrides = {} } = {}) {
  const table = {};
  for (const id of EXPECTED_SIBLINGS) {
    if (Object.prototype.hasOwnProperty.call(overrides, id)) {
      if (overrides[id] === '__THROW__') continue; // 模拟该模块未打进表（缺失）
      table[id] = overrides[id];
    } else {
      table[id] = realRequire(path.join(SRC_DIR, id));
    }
  }
  return table;
}

function loadClientInVm({ bundled, factoryRequire, collect = [], consoleErrors = [] } = {}) {
  const code = fs.readFileSync(CLIENT_PATH, 'utf8');
  const mod = { exports: {} };
  const sandbox = {
    module: mod,
    exports: mod.exports,
    console: {
      log() {}, warn() {},
      error(...args) { consoleErrors.push(args); }
    },
    setInterval: () => ({ unref() {} }),
    clearInterval: () => {},
    setTimeout: () => ({ unref() {} }),
    clearTimeout: () => {},
    Buffer
  };
  if (bundled) sandbox.__WINETOKEN_BUNDLED_SIBLINGS__ = bundled;
  const windowObj = {
    __ModuleLoader__: {
      load(def) {
        collect.push(def);
        if (factoryRequire) def.factory(factoryRequire);
      }
    }
  };
  sandbox.window = windowObj;
  vm.runInNewContext(code, sandbox, { filename: CLIENT_PATH });
  return { exports: mod.exports, sandbox, windowObj };
}

// 用例 1【硬性必测】：无全局 require、无 window.require，仅 factory 注入 seed require + 打包表，
// 12 个兄弟模块从打包表全部命中并可用（生产路径）。
test('noload-factory - 仅 factory seed require + 打包表时 12 个 sibling 全部命中可用', () => {
  const bundled = makeBundledTable();
  const hostReq = makeHostRequire({ seedValues: { react: makeTestReact() } });
  const regs = [];
  const { exports } = loadClientInVm({ bundled, factoryRequire: hostReq, collect: regs });

  assert.ok(regs.length === 1 && typeof regs[0].factory === 'function', 'ModuleLoader.load 应注册一个带 factory 的定义');
  assert.equal(exports.getCanvasVideoUnavailableError(), '', '打包表命中后视频组件应判定可用');

  const registry = exports.WT_SIBLING_REGISTRY;
  assert.ok(registry, '应导出 WT_SIBLING_REGISTRY');
  for (const id of EXPECTED_SIBLINGS) {
    assert.ok(registry[id] != null, `注册表应含 ${id}`);
  }

  assert.equal(exports.ensureSiblingModules(hostReq), true, 'ensureSiblingModules 应返回 true');

  const video = registry['./canvas-video.js'];
  const payload = video.buildVideoPayload({ model: 'MiniMax-H3', prompt: 'p' });
  assert.ok(payload && typeof payload === 'object', 'buildVideoPayload 应产出合法 payload');
  assert.ok(payload.model !== undefined && payload.prompt !== undefined, 'payload 应含 model 与 prompt');

  const math = registry['./canvas-math.js'];
  assert.equal(math.snapToGrid(17, 8), 16, 'CanvasMathUtils.snapToGrid 应可用');

  // canvas-project-store 的惰性 storage 依赖：优先从打包表取，无需相对 require
  const Store = registry['./canvas-project-store.js'].CanvasProjectStore;
  assert.equal(typeof Store, 'function');
  assert.equal(typeof Store.prototype.createProject, 'function', 'createProject 方法应保留（R1 签名）');

  // 忠实宿主：相对 require 必抛宿主原文错误
  assert.throws(() => hostReq('./canvas-video.js'), new RegExp(HOST_RELATIVE_ERROR));
});

// 用例 2：打包表中缺失 canvas-video.js，且宿主 require 对相对路径抛原文错误 → 带原因文案 + console.error
test('noload-factory - 打包表缺 canvas-video.js 且宿主报错时返回带原因文案并记录错误', () => {
  const bundled = makeBundledTable({ overrides: { './canvas-video.js': '__THROW__' } });
  const hostReq = makeHostRequire({ seedValues: { react: makeTestReact() } });
  const consoleErrors = [];
  const { exports } = loadClientInVm({ bundled, factoryRequire: hostReq, consoleErrors });

  const msg = exports.getCanvasVideoUnavailableError();
  assert.ok(msg.startsWith(exports.VIDEO_MODULE_LOAD_ERROR_MSG));
  assert.match(msg, new RegExp(`（原因：.*${HOST_RELATIVE_ERROR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}）`));
  assert.ok(consoleErrors.length >= 1, '加载失败时应调用 console.error 至少一次');
});

// 用例 3：打包表缺非视频模块（canvas-storage.js）→ formatSiblingLoadError 文案含模块 id 与原因
test('noload-factory - 打包表缺非视频模块时 formatSiblingLoadError 文案含模块 id 与原因', () => {
  const bundled = makeBundledTable({ overrides: { './canvas-storage.js': '__THROW__' } });
  const hostReq = makeHostRequire({ seedValues: { react: makeTestReact() } });
  const { exports } = loadClientInVm({ bundled, factoryRequire: hostReq });

  const result = exports.loadSiblingModules(hostReq, { force: true });
  assert.equal(result.errors.get('./canvas-storage.js') instanceof Error, true);
  const text = exports.formatSiblingLoadError('./canvas-storage.js', result.errors.get('./canvas-storage.js'));
  assert.ok(text.includes('canvas-storage.js'), '文案应含模块 id');
  assert.ok(text.includes(HOST_RELATIVE_ERROR), '文案应含宿主原文原因');
  assert.ok(text.startsWith('画布组件加载失败'), '文案应有通用前缀');
});

// 用例 4：canvas-reactflow.js 在打包表 + hydrate 下组件可用（React 由 seed 注入，不再走相对 require）
test('noload-factory - canvas-reactflow.js 打包表 hydrate 后组件可用', () => {
  const code = fs.readFileSync(REACTFLOW_PATH, 'utf8');
  const mod = { exports: {} };
  const testReact = makeTestReact();
  const bundled = makeBundledTable();
  bundled['./vendor/xyflow.factory.cjs'] = () => ({ ReactFlow: 'RF', MiniMap: 'MM', cssText: '.react-flow{}' });
  bundled['react'] = testReact;
  const sandbox = {
    module: mod,
    exports: mod.exports,
    console: { log() {}, warn() {}, error() {} },
    Buffer
  };
  sandbox.__WINETOKEN_BUNDLED_SIBLINGS__ = bundled;
  vm.runInNewContext(code, sandbox, { filename: REACTFLOW_PATH });
  assert.equal(typeof mod.exports.createReactFlowWorkspace, 'function');
  assert.equal(typeof mod.exports.hydrateSiblingModules, 'function');

  const hostReq = makeHostRequire({ seedValues: { react: testReact } });
  assert.equal(mod.exports.hydrateSiblingModules(hostReq), true);
  const ws = mod.exports.createReactFlowWorkspace({ React: testReact });
  assert.equal(typeof ws, 'function', 'hydrate 后 createReactFlowWorkspace 仍可用');
});

// 用例 5：幂等 —— 连续两次 ensureSiblingModules 不重复实例化 canvas-job-queue
test('noload-factory - 连续两次 ensureSiblingModules 不重复取用 canvasJobQueue', () => {
  const bundled = makeBundledTable();
  const hostReq = makeHostRequire({ seedValues: { react: makeTestReact() } });
  const { exports } = loadClientInVm({ bundled, factoryRequire: hostReq });

  assert.equal(exports.ensureSiblingModules(hostReq), true, '首次 ensureSiblingModules 应成功');
  const registry = exports.WT_SIBLING_REGISTRY;
  const firstQueue = registry['./canvas-job-queue.js'].canvasJobQueue;
  assert.ok(firstQueue, '注册表应含 canvasJobQueue 单例');

  assert.equal(exports.ensureSiblingModules(hostReq), true, '第二次 ensureSiblingModules 应成功');
  assert.strictEqual(
    registry['./canvas-job-queue.js'].canvasJobQueue,
    firstQueue,
    '连续调用 ensureSiblingModules 不应重复实例化 canvasJobQueue（惰性单例引用不变）'
  );
});

// 用例 6：静态审计 —— 源码与产物中未引入裸相对 require('./...')
test('noload-factory - 静态审计: client.js / canvas-reactflow.js 无裸 require("./...")，产物存在时亦无残留', () => {
  for (const filePath of [CLIENT_PATH, REACTFLOW_PATH]) {
    const raw = fs.readFileSync(filePath, 'utf8');
    const codeOnly = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const bareRelativeMatches = codeOnly.match(/(?:^|[^\w.])require\s*\(\s*['"]\.\//gm) || [];
    assert.deepEqual(bareRelativeMatches, [], `${path.basename(filePath)} 不应包含裸 require('./...')`);
  }
  if (fs.existsSync(DIST_CLIENT)) {
    const raw = fs.readFileSync(DIST_CLIENT, 'utf8');
    const matches = raw.match(/require\s*\(\s*['"]\.\/[^'"]+['"]\s*\)/g) || [];
    assert.deepEqual(matches, [], 'dist/client.js 不应残留相对 require');
  } else {
    console.log('[skip] dist/client.js 不存在，产物静态审计跳过（下游构建后执行）');
  }
});
