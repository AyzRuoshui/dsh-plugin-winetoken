// -*- coding: utf-8 -*-
/**
 * v2.5.19 忠实 makeRequire 宿主桩（测试用）。
 *
 * 真实 DSH 宿主语义（计划第 7 节，逐字）：
 *  - 同步 require 只认 11 个 seed word、已登记包 id、其他包经 __ModuleLoader__.load
 *    登记的 package factory；
 *  - 任何 './' 相对路径同步 require 必抛，错误文案照抄宿主原文
 *    "missed the module table"；
 *  - window.__ModuleLoader__.load(def) 只登记 def.factory，不提供相对路径解析。
 *
 * 旧"万能 require"桩把 ./canvas-*.js 映射到 src 真实文件，造成"测试全绿、生产全灭"，
 * 本桩废弃该做法：seed 之外只给显式注册的包 id / 模块对象。
 */
'use strict';

// 11 个 seed word（与 scripts/build-client.cjs 的 SEED_WORDS 一致）
const SEED_WORDS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  'zod',
  '@tanstack/react-virtual',
  '@deepseek-ai/agent-client-store',
  '@deepseek-ai/agent-client-ui-slots',
  '@deepseek-ai/agent-client-ui-primitives',
  '@deepseek-ai/agent-client-ui-dockkit'
];

const HOST_RELATIVE_ERROR = "missed the module table";

/**
 * 创建一个忠实宿主 makeRequire。
 * @param {object} opts
 *   - seedValues: {id: value} 覆盖 seed word 的返回值（如 react 用测试桩）
 *   - packages:   {id: value|factory} 已登记的包 id
 */
function makeHostRequire(opts = {}) {
  const seedValues = Object.assign({}, opts.seedValues || {});
  const packages = Object.assign({}, opts.packages || {});
  const requested = [];
  const missing = [];

  function hostRequire(id) {
    requested.push(id);
    if (typeof id === 'string' && id.startsWith('./')) {
      const err = new Error(`Cannot find module '${id}': ${HOST_RELATIVE_ERROR}`);
      err.code = 'MODULE_TABLE_MISS';
      missing.push({ id, error: err });
      throw err;
    }
    if (Object.prototype.hasOwnProperty.call(seedValues, id)) return seedValues[id];
    if (SEED_WORDS.includes(id)) {
      // 未显式提供 seed 值时，尝试 Node 真实加载（react 等 devDependency 在仓库内存在）
      try { return realRequire(id); } catch (_) { return null; }
    }
    if (Object.prototype.hasOwnProperty.call(packages, id)) {
      const v = packages[id];
      return typeof v === 'function' ? v(hostRequire) : v;
    }
    const err = new Error(`Cannot find module '${id}': ${HOST_RELATIVE_ERROR}`);
    err.code = 'MODULE_TABLE_MISS';
    return (() => { throw err; })();
  }

  hostRequire.requested = requested;
  hostRequire.missing = missing;
  return hostRequire;
}

// 延迟捕获 Node 的真实 require，避免本文件被打包进 web bundle（它只供 tests 使用）。
const realRequire = eval('require');

module.exports = {
  SEED_WORDS,
  HOST_RELATIVE_ERROR,
  makeHostRequire
};
