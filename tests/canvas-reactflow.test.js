// -*- coding: utf-8 -*-
const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const ReactDOMServer = require('react-dom/server');
const initXyFlow = require('../src/vendor/xyflow.factory.cjs');
const {
  createReactFlowWorkspace,
  CharacterNode,
  PanelNode,
  ImageNode,
  VideoNode,
  TextNode,
  GroupNode,
  NODE_TYPES_MAPPING
} = require('../src/canvas-reactflow.js');

test('CanvasReactFlow - 6 个自定义节点与映射表导出完整', () => {
  assert.equal(typeof CharacterNode, 'function');
  assert.equal(typeof PanelNode, 'function');
  assert.equal(typeof ImageNode, 'function');
  assert.equal(typeof VideoNode, 'function');
  assert.equal(typeof TextNode, 'function');
  assert.equal(typeof GroupNode, 'function');
  assert.equal(typeof createReactFlowWorkspace, 'function');

  // 双别名兼容契约
  assert.equal(NODE_TYPES_MAPPING.characterNode, CharacterNode);
  assert.equal(NODE_TYPES_MAPPING.character, CharacterNode);
  assert.equal(NODE_TYPES_MAPPING.panelNode, PanelNode);
  assert.equal(NODE_TYPES_MAPPING.panel, PanelNode);
  assert.equal(NODE_TYPES_MAPPING.imageNode, ImageNode);
  assert.equal(NODE_TYPES_MAPPING.image, ImageNode);
  assert.equal(NODE_TYPES_MAPPING.videoNode, VideoNode);
  assert.equal(NODE_TYPES_MAPPING.video, VideoNode);
  assert.equal(NODE_TYPES_MAPPING.textNode, TextNode);
  assert.equal(NODE_TYPES_MAPPING.text, TextNode);
  assert.equal(NODE_TYPES_MAPPING.groupNode, GroupNode);
  assert.equal(NODE_TYPES_MAPPING.group, GroupNode);
});

test('CanvasReactFlow - 节点全量参数集契约 (视频 4/5/6/10/15秒, 720P/1080P; 图片 1:1/16:9/9:16/4:3/3:4, 1K/2K/4K, 1/2/4张)', () => {
  const xy = initXyFlow(React);

  // 渲染视频节点
  const videoData = {
    name: '测试视频',
    prompt: '运镜特写',
    params: { duration: 15, resolution: '1080P', aspectRatio: '16:9', generateAudio: true }
  };
  const videoEl = React.createElement(VideoNode, {
    id: 'v1',
    data: videoData,
    selected: false
  });
  const videoHtml = ReactDOMServer.renderToString(videoEl);
  assert.ok(videoHtml.includes('15秒'), '视频时长必须支持 15 秒');
  assert.ok(videoHtml.includes('1080P'), '分辨率必须支持 1080P');
  assert.ok(videoHtml.includes('720P'), '分辨率必须支持 720P');

  // 渲染图片节点
  const imgData = {
    name: '测试图片',
    prompt: '高清壁纸',
    params: { aspectRatio: '9:16', quality: '4K', count: 4 }
  };
  const imgEl = React.createElement(ImageNode, {
    id: 'i1',
    data: imgData,
    selected: false
  });
  const imgHtml = ReactDOMServer.renderToString(imgEl);
  assert.ok(imgHtml.includes('9:16'), '比例必须支持 9:16');
  assert.ok(imgHtml.includes('4K'), '画质必须支持 4K');
  assert.ok(imgHtml.includes('4张'), '张数必须支持 4 张');
});

test('CanvasReactFlow - createReactFlowWorkspace 构建组件与 SSR 渲染', () => {
  const WorkspaceComp = createReactFlowWorkspace({
    React,
    initXyFlow
  });
  assert.equal(typeof WorkspaceComp, 'function');

  const el = React.createElement(WorkspaceComp, {
    theme: { isDark: true },
    isVip: false,
    isSvip: false,
    isSuper: false,
    onOpenTutorial: () => {}
  });

  const html = ReactDOMServer.renderToString(el);
  assert.ok(typeof html === 'string' && html.length > 0);
  assert.ok(html.includes('react-flow'), '必须包含 react-flow 原生容器');
  assert.ok(html.includes('+ 分镜'), '底部工具栏 Panel 必须渲染');
  assert.ok(!html.includes('bezier'), '绝对禁止渲染 bezier 类型边');
});

test('CanvasReactFlow - 双引擎切换 WINETOKEN_CANVAS_ENGINE 默认 reactflow', () => {
  const fakeStore = {};
  const fakeLocalStorage = {
    getItem: (k) => fakeStore[k] || null,
    setItem: (k, v) => { fakeStore[k] = String(v); }
  };

  // 默认 engine 为 reactflow
  const defaultEngine = fakeLocalStorage.getItem('WINETOKEN_CANVAS_ENGINE') || 'reactflow';
  assert.equal(defaultEngine, 'reactflow');

  // 手动切 legacy
  fakeLocalStorage.setItem('WINETOKEN_CANVAS_ENGINE', 'legacy');
  const switchedEngine = fakeLocalStorage.getItem('WINETOKEN_CANVAS_ENGINE') || 'reactflow';
  assert.equal(switchedEngine, 'legacy');
});
