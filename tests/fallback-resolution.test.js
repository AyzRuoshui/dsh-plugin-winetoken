// -*- coding: utf-8 -*-
const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');

const client = require('../src/client.js');
const canvasVideo = require('../src/canvas-video.js');
const { createReactFlowWorkspace } = require('../src/canvas-reactflow.js');

const EXPECTED_LOAD_ERROR_MSG = '视频组件加载失败（canvas-video.js），插件安装不完整，请删除后重新安装插件';

test('resolveFallbackVideoResolution 覆盖 H3 / H3-2K / omni / muse-video / 未知模型并对齐 buildVideoPayload', () => {
  // 1. MiniMax-H3（及其它 minimax） -> 768P
  assert.equal(client.resolveFallbackVideoResolution('MiniMax-H3'), '768P');
  assert.equal(client.resolveFallbackVideoResolution('minimax-h3'), '768P');
  assert.equal(client.resolveFallbackVideoResolution('minimax-hailuo'), '768P');
  assert.equal(
    client.resolveFallbackVideoResolution('MiniMax-H3'),
    canvasVideo.buildVideoPayload({ model: 'MiniMax-H3', prompt: 'p' }).resolution
  );

  // 2. MiniMax-H3-2K -> 2K
  assert.equal(client.resolveFallbackVideoResolution('MiniMax-H3-2K'), '2K');
  assert.equal(client.resolveFallbackVideoResolution('minimax-h3-2k'), '2K');
  assert.equal(
    client.resolveFallbackVideoResolution('MiniMax-H3-2K'),
    canvasVideo.buildVideoPayload({ model: 'MiniMax-H3-2K', prompt: 'p' }).resolution
  );

  // 3. omni-1.2-flash -> 720P
  assert.equal(client.resolveFallbackVideoResolution('omni-1.2-flash'), '720P');
  assert.equal(
    client.resolveFallbackVideoResolution('omni-1.2-flash'),
    canvasVideo.buildVideoPayload({ model: 'omni-1.2-flash', prompt: 'p' }).resolution
  );

  // 4. muse-video -> 720P
  assert.equal(client.resolveFallbackVideoResolution('muse-video'), '720P');
  assert.equal(
    client.resolveFallbackVideoResolution('muse-video'),
    canvasVideo.buildVideoPayload({ model: 'muse-video', prompt: 'p' }).resolution
  );

  // 5. 未知模型 / 空值 -> 720P
  assert.equal(client.resolveFallbackVideoResolution('unknown-video-model'), '720P');
  assert.equal(client.resolveFallbackVideoResolution(''), '720P');
  assert.equal(client.resolveFallbackVideoResolution(null), '720P');
  assert.equal(client.resolveFallbackVideoResolution(undefined), '720P');
});

test('getCanvasVideoUnavailableError 在视频组件不可用时记录错误并返回明确中文提示', () => {
  assert.equal(client.VIDEO_MODULE_LOAD_ERROR_MSG, EXPECTED_LOAD_ERROR_MSG);
  assert.equal(client.getCanvasVideoUnavailableError(canvasVideo, null), '');

  const logged = [];
  const origError = console.error;
  console.error = (...args) => logged.push(args);
  try {
    const errMsg = client.getCanvasVideoUnavailableError(null, new Error('Cannot find module ./canvas-video.js'));
    assert.equal(
      errMsg,
      `${EXPECTED_LOAD_ERROR_MSG}（原因：Cannot find module ./canvas-video.js）`
    );
    assert.equal(logged.length, 1);
    assert.ok(String(logged[0][0]).includes('canvas-video.js'));

    const incompleteMsg = client.getCanvasVideoUnavailableError({}, null);
    assert.equal(incompleteMsg, EXPECTED_LOAD_ERROR_MSG);
    assert.equal(logged.length, 2);
  } finally {
    console.error = origError;
  }
});

function makeStatefulTestReact() {
  const slots = [];
  let cursor = 0;
  return {
    beginRender() { cursor = 0; },
    createElement: React.createElement,
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
    }
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

test('CanvasReactFlow - CanvasVideoUtils 不可用时中止视频生成并给出安装不完整提示', async () => {
  const testReact = makeStatefulTestReact();
  let fetchCalled = 0;
  const WorkspaceComp = createReactFlowWorkspace({
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
      getActiveId: () => 'proj_missing_video_utils',
      loadProject: () => ({
        version: '2.5.1',
        nodes: [{
          id: 'vid_missing',
          type: 'videoNode',
          position: { x: 0, y: 0 },
          data: { name: '测试视频', prompt: '运镜', params: { model: 'MiniMax-H3' } }
        }],
        edges: []
      })
    },
    CanvasVideoUtils: null,
    getKey: () => 'sk-test-key',
    fetchFn: async () => {
      fetchCalled++;
      return { ok: true, json: async () => ({}) };
    }
  });

  const origError = console.error;
  console.error = () => {};
  try {
    testReact.beginRender();
    const tree1 = WorkspaceComp({ theme: { isDark: true } });
    await tree1.props.value.generateNode('vid_missing');
  } finally {
    console.error = origError;
  }

  assert.equal(fetchCalled, 0, '视频组件不可用时绝对不能发送网络请求');
  testReact.beginRender();
  const tree2 = WorkspaceComp({ theme: { isDark: true } });
  const updatedVid = findReactFlowNodesProp(tree2).find((n) => n.id === 'vid_missing');
  assert.equal(updatedVid.data.videoState.status, 'failed');
  assert.equal(updatedVid.data.videoState.error, EXPECTED_LOAD_ERROR_MSG);
});
