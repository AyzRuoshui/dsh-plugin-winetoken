// -*- coding: utf-8 -*-
// v2.5.18 第三部分：无模块加载器环境下 factory 注入 require 加载 sibling 的回归测试
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const CLIENT_PATH = path.resolve(__dirname, '..', 'src', 'client.js');
const REACTFLOW_PATH = path.resolve(__dirname, '..', 'src', 'canvas-reactflow.js');
const SRC_DIR = path.resolve(__dirname, '..', 'src');
const realRequire = require;

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

// 把真实 require 绑定到 src/ 目录：'react' 走 realRequire，'./canvas-*.js' 走 src/ 下真实模块
function makeFactoryRequire({ overrides = {} } = {}) {
  return function fakeRequire(id) {
    if (Object.prototype.hasOwnProperty.call(overrides, id)) {
      const v = overrides[id];
      if (v === '__THROW__') throw new Error(`Cannot find module '${id}'`);
      return v;
    }
    if (id === 'react') return realRequire('react');
    if (id.startsWith('./') && id.endsWith('.js')) {
      return realRequire(path.join(SRC_DIR, id));
    }
    if (id === './vendor/xyflow.factory.cjs') {
      return realRequire(path.join(SRC_DIR, 'vendor', 'xyflow.factory.cjs'));
    }
    return realRequire(id);
  };
}

// 在完全无 global require、无 window.require 的沙箱里加载 client.js，
// 并让 window.__ModuleLoader__.load(def) 同步调用 def.factory(fakeRequire)。
function loadClientViaFactory({ factoryRequire, collect = [], consoleErrors = [] } = {}) {
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
  const windowObj = {
    __ModuleLoader__: {
      load(def) {
        collect.push(def);
        def.factory(factoryRequire);
      }
    }
  };
  sandbox.window = windowObj;
  vm.runInNewContext(code, sandbox, { filename: CLIENT_PATH });
  return { exports: mod.exports, sandbox, windowObj };
}

// 用例 1【硬性必测】：无全局 require、无 window.require，仅 factory 注入 require，sibling 可加载并可用
test('noload-factory - 无 require 环境下 factory 注入 require 后 12 个 sibling 全部加载可用', () => {
  const factoryRequire = makeFactoryRequire();
  const regs = [];
  const { exports } = loadClientViaFactory({ factoryRequire, collect: regs });

  assert.ok(regs.length === 1 && typeof regs[0].factory === 'function', 'ModuleLoader.load 应注册一个带 factory 的定义');
  assert.equal(exports.getCanvasVideoUnavailableError(), '', 'factory 加载后视频组件应判定可用');

  const registry = exports.WT_SIBLING_REGISTRY;
  assert.ok(registry, '应导出 WT_SIBLING_REGISTRY');
  for (const id of EXPECTED_SIBLINGS) {
    assert.ok(registry[id] != null, `注册表应含 ${id}`);
  }

  assert.equal(exports.ensureSiblingModules(factoryRequire), true, 'ensureSiblingModules 应返回 true');

  const video = registry['./canvas-video.js'];
  const payload = video.buildVideoPayload({ model: 'MiniMax-H3', prompt: 'p' });
  assert.ok(payload && typeof payload === 'object', 'buildVideoPayload 应产出合法 payload');
  assert.ok(payload.model !== undefined && payload.prompt !== undefined, 'payload 应含 model 与 prompt');

  const math = registry['./canvas-math.js'];
  assert.equal(math.snapToGrid(17, 8), 16, 'CanvasMathUtils.snapToGrid 应可用');

  // canvas-project-store 的惰性 require('./canvas-storage.js') 在 factory CJS require 下自然解析
  const Store = registry['./canvas-project-store.js'].CanvasProjectStore;
  assert.equal(typeof Store, 'function');
  assert.ok(realRequire(path.join(SRC_DIR, 'canvas-storage.js')).CanvasProjectStorage, '惰性 storage 依赖应可解析');
});

// 用例 2：factory require 对 ./canvas-video.js 抛错 → 带原因文案，且 console.error 被调用
test('noload-factory - factory require 对 canvas-video.js 抛错时返回带原因文案并记录错误', () => {
  const factoryRequire = makeFactoryRequire({ overrides: { './canvas-video.js': '__THROW__' } });
  const consoleErrors = [];
  const { exports } = loadClientViaFactory({ factoryRequire, consoleErrors });

  const msg = exports.getCanvasVideoUnavailableError();
  assert.ok(msg.startsWith(exports.VIDEO_MODULE_LOAD_ERROR_MSG));
  assert.match(msg, /（原因：Cannot find module '\.\/canvas-video\.js'）/);
  assert.ok(consoleErrors.length >= 1, '加载失败时应调用 console.error 至少一次');
});

// 用例 3：非视频模块（canvas-storage.js）抛错 → formatSiblingLoadError 文案含模块 id 与原因
test('noload-factory - 非视频模块加载失败时 formatSiblingLoadError 文案含模块 id 与原因', () => {
  const factoryRequire = makeFactoryRequire({ overrides: { './canvas-storage.js': '__THROW__' } });
  const { exports } = loadClientViaFactory({ factoryRequire });

  const result = exports.loadSiblingModules(factoryRequire, { force: true });
  assert.equal(result.errors.get('./canvas-storage.js') instanceof Error, true);
  const text = exports.formatSiblingLoadError('./canvas-storage.js', result.errors.get('./canvas-storage.js'));
  assert.ok(text.includes('canvas-storage.js'), '文案应含模块 id');
  assert.ok(text.includes("Cannot find module './canvas-storage.js'"), '文案应含原因');
  assert.ok(text.startsWith('画布组件加载失败'), '文案应有通用前缀');
});

// 用例 4：canvas-reactflow.js 仅由 factory require 加载，hydrate 后 CanvasVideoUtils 非 null
test('noload-factory - canvas-reactflow.js 仅 factory require 加载时 hydrate 后组件可用', () => {
  const code = fs.readFileSync(REACTFLOW_PATH, 'utf8');
  const mod = { exports: {} };
  const sandbox = {
    module: mod,
    exports: mod.exports,
    console: { log() {}, warn() {}, error() {} },
    Buffer
  };
  // 无 global require、无 window.require：三级链全部落空，顶层绑定为 null
  vm.runInNewContext(code, sandbox, { filename: REACTFLOW_PATH });
  assert.equal(typeof mod.exports.createReactFlowWorkspace, 'function');
  assert.equal(typeof mod.exports.hydrateSiblingModules, 'function');

  const factoryRequire = makeFactoryRequire();
  assert.equal(mod.exports.hydrateSiblingModules(factoryRequire), true);
  const ws = mod.exports.createReactFlowWorkspace({});
  assert.equal(typeof ws, 'function', 'hydrate 后 createReactFlowWorkspace 仍可用');
});

// 用例 5：幂等 —— 连续两次 ensureSiblingModules 不重复实例化 canvas-job-queue
test('noload-factory - 连续两次 ensureSiblingModules 不重复实例化 canvasJobQueue', () => {
  // 在全新 vm 上下文中独立验证：计数桩只挂在 './canvas-job-queue.js' 上，
  // 且两次 ensureSiblingModules 都显式传入同一个 factory require，
  // 不依赖 ModuleLoader 注册回调的加载副作用（同文件前序用例会共享 node:test 进程，
  // 依赖注册回调会让计数口径随执行顺序漂移）。
  const code = fs.readFileSync(CLIENT_PATH, 'utf8');
  const mod = { exports: {} };
  const sandbox = {
    module: mod,
    exports: mod.exports,
    console: { log() {}, warn() {}, error() {} },
    setInterval: () => ({ unref() {} }),
    clearInterval: () => {},
    setTimeout: () => ({ unref() {} }),
    clearTimeout: () => {},
    Buffer
  };
  // 提供 window 但不提供 __ModuleLoader__，避免注册回调在断言前偷偷触发加载；
  // 无 global require、无 window.require：顶层 require 链全部落空，注册表保持空
  sandbox.window = {};
  vm.runInNewContext(code, sandbox, { filename: CLIENT_PATH });
  const exports = mod.exports;

  let jobQueueRequireCount = 0;
  const realJobQueue = realRequire(path.join(SRC_DIR, 'canvas-job-queue.js'));
  // 注意：makeFactoryRequire 的 overrides 值是「直接返回」的模块对象，不会作为函数被调用；
  // 计数桩必须包在 require 外层，否则计数永远是 0（这正是原用例的失败根因）。
  const baseFactoryRequire = makeFactoryRequire();
  const factoryRequire = (id) => {
    if (id === './canvas-job-queue.js') {
      jobQueueRequireCount++;
      return realJobQueue;
    }
    return baseFactoryRequire(id);
  };

  // 全新上下文、空注册表：第一次 ensure 应恰好加载一次
  assert.equal(exports.ensureSiblingModules(factoryRequire), true, '首次 ensureSiblingModules 应成功');
  assert.equal(jobQueueRequireCount, 1, '首次 ensureSiblingModules 应 require canvas-job-queue 一次');
  const registry = exports.WT_SIBLING_REGISTRY;
  assert.strictEqual(
    registry['./canvas-job-queue.js'],
    realJobQueue,
    '注册表中的 canvasJobQueue 应为计数桩返回的单例'
  );

  // 第二次 ensure：注册表命中短路，不应再次 require / 实例化
  assert.equal(exports.ensureSiblingModules(factoryRequire), true, '第二次 ensureSiblingModules 应成功');
  assert.equal(jobQueueRequireCount, 1, '连续调用 ensureSiblingModules 不应重复 require/实例化 canvasJobQueue');
  assert.strictEqual(
    registry['./canvas-job-queue.js'],
    realJobQueue,
    '重复 ensure 后 canvasJobQueue 单例引用应保持不变'
  );
});

// 用例 6：静态审计 —— 新代码未重新引入裸 require('./...')
test('noload-factory - 静态审计: client.js 与 canvas-reactflow.js 无裸 require("./...")', () => {
  for (const filePath of [CLIENT_PATH, REACTFLOW_PATH]) {
    const raw = fs.readFileSync(filePath, 'utf8');
    const codeOnly = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const bareRelativeMatches = codeOnly.match(/(?:^|[^\w.])require\s*\(\s*['"]\.\//gm) || [];
    assert.deepEqual(bareRelativeMatches, [], `${path.basename(filePath)} 不应包含裸 require('./...')`);
  }
});
