// -*- coding: utf-8 -*-
/**
 * v2.5.19 全量打包入口（esbuild bundle 源，不直接发布）。
 *
 * 目标：把 12 个兄弟模块 + canvas-reactflow + xyflow 全部内联进单个自包含
 * dist/client.js，运行时相对 require 归零。做法：
 *   1. 先 require 全部兄弟模块（esbuild 构建期内联，产物中无相对 require 残留）；
 *   2. 构造 globalThis.__WINETOKEN_BUNDLED_SIBLINGS__ 表，键沿用原 './canvas-*.js'
 *      模块 id，消费侧（client.js / canvas-reactflow.js）优先查此表；
 *   3. 最后才 require('./client.js') 触发主逻辑（注册 __ModuleLoader__ factory）。
 *
 * 关键：全部用 CJS require() 且保持源码顺序（不用 ESM import，避免 import 提升
 * 把 client.js 执行提前到建表之前）。esbuild 对字面量 require 调用一律内联。
 *
 * 外部依赖只保留 11 个 seed word（本插件实际用到 react / react-dom）。
 * fs/path/os 由 build-client.cjs 的 onResolve 插件指向空 stub，4 个 fs 兄弟据此走内存垫片。
 * src/vendor/xyflow.factory.cjs 保留为单测 fixture；运行时用 xyflow.entry.js。
 */
const canvasMath = require('./canvas-math.js');
const canvasHistory = require('./canvas-history.js');
const canvasMinimap = require('./canvas-minimap.js');
const canvasNodes = require('./canvas-nodes.js');
const canvasExport = require('./canvas-export.js');
const canvasPrompts = require('./canvas-prompts.js');
const canvasPricing = require('./canvas-pricing.js');
const canvasVideo = require('./canvas-video.js');
const canvasStorage = require('./canvas-storage.js');
const canvasJobQueue = require('./canvas-job-queue.js');
const canvasAssets = require('./canvas-assets.js');
const canvasProjectStore = require('./canvas-project-store.js');
const canvasReactflow = require('./canvas-reactflow.js');
const initXyFlow = require('./vendor/xyflow.entry.js');

// 打包兄弟表：键 = client.js / canvas-reactflow.js 中原本 require 的模块 id。
// 值 = esbuild 内联后的模块对象（CJS module.exports）。
globalThis.__WINETOKEN_BUNDLED_SIBLINGS__ = {
  './canvas-math.js': canvasMath,
  './canvas-history.js': canvasHistory,
  './canvas-minimap.js': canvasMinimap,
  './canvas-nodes.js': canvasNodes,
  './canvas-export.js': canvasExport,
  './canvas-prompts.js': canvasPrompts,
  './canvas-pricing.js': canvasPricing,
  './canvas-video.js': canvasVideo,
  './canvas-storage.js': canvasStorage,
  './canvas-job-queue.js': canvasJobQueue,
  './canvas-assets.js': canvasAssets,
  './canvas-project-store.js': canvasProjectStore,
  './canvas-reactflow.js': canvasReactflow,
  './vendor/xyflow.factory.cjs': initXyFlow
};

// 触发 client.js 主逻辑（IIFE 内向 window.__ModuleLoader__.load 注册 factory）。
// 此时打包表已就绪，client.js 顶层 loadSiblingModules 与 factory 内 ensureSiblingModules
// 都会优先命中表，不再走相对 require。
require('./client.js');
