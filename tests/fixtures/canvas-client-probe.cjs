// -*- coding: utf-8 -*-
/**
 * 隔离探针: 用最小 DSH 宿主桩加载 src/client.js，验证工厂注册无异常。
 * 由 tests/canvas-integration.test.js 以 `node -I` 子进程方式调用。
 * 脚本最后强制 process.exit(0)，因为 client.js 顶层的宿主轮询定时器不会自行退出。
 */
const path = require('path');

const store = new Map();
const localStorageStub = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k)
};

const documentStub = {
  getElementById: () => null,
  createElement: () => ({ style: {}, appendChild() {}, set textContent(v) {}, get textContent() { return ''; } }),
  head: { appendChild() {} },
  addEventListener() {}, removeEventListener() {}
};

let captured = null;
global.window = {
  __ModuleLoader__: {
    load(opts) {
      captured = opts;
    }
  },
  addEventListener() {}, removeEventListener() {},
  localStorage: localStorageStub
};
global.document = documentStub;
global.localStorage = localStorageStub;

try {
  require(path.join(__dirname, '..', '..', 'src', 'client.js'));
  if (!captured || typeof captured.factory !== 'function') {
    console.log('PROBE_FAIL: ModuleLoader 未收到合法注册');
    process.exit(1);
  }
  // 仅验证 factory 可被调用并构建插件闭包，不渲染真实 React 树
  const fakeRequire = (name) => {
    if (name === 'react') {
      return {
        createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
        useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
        useRef: (v) => ({ current: v }),
        useEffect: () => {}, useMemo: (fn) => fn(), useCallback: (fn) => fn,
        memo: (c) => c, Fragment: 'fragment'
      };
    }
    if (['path', 'os', 'fs', 'child_process', 'yaml'].includes(name)) return require(name);
    return new Proxy({}, {
      get: (t, k) => (k === 'then' ? undefined : (typeof t[k] === 'undefined' ? (() => {}) : t[k])),
      apply: () => undefined
    });
  };
  let plugin;
  try {
    plugin = captured.factory(fakeRequire);
  } catch (err) {
    console.log('PROBE_FAIL: factory 抛错 ' + err.message);
    process.exit(1);
  }
  if (!plugin) {
    console.log('PROBE_FAIL: factory 未返回插件定义');
    process.exit(1);
  }
  // 阶段三: 宿主侧三个新模块必须可被同一份 require 解析 (零依赖、无副作用)
  for (const mod of ['canvas-state.js', 'canvas-video.js', 'canvas-prompts.js', 'canvas-nodes.js']) {
    try {
      const loaded = require(path.join(__dirname, '..', '..', 'src', mod));
      if (!loaded || typeof loaded !== 'object') {
        console.log('PROBE_FAIL: 模块未导出对象 ' + mod);
        process.exit(1);
      }
    } catch (err) {
      console.log('PROBE_FAIL: 模块加载抛错 ' + mod + ' ' + err.message);
      process.exit(1);
    }
  }
  console.log('PROBE_OK ' + captured.id + ' STAGE3_MODULES_OK');
} catch (err) {
  console.log('PROBE_FAIL: 加载 client.js 抛错 ' + err.message);
  process.exit(1);
}
process.exit(0);
