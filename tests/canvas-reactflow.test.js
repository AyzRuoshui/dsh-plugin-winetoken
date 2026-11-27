// -*- coding: utf-8 -*-
const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const ReactDOMServer = require('react-dom/server');
const initXyFlow = require('../src/vendor/xyflow.factory.cjs');
const {
  createReactFlowWorkspace,
  NodeActionContext,
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

test('CanvasReactFlow - 节点参数按所选模型能力集约束', () => {
  const xy = initXyFlow(React);

  // 渲染视频节点
  const videoData = {
    name: '测试视频',
    prompt: '运镜特写',
    params: { model: 'MiniMax-H3', duration: 15, resolution: '720P', aspectRatio: '16:9', generateAudio: true }
  };
  const videoEl = React.createElement(VideoNode, {
    id: 'v1',
    data: videoData,
    selected: false
  });
  const videoHtml = ReactDOMServer.renderToString(videoEl);
  assert.ok(videoHtml.includes('15秒'), '视频时长必须支持 15 秒');
  assert.ok(videoHtml.includes('720P'), 'H3 必须支持 720P');
  assert.ok(!videoHtml.includes('1080P'), 'H3 不得暴露不支持的 1080P');
  const grokHtml = ReactDOMServer.renderToString(React.createElement(VideoNode, {
    id: 'grok_v1', selected: false, data: { name: 'Grok', params: { model: 'grok-imagine-video-1.5', duration: 5, resolution: '1080P', aspectRatio: '16:9' } }
  }));
  assert.ok(grokHtml.includes('1080P'), '支持 1080P 的 Grok 才能显示该选项');

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

test('CanvasReactFlow - VideoNode 模型选择器、多图序号缩略带与超限提示 (SSR)', () => {
  const CanvasVideoUtils = require('../src/canvas-video.js');
  const models = [
    { id: 'MiniMax-H3', name: 'MiniMax H3', tag: '电影感' },
    { id: 'omni-1.2-flash', name: 'Omni 1.2 Flash', tag: '原生音频' },
    { id: 'muse-video', name: 'Muse Video', tag: '超值' }
  ];

  // 1. Omni 模型接入 4 张图: 仅前 3 张生效，第 4 张标注忽略
  const omniEl = React.createElement(
    NodeActionContext.Provider,
    {
      value: {
        theme: { isDark: true },
        CanvasVideoUtils,
        availableVideoModels: models,
        genContextMap: {
          vid_omni: {
            prompt: '',
            referenceImages: ['https://img/1.png', 'https://img/2.png', 'https://img/3.png', 'https://img/4.png']
          }
        }
      }
    },
    React.createElement(VideoNode, {
      id: 'vid_omni',
      selected: false,
      data: {
        name: 'Omni测试',
        prompt: '人物追逐',
        params: { model: 'omni-1.2-flash', duration: 5, resolution: '720P', aspectRatio: '16:9' }
      }
    })
  );
  const omniHtml = ReactDOMServer.renderToString(omniEl);
  assert.ok(omniHtml.includes('MiniMax H3 [电影感]'), '必须渲染模型下拉选项');
  assert.ok(omniHtml.includes('Omni 1.2 Flash [原生音频]'), '必须包含 Omni 模型选项');
  assert.ok(omniHtml.includes('全能参考 (仅前3/共4图)'), 'Omni 超限角标必须提示仅前3');
  assert.ok(omniHtml.includes('参考图序 (生效 3/4 张)'), '缩略带头必须标注生效 3/4');
  assert.ok(omniHtml.includes('超出上限(3)将忽略'));
  assert.ok(omniHtml.includes('图1') && omniHtml.includes('图2') && omniHtml.includes('图3') && omniHtml.includes('忽略'));

  // 2. Muse 单图模型接入 2 张图: 提示仅用首帧
  const museEl = React.createElement(
    NodeActionContext.Provider,
    {
      value: {
        theme: { isDark: true },
        CanvasVideoUtils,
        availableVideoModels: models,
        genContextMap: {
          vid_muse: { prompt: '', referenceImages: ['https://img/a.png', 'https://img/b.png'] }
        }
      }
    },
    React.createElement(VideoNode, {
      id: 'vid_muse',
      selected: false,
      data: {
        name: 'Muse测试',
        prompt: '微风拂面',
        params: { model: 'muse-video', duration: 5, resolution: '720P', aspectRatio: '16:9' }
      }
    })
  );
  const museHtml = ReactDOMServer.renderToString(museEl);
  assert.ok(museHtml.includes('仅用首帧 (共2图/限1图)'));
  assert.ok(museHtml.includes('超出上限(1)将忽略'));

  // 3. MiniMax-H3 接入 5 张图: 全部在 9 张上限内
  const h3El = React.createElement(
    NodeActionContext.Provider,
    {
      value: {
        theme: { isDark: true },
        CanvasVideoUtils,
        availableVideoModels: models,
        genContextMap: {
          vid_h3: {
            prompt: '',
            referenceImages: ['https://img/1.png', 'https://img/2.png', 'https://img/3.png', 'https://img/4.png', 'https://img/5.png']
          }
        }
      }
    },
    React.createElement(VideoNode, {
      id: 'vid_h3',
      selected: false,
      data: {
        name: 'H3测试',
        prompt: '广角史诗推进',
        params: { model: 'MiniMax-H3', duration: 5, resolution: '720P', aspectRatio: '16:9' }
      }
    })
  );
  const h3Html = ReactDOMServer.renderToString(h3El);
  assert.ok(h3Html.includes('全能参考 (5图)'));
  assert.equal(h3Html.includes('将忽略'), false);
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

test('CanvasReactFlow - generateNode videoNode 真实提交多图参考并回写 videoState (Mock fetch)', async () => {
  const CanvasVideoUtils = require('../src/canvas-video.js');
  const CanvasNodeUtils = require('../src/canvas-nodes.js');
  const testReact = makeStatefulTestReact();
  const calls = [];
  let billingCalls = 0;

  const project = {
    version: '2.5.1',
    nodes: [
      { id: 'img_1', type: 'imageNode', position: { x: 0, y: 0 }, data: { url: 'https://cdn.example/ref1.png' } },
      { id: 'img_2', type: 'imageNode', position: { x: 0, y: 200 }, data: { url: 'https://cdn.example/ref2.png' } },
      { id: 'img_3', type: 'imageNode', position: { x: 0, y: 400 }, data: { url: 'https://cdn.example/ref3.png' } },
      { id: 'img_4', type: 'imageNode', position: { x: 0, y: 600 }, data: { url: 'https://cdn.example/ref4.png' } },
      {
        id: 'vid_1',
        type: 'videoNode',
        position: { x: 380, y: 120 },
        data: {
          name: '多图视频节点',
          prompt: '@[图1] 与 @[图2] 并肩走向 @[图3]',
          url: '',
          videoState: { status: 'idle' },
          params: { model: 'omni-1.2-flash', duration: 5, resolution: '720P', aspectRatio: '16:9', generateAudio: true }
        }
      }
    ],
    edges: [
      { id: 'e1', source: 'img_1', target: 'vid_1', type: 'default' },
      { id: 'e2', source: 'img_2', target: 'vid_1', type: 'default' },
      { id: 'e3', source: 'img_3', target: 'vid_1', type: 'default' },
      { id: 'e4', source: 'img_4', target: 'vid_1', type: 'default' }
    ],
    viewport: { x: 0, y: 0, zoom: 1 }
  };

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
      getActiveId: () => 'proj_test',
      loadProject: () => project,
      saveProject() {}
    },
    CanvasNodeUtils,
    CanvasVideoUtils,
    getKey: () => 'sk-rf-test-key',
    BASE_URL: 'https://relay.example',
    updateBilling: () => { billingCalls += 1; },
    fetchFn: async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        json: async () => ({ url: 'https://cdn.example/rf_multi_out.mp4' })
      };
    }
  });

  testReact.beginRender();
  const tree1 = WorkspaceComp({
    theme: { isDark: true },
    availableVideoModels: [{ id: 'omni-1.2-flash', name: 'Omni 1.2 Flash', tag: '原生音频' }]
  });
  const actions = tree1.props.value;
  assert.equal(actions.genContextMap.vid_1.referenceImages.length, 4);

  await actions.generateNode('vid_1');

  assert.equal(calls.length, 1, '必须发起一次真实视频创建请求');
  assert.equal(calls[0].url, 'https://relay.example/v1/videos');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer sk-rf-test-key');
  const sentBody = JSON.parse(calls[0].init.body);
  assert.equal(sentBody.model, 'omni-1.2-flash');
  assert.equal(sentBody.prompt, '图1 与 图2 并肩走向 图3');
  assert.equal(sentBody.audio, true);
  assert.deepEqual(sentBody.metadata.reference_images, [
    'https://cdn.example/ref1.png',
    'https://cdn.example/ref2.png',
    'https://cdn.example/ref3.png'
  ], 'Omni 画布节点必须只传前 3 张参考图');
  assert.equal('first_frame_image' in sentBody.metadata, false);
  assert.equal('image' in sentBody, false);
  assert.equal(billingCalls, 1);

  testReact.beginRender();
  const tree2 = WorkspaceComp({
    theme: { isDark: true },
    availableVideoModels: [{ id: 'omni-1.2-flash', name: 'Omni 1.2 Flash', tag: '原生音频' }]
  });
  const updatedNodes = findReactFlowNodesProp(tree2);
  const updatedVid = updatedNodes.find((n) => n.id === 'vid_1');
  assert.equal(updatedVid.data.videoState.status, 'succeeded');
  assert.equal(updatedVid.data.videoState.videoUrl, 'https://cdn.example/rf_multi_out.mp4');
  assert.equal(updatedVid.data.url, 'https://cdn.example/rf_multi_out.mp4');
});

test('CanvasReactFlow - 缺少 getKey 等注入时 generateNode 安全降级不崩', async () => {
  const CanvasVideoUtils = require('../src/canvas-video.js');
  const testReact = makeStatefulTestReact();
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
      getActiveId: () => 'proj_downgrade',
      loadProject: () => ({
        version: '2.5.1',
        nodes: [{ id: 'vid_only', type: 'videoNode', position: { x: 0, y: 0 }, data: { name: 'v', prompt: 'p', params: {} } }],
        edges: []
      })
    },
    CanvasVideoUtils
  });

  testReact.beginRender();
  const tree1 = WorkspaceComp({ theme: { isDark: true } });
  await tree1.props.value.generateNode('vid_only');

  testReact.beginRender();
  const tree2 = WorkspaceComp({ theme: { isDark: true } });
  const updatedVid = findReactFlowNodesProp(tree2).find((n) => n.id === 'vid_only');
  assert.equal(updatedVid.data.videoState.status, 'failed');
  assert.match(updatedVid.data.videoState.error, /API Key/);
});

test('CanvasReactFlow - ImageNode 与 PanelNode 模型下拉、参考图缩略带、5张上限与不支持模型提示 (SSR)', () => {
  const CanvasPricingUtils = require('../src/canvas-pricing.js');
  const { validateImageModelSupport } = require('../src/client.js');
  const imageModels = [
    { id: 'sensenova-u1.5-lite', name: '商汤 SenseNova U1.5 Lite', tag: '限免4K', price: 0, vipPrice: 0, singleNOnly: true },
    { id: 'gpt-image-2.6-flare', name: 'GPT-Image 2.6 Flare', tag: '超快极速', price: 0.20, vipPrice: 0.16, singleNOnly: true },
    { id: 'grok-imagine-image-2.0', name: 'Grok Imagine 2.0 旗舰', tag: '创意先锋', price: 0.50, vipPrice: 0.40, singleNOnly: true }
  ];

  // 1. SenseNova 接入 6 张参考图: 仅前 5 张生效，第 6 张标注忽略
  const sixRefs = Array.from({ length: 6 }, (_, i) => `https://img/${i + 1}.png`);
  const imgEditEl = React.createElement(
    NodeActionContext.Provider,
    {
      value: {
        theme: { isDark: true },
        availableImageModels: imageModels,
        validateImageModelSupport,
        genContextMap: {
          img_6: { prompt: '', referenceImages: sixRefs }
        }
      }
    },
    React.createElement(ImageNode, {
      id: 'img_6',
      selected: false,
      data: {
        name: '六图参考测试',
        prompt: '主角换装',
        params: { model: 'sensenova-u1.5-lite', aspectRatio: '16:9', quality: '1K', count: 1 }
      }
    })
  );
  const imgEditHtml = ReactDOMServer.renderToString(imgEditEl);
  assert.ok(imgEditHtml.includes('商汤 SenseNova U1.5 Lite [限免4K]'), '必须渲染图片模型下拉选项');
  assert.ok(imgEditHtml.includes('GPT-Image 2.6 Flare [超快极速]'), '必须包含 GPT-Image 模型选项');
  assert.ok(imgEditHtml.includes('Grok Imagine 2.0 旗舰 [创意先锋]'), '必须包含 Grok 模型选项');
  assert.ok(imgEditHtml.includes('图生图 (仅前5/共6图)'), '超 5 张角标必须提示仅前 5');
  assert.ok(imgEditHtml.includes('参考图序 (生效 5/6 张)'), '缩略带头必须标注生效 5/6');
  assert.ok(imgEditHtml.includes('超出上限(5)将忽略'));
  assert.ok(
    imgEditHtml.includes('图1') && imgEditHtml.includes('图5') && imgEditHtml.includes('忽略'),
    '前 5 张标注图1~图5，第 6 张标注忽略'
  );

  // 2. Grok 不支持参考图: 节点显形拦截提示
  const grokRefEl = React.createElement(
    NodeActionContext.Provider,
    {
      value: {
        theme: { isDark: true },
        availableImageModels: imageModels,
        validateImageModelSupport,
        genContextMap: {
          img_grok: { prompt: '', referenceImages: ['https://img/a.png', 'https://img/b.png'] }
        }
      }
    },
    React.createElement(ImageNode, {
      id: 'img_grok',
      selected: false,
      data: {
        name: 'Grok参考拦截',
        prompt: '测试拦截',
        params: { model: 'grok-imagine-image-2.0', aspectRatio: '1:1', quality: '1K', count: 1 }
      }
    })
  );
  const grokRefHtml = ReactDOMServer.renderToString(grokRefEl);
  assert.ok(grokRefHtml.includes('不支持参考图'));
  assert.ok(grokRefHtml.includes('当前模型不支持垫图改图'));

  // 3. 错误信息展示区: 即使已有旧图 url，也必须显形渲染错误
  const errEl = React.createElement(
    NodeActionContext.Provider,
    { value: { theme: { isDark: true }, availableImageModels: imageModels } },
    React.createElement(ImageNode, {
      id: 'img_err',
      selected: false,
      data: {
        name: '错误显形',
        prompt: 'test',
        url: 'https://img/old.png',
        error: '额度不足',
        params: { model: 'sensenova-u1.5-lite' }
      }
    })
  );
  const errHtml = ReactDOMServer.renderToString(errEl);
  assert.ok(errHtml.includes('生成失败: 额度不足'));

  // 4. PanelNode 模型下拉、价格徽章与参考图缩略带
  const panelEl = React.createElement(
    NodeActionContext.Provider,
    {
      value: {
        theme: { isDark: true },
        CanvasPricingUtils,
        availableImageModels: imageModels,
        validateImageModelSupport,
        genContextMap: {
          panel_1: { prompt: '', referenceImages: ['https://img/p1.png', 'https://img/p2.png'] }
        }
      }
    },
    React.createElement(PanelNode, {
      id: 'panel_1',
      selected: false,
      data: {
        num: 1,
        shotLabel: '特写',
        aspectRatio: '2:3',
        prompt: '剑客拔剑',
        params: { model: 'sensenova-u1.5-lite' }
      }
    })
  );
  const panelHtml = ReactDOMServer.renderToString(panelEl);
  assert.ok(panelHtml.includes('分镜生图模型'));
  assert.ok(panelHtml.includes('[限免 ¥0.00]'), 'PanelNode 价格徽章必须正确渲染');
  assert.ok(panelHtml.includes('图生图 (2图)'));
  assert.ok(panelHtml.includes('参考图序 (生效 2/2 张)'));

  // 5. 缺注入安全降级 (空 Context 渲染不崩且回落默认图片模型清单)
  const fallbackImgHtml = ReactDOMServer.renderToString(
    React.createElement(ImageNode, { id: 'img_fb', selected: false, data: { name: '降级', prompt: 'p' } })
  );
  const fallbackPanelHtml = ReactDOMServer.renderToString(
    React.createElement(PanelNode, { id: 'panel_fb', selected: false, data: { num: 2, prompt: 'p' } })
  );
  assert.ok(fallbackImgHtml.includes('商汤 SenseNova U1.5 Lite [限免4K]'));
  assert.ok(fallbackPanelHtml.includes('商汤 SenseNova U1.5 Lite [限免4K]'));
});

test('CanvasReactFlow - generateNode imageNode 真实提交文生图与带参考图路径并回写节点状态 (Mock fetchFn)', async () => {
  const CanvasNodeUtils = require('../src/canvas-nodes.js');
  const CanvasVideoUtils = require('../src/canvas-video.js');
  const { sendImageRequest, validateImageModelSupport } = require('../src/client.js');
  const testReact = makeStatefulTestReact();
  const calls = [];
  let billingCalls = 0;

  const project = {
    version: '2.5.1',
    nodes: [
      { id: 'txt_style', type: 'textNode', position: { x: 0, y: 0 }, data: { text: '电影光影' } },
      { id: 'ref_1', type: 'imageNode', position: { x: 0, y: 120 }, data: { url: 'https://cdn.example/r1.png' } },
      { id: 'ref_2', type: 'imageNode', position: { x: 0, y: 240 }, data: { url: 'https://cdn.example/r2.png' } },
      { id: 'ref_3', type: 'imageNode', position: { x: 0, y: 360 }, data: { url: 'https://cdn.example/r3.png' } },
      { id: 'ref_4', type: 'imageNode', position: { x: 0, y: 480 }, data: { url: 'https://cdn.example/r4.png' } },
      { id: 'ref_5', type: 'imageNode', position: { x: 0, y: 600 }, data: { url: 'asset:ref_5.png' } },
      { id: 'ref_6', type: 'imageNode', position: { x: 0, y: 720 }, data: { url: 'https://cdn.example/r6.png' } },
      {
        id: 'img_t2i',
        type: 'imageNode',
        position: { x: 360, y: 0 },
        data: {
          name: '文生图节点',
          prompt: '赛博少女',
          url: '',
          generating: false,
          params: { model: 'sensenova-u1.5-lite', aspectRatio: '16:9', quality: '2K', count: 1 }
        }
      },
      {
        id: 'img_i2i',
        type: 'image',
        position: { x: 360, y: 260 },
        data: {
          name: '图生图节点',
          prompt: '保留角色',
          url: '',
          generating: false,
          params: { model: 'sensenova-u1.5-lite', aspectRatio: '1:1', quality: '1K', count: 1 }
        }
      },
      {
        id: 'img_gpt',
        type: 'imageNode',
        position: { x: 360, y: 520 },
        data: {
          name: 'GPT垫图',
          prompt: '油画重绘',
          url: '',
          generating: false,
          params: { model: 'gpt-image-2.6-flare', aspectRatio: '4:3', quality: '1K', count: 1 }
        }
      },
      {
        id: 'img_grok_ref',
        type: 'imageNode',
        position: { x: 360, y: 760 },
        data: {
          name: '不支持参考图',
          prompt: '拦截测试',
          url: '',
          generating: false,
          params: { model: 'grok-imagine-image-2.0', aspectRatio: '1:1', quality: '1K', count: 1 }
        }
      }
    ],
    edges: [
      { id: 'e_t2i_1', source: 'txt_style', target: 'img_t2i', type: 'default' },
      { id: 'e_i2i_1', source: 'ref_1', target: 'img_i2i', type: 'default' },
      { id: 'e_i2i_2', source: 'ref_2', target: 'img_i2i', type: 'default' },
      { id: 'e_i2i_3', source: 'ref_3', target: 'img_i2i', type: 'default' },
      { id: 'e_i2i_4', source: 'ref_4', target: 'img_i2i', type: 'default' },
      { id: 'e_i2i_5', source: 'ref_5', target: 'img_i2i', type: 'default' },
      { id: 'e_i2i_6', source: 'ref_6', target: 'img_i2i', type: 'default' },
      { id: 'e_gpt_1', source: 'ref_1', target: 'img_gpt', type: 'default' },
      { id: 'e_gpt_2', source: 'ref_2', target: 'img_gpt', type: 'default' },
      { id: 'e_grok_1', source: 'ref_1', target: 'img_grok_ref', type: 'default' }
    ],
    viewport: { x: 0, y: 0, zoom: 1 }
  };

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
      getActiveId: () => 'proj_img_test',
      loadProject: () => project,
      saveProject() {}
    },
    canvasAssetsDriver: {
      readAsDataUrl: (key) => (key === 'ref_5.png' ? 'data:image/png;base64,AAAA' : ''),
      saveDataUrl: () => ({ assetKey: 'saved_out.png' })
    },
    CanvasNodeUtils,
    CanvasVideoUtils,
    sendImageRequest,
    validateImageModelSupport,
    getKey: () => 'sk-rf-img-key',
    BASE_URL: 'https://relay.example',
    updateBilling: () => { billingCalls += 1; },
    fetchFn: async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        json: async () => ({ data: [{ url: `https://cdn.example/out_${calls.length}.png` }] })
      };
    }
  });

  // 1. 纯文生图路径 -> /v1/images/generations
  testReact.beginRender();
  const tree1 = WorkspaceComp({ theme: { isDark: true } });
  await tree1.props.value.generateNode('img_t2i');

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://relay.example/v1/images/generations');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer sk-rf-img-key');
  const t2iBody = JSON.parse(calls[0].init.body);
  assert.equal(t2iBody.model, 'sensenova-u1.5-lite');
  assert.equal(t2iBody.prompt, '赛博少女，电影光影');
  assert.equal(t2iBody.size, '1792x1024');
  assert.equal(t2iBody.n, 1);
  assert.equal(t2iBody.images, undefined, '文生图绝不能携带 images 字段');
  assert.equal(billingCalls, 1);

  // 2. 带参考图路径 (SenseNova JSON edits, 6 张截断至前 5 张且解码 asset:) -> /v1/images/edits
  testReact.beginRender();
  const tree2 = WorkspaceComp({ theme: { isDark: true } });
  await tree2.props.value.generateNode('img_i2i');

  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, 'https://relay.example/v1/images/edits');
  const i2iBody = JSON.parse(calls[1].init.body);
  assert.equal(i2iBody.model, 'sensenova-u1.5-lite');
  assert.equal(i2iBody.size, '1024x1024');
  assert.equal(i2iBody.watermark, false);
  assert.deepEqual(i2iBody.images, [
    { image_url: 'https://cdn.example/r1.png' },
    { image_url: 'https://cdn.example/r2.png' },
    { image_url: 'https://cdn.example/r3.png' },
    { image_url: 'https://cdn.example/r4.png' },
    { image_url: 'data:image/png;base64,AAAA' }
  ], '带参考图必须走 edits 且严格按顺序截断至前 5 张并解析 asset:');
  assert.equal(billingCalls, 2);

  // 3. GPT-Image multipart/form-data edits 路径
  testReact.beginRender();
  const tree3 = WorkspaceComp({ theme: { isDark: true } });
  await tree3.props.value.generateNode('img_gpt');

  assert.equal(calls.length, 3);
  assert.equal(calls[2].url, 'https://relay.example/v1/images/edits');
  assert.ok(calls[2].init.body instanceof FormData, 'gpt-image 垫图必须走 FormData');
  assert.equal(calls[2].init.body.get('model'), 'gpt-image-2.6-flare');
  assert.equal(calls[2].init.body.get('size'), '1344x1008');
  assert.deepEqual(calls[2].init.body.getAll('image_url'), [
    'https://cdn.example/r1.png',
    'https://cdn.example/r2.png'
  ]);
  assert.equal(billingCalls, 3);

  // 4. 不支持参考图的模型前置拦截，不发请求并在节点显形错误
  testReact.beginRender();
  const tree4 = WorkspaceComp({ theme: { isDark: true } });
  await tree4.props.value.generateNode('img_grok_ref');

  assert.equal(calls.length, 3, '不支持参考图的模型不得发包');
  assert.equal(billingCalls, 3);

  testReact.beginRender();
  const tree5 = WorkspaceComp({ theme: { isDark: true } });
  const updatedNodes = findReactFlowNodesProp(tree5);
  const outT2i = updatedNodes.find((n) => n.id === 'img_t2i');
  const outI2i = updatedNodes.find((n) => n.id === 'img_i2i');
  const outGrok = updatedNodes.find((n) => n.id === 'img_grok_ref');

  assert.equal(outT2i.data.generating, false);
  assert.equal(outT2i.data.url, 'https://cdn.example/out_1.png');
  assert.equal(outT2i.data.imageState.status, 'succeeded');
  assert.equal(outT2i.data.error, '');

  assert.equal(outI2i.data.generating, false);
  assert.equal(outI2i.data.url, 'https://cdn.example/out_2.png');
  assert.equal(outI2i.data.imageState.status, 'succeeded');

  assert.equal(outGrok.data.generating, false);
  assert.equal(outGrok.data.imageState.status, 'failed');
  assert.match(outGrok.data.error, /不支持参考图输入|不支持垫图改图/);
});

test('CanvasReactFlow - generateNode panelNode 真实提交 (角色参考图 + 失败显形 + sendImageRequest 替身)', async () => {
  const CanvasNodeUtils = require('../src/canvas-nodes.js');
  const CanvasVideoUtils = require('../src/canvas-video.js');
  const { validateImageModelSupport } = require('../src/client.js');
  const testReact = makeStatefulTestReact();
  const reqCalls = [];
  let billingCalls = 0;
  let shouldFail = false;

  const project = {
    version: '2.5.1',
    nodes: [
      { id: 'char_1', type: 'characterNode', position: { x: 0, y: 0 }, data: { name: '楚云', dna: '银发剑客', avatar: 'https://cdn.example/chuyun.png' } },
      { id: 'txt_1', type: 'textNode', position: { x: 0, y: 220 }, data: { text: '雨夜拔剑' } },
      {
        id: 'shot_ok',
        type: 'panelNode',
        position: { x: 320, y: 40 },
        data: {
          num: 1,
          prompt: '特写眼神',
          characterId: 'char_1',
          aspectRatio: '2:3',
          imageUrl: '',
          candidates: [],
          isGenerating: false,
          params: { model: 'sensenova-u1.5-lite' }
        }
      },
      {
        id: 'shot_fail',
        type: 'panel',
        position: { x: 320, y: 420 },
        data: {
          num: 2,
          prompt: '街景空镜',
          aspectRatio: '16:9',
          imageUrl: '',
          candidates: [],
          isGenerating: false,
          params: { model: 'sensenova-u1.5-lite' }
        }
      }
    ],
    edges: [
      { id: 'e_txt_shot', source: 'txt_1', target: 'shot_ok', type: 'default' }
    ],
    viewport: { x: 0, y: 0, zoom: 1 }
  };

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
      getActiveId: () => 'proj_panel_test',
      loadProject: () => project,
      saveProject() {}
    },
    canvasAssetsDriver: {
      saveDataUrl: () => ({ assetKey: 'panel_saved_1.png' })
    },
    CanvasNodeUtils,
    CanvasVideoUtils,
    validateImageModelSupport,
    getKey: () => 'sk-rf-panel-key',
    BASE_URL: 'https://relay.example',
    updateBilling: () => { billingCalls += 1; },
    sendImageRequest: async (args) => {
      reqCalls.push(args);
      if (shouldFail) {
        throw new Error('上游网关 502 超时');
      }
      return { data: [{ b64_json: 'QUJDRA==' }] };
    }
  });

  // 1. panelNode 成功提交 (合并角色 DNA + 上游文本 + 角色定妆照参考图, b64 落盘为 asset:)
  testReact.beginRender();
  const tree1 = WorkspaceComp({ theme: { isDark: true } });
  await tree1.props.value.generateNode('shot_ok');

  assert.equal(reqCalls.length, 1);
  assert.equal(reqCalls[0].baseUrl, 'https://relay.example');
  assert.equal(reqCalls[0].apiKey, 'sk-rf-panel-key');
  assert.equal(reqCalls[0].model, 'sensenova-u1.5-lite');
  assert.equal(reqCalls[0].size, '1024x1536');
  assert.equal(reqCalls[0].prompt, '银发剑客，特写眼神，雨夜拔剑');
  assert.equal(reqCalls[0].referenceSlots.length, 1);
  assert.equal(reqCalls[0].referenceSlots[0].dataUrl, 'https://cdn.example/chuyun.png');
  assert.equal(billingCalls, 1);

  // 2. panel 请求失败时必须把真实错误写回节点且不触发 updateBilling
  shouldFail = true;
  testReact.beginRender();
  const tree2 = WorkspaceComp({ theme: { isDark: true } });
  await tree2.props.value.generateNode('shot_fail');

  assert.equal(reqCalls.length, 2);
  assert.equal(reqCalls[1].size, '1792x1024');
  assert.equal(reqCalls[1].referenceSlots.length, 0);
  assert.equal(billingCalls, 1, '失败不得触发 updateBilling');

  testReact.beginRender();
  const tree3 = WorkspaceComp({ theme: { isDark: true } });
  const finalNodes = findReactFlowNodesProp(tree3);
  const outOk = finalNodes.find((n) => n.id === 'shot_ok');
  const outFail = finalNodes.find((n) => n.id === 'shot_fail');

  assert.equal(outOk.data.isGenerating, false);
  assert.equal(outOk.data.status, 'succeeded');
  assert.equal(outOk.data.imageUrl, 'asset:panel_saved_1.png');
  assert.equal(outOk.data.url, 'asset:panel_saved_1.png');
  assert.equal(outOk.data.assetKey, 'panel_saved_1.png');
  assert.deepEqual(outOk.data.candidates, ['asset:panel_saved_1.png']);
  assert.equal(outOk.data.error, '');

  assert.equal(outFail.data.isGenerating, false);
  assert.equal(outFail.data.status, 'failed');
  assert.equal(outFail.data.imageState.status, 'failed');
  assert.equal(outFail.data.error, '上游网关 502 超时');
});

test('CanvasReactFlow - imageNode 与 panelNode 缺注入安全降级不崩', async () => {
  const testReact = makeStatefulTestReact();
  const buildMinimalWorkspace = (extraDeps = {}) => createReactFlowWorkspace({
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
      getActiveId: () => 'proj_img_downgrade',
      loadProject: () => ({
        version: '2.5.1',
        nodes: [
          { id: 'img_only', type: 'imageNode', position: { x: 0, y: 0 }, data: { name: 'i', prompt: 'p', params: {} } },
          { id: 'panel_only', type: 'panelNode', position: { x: 0, y: 300 }, data: { num: 1, prompt: 'p', params: {} } }
        ],
        edges: []
      })
    },
    ...extraDeps
  });

  // 1. 缺 getKey
  const NoKeyComp = buildMinimalWorkspace();
  testReact.beginRender();
  const t1 = NoKeyComp({ theme: { isDark: true } });
  await t1.props.value.generateNode('img_only');
  await t1.props.value.generateNode('panel_only');

  testReact.beginRender();
  const t2 = NoKeyComp({ theme: { isDark: true } });
  const n2 = findReactFlowNodesProp(t2);
  const imgNoKey = n2.find((n) => n.id === 'img_only');
  const panelNoKey = n2.find((n) => n.id === 'panel_only');
  assert.equal(imgNoKey.data.generating, false);
  assert.equal(imgNoKey.data.imageState.status, 'failed');
  assert.match(imgNoKey.data.error, /API Key/);
  assert.equal(panelNoKey.data.isGenerating, false);
  assert.equal(panelNoKey.data.status, 'failed');
  assert.match(panelNoKey.data.error, /API Key/);

  // 2. 有 getKey 但缺 sendImageRequest
  const testReact2 = makeStatefulTestReact();
  const NoSendComp = createReactFlowWorkspace({
    React: testReact2,
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
      getActiveId: () => 'proj_img_nosend',
      loadProject: () => ({
        version: '2.5.1',
        nodes: [
          { id: 'img_only', type: 'imageNode', position: { x: 0, y: 0 }, data: { name: 'i', prompt: 'p', params: {} } },
          { id: 'panel_only', type: 'panelNode', position: { x: 0, y: 300 }, data: { num: 1, prompt: 'p', params: {} } }
        ],
        edges: []
      })
    },
    getKey: () => 'sk-test-only'
  });
  testReact2.beginRender();
  const s1 = NoSendComp({ theme: { isDark: true } });
  await s1.props.value.generateNode('img_only');
  await s1.props.value.generateNode('panel_only');

  testReact2.beginRender();
  const s2 = NoSendComp({ theme: { isDark: true } });
  const sn2 = findReactFlowNodesProp(s2);
  assert.match(sn2.find((n) => n.id === 'img_only').data.error, /生图请求模块未注入/);
  assert.match(sn2.find((n) => n.id === 'panel_only').data.error, /生图请求模块未注入/);
});
