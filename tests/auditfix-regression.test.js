// -*- coding: utf-8 -*-
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const React = require('react');
const client = require('../src/client.js');
const {
  requestSingleImage,
  requestVideoGeneration
} = require('../src/tool.js');
const {
  getVideoModelCapabilities,
  buildVideoPayload,
  executeVideoNodeTask
} = require('../src/canvas-video.js');
const {
  buildGenerationContext
} = require('../src/canvas-nodes.js');
const {
  createReactFlowWorkspace,
  resolveVideoNodeOptions,
  getImageModelCapabilities
} = require('../src/canvas-reactflow.js');

function okJson(data) {
  return { ok: true, json: async () => data };
}

test('AuditFix 1 - Tool 生图按参考图能力路由，unsupported 明确拒绝', async () => {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, init });
    return okJson({ data: [{ url: 'https://cdn.example/result.png' }] });
  };
  const image = 'data:image/png;base64,YWJj';

  await requestSingleImage('https://relay.example/v1', 'test-key', {
    model: 'sensenova-u1.5-lite', prompt: 'edit', size: '1024x1024', image_url: image, fetchFn
  });
  const sense = calls.at(-1);
  assert.match(sense.url, /\/images\/edits$/);
  assert.equal(JSON.parse(sense.init.body).images[0].image_url, image);

  await requestSingleImage('https://relay.example/v1', 'test-key', {
    model: 'gpt-image-2.6-flare', prompt: 'edit', size: '1024x1024', image_url: image, fetchFn
  });
  const gpt = calls.at(-1);
  assert.match(gpt.url, /\/images\/edits$/);
  assert.ok(gpt.init.body instanceof FormData);
  assert.equal(gpt.init.body.get('prompt'), 'edit');
  assert.ok(gpt.init.body.get('image'), 'GPT edits 使用 multipart 图片字段');

  await requestSingleImage('https://relay.example/v1', 'test-key', {
    model: 'nano-banana-2.1', prompt: 'edit', size: '1024x1024', image_url: image, quality: 'medium', fetchFn
  });
  const nano = calls.at(-1);
  assert.match(nano.url, /\/images\/generations$/);
  const nanoPayload = JSON.parse(nano.init.body);
  assert.deepEqual(nanoPayload.images, [{ url: image }]);
  assert.equal(nanoPayload.quality, 'medium');

  const callsBeforeReject = calls.length;
  await assert.rejects(
    requestSingleImage('https://relay.example/v1', 'test-key', {
      model: 'muse-image', prompt: 'edit', size: '1024x1024', image_url: image, fetchFn
    }),
    /不支持参考图输入/,
    'Muse 等不支持参考图的模型不能静默退化成文生图'
  );
  await assert.rejects(
    requestSingleImage('https://relay.example/v1', 'test-key', {
      model: 'grok-imagine-image-2.0', prompt: 'edit', size: '1024x1024', image_url: image, fetchFn
    }),
    /不支持参考图输入/
  );
  assert.equal(calls.length, callsBeforeReject, '拦截前不得发送请求');
});

test('AuditFix 2 - Legacy ImageNode 把全部参考图交给编辑请求并对 single-N 拆批', async () => {
  const refs = Array.from({ length: 6 }, (_, i) => ({ dataUrl: `data:image/png;base64,${i}` }));
  const req = client.buildImageRequest({
    baseUrl: 'https://relay.example/v1', apiKey: 'key', model: 'sensenova-u1.5-lite',
    prompt: 'many refs', size: '1024x1024', n: 1, referenceSlots: refs
  });
  assert.equal(req.payload.images.length, 5, '按编辑模型上限裁剪参考图');
  assert.equal(req.payload.images[4].image_url, refs[4].dataUrl);

  const sent = [];
  const result = await client.requestImageBatches(async (args) => {
    sent.push(args);
    return { data: [{ url: `https://cdn.example/${sent.length}.png` }] };
  }, { model: 'sensenova-u1.5-lite', quality: '2K', referenceSlots: refs.slice(0, 5) }, 4, true);
  assert.deepEqual(sent.map(x => x.n), [1, 1, 1, 1]);
  assert.ok(sent.every(x => x.quality === '2K' && x.referenceSlots.length === 5));
  assert.equal(result.length, 4);
  assert.match(fs.readFileSync(path.join(__dirname, '../src/client.js'), 'utf8'), /quality,\s*referenceSlots: resolvedRefs\.map/);
});

test('AuditFix 3 - Legacy Panel 参考图能力预检对 Muse/Grok 给出可见错误', () => {
  const unsupported = client.validateImageModelSupport('muse-image', true);
  assert.equal(unsupported.supported, false);
  assert.match(unsupported.error, /muse-image.*不支持参考图输入/);
  assert.equal(client.validateImageModelSupport('grok-imagine-image-2.0', true).supported, false);
  assert.equal(client.validateImageModelSupport('nano-banana-2.1', true).protocol, 'flow-relay-generations');
  const source = fs.readFileSync(path.join(__dirname, '../src/client.js'), 'utf8');
  assert.match(source, /setPanels\(prev => prev\.map\(p => p\.id === panelId \? \{ \.\.\.p, isGenerating: false, error: message \}/);
});

test('AuditFix 4 - H3/H3-2K 可接 9 张，其他视频模型维持各自参考图上限', () => {
  assert.equal(getVideoModelCapabilities('MiniMax-H3').maxRefImages, 9);
  assert.equal(getVideoModelCapabilities('MiniMax-H3-2K').maxRefImages, 9);
  assert.equal(getVideoModelCapabilities('omni-1.2-flash').maxRefImages, 3);
  assert.equal(getVideoModelCapabilities('muse-video').maxRefImages, 1);
  assert.equal(getVideoModelCapabilities('grok-imagine-video-1.5').maxRefImages, 1);

  const canvasItems = Array.from({ length: 10 }, (_, i) => ({
    id: `img${i}`, type: 'image', data: { url: `https://img.example/${i}.png` }
  }));
  const project = {
    canvasItems,
    panels: [{ id: 'panel', num: 1, prompt: 'scene' }],
    edges: canvasItems.map(item => ({
      id: `edge-${item.id}`, from: { type: 'item', id: item.id }, to: { type: 'panel', id: 'panel' }
    }))
  };
  const context = buildGenerationContext(project, 'panel');
  assert.equal(context.referenceImages.length, 9);
  assert.ok(context.warnings.some(message => message.includes('参考图超过 9 张')));
});

test('AuditFix 5 - H3 竖屏比例经共享视频执行器写入 metadata.ratio', async () => {
  const calls = [];
  await executeVideoNodeTask({
    baseUrl: 'https://relay.example/v1', apiKey: 'test-key', model: 'MiniMax-H3',
    prompt: 'vertical shot', duration: 5, size: '720x1280', ratio: '9:16',
    fetchFn: async (url, init) => {
      calls.push({ url, init });
      return okJson({ url: 'https://cdn.example/video.mp4' });
    }
  });
  assert.equal(calls.length, 1);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.metadata.ratio, '9:16');
  assert.equal(body.resolution, '768P');
  assert.match(fs.readFileSync(path.join(__dirname, '../src/client.js'), 'utf8'), /ratio: aspectRatio/);
});

test('AuditFix 6 - 4:3/3:4 尺寸映射及 snapAspectRatio 均为真实比例', () => {
  assert.equal(client.snapAspectRatio('1344x1008'), '4:3');
  assert.equal(client.snapAspectRatio('1008x1344'), '3:4');
  const normalized = client.normalizeImageModel({ id: 'test', resolutions: ['1344x1008', '1008x1344'] });
  assert.equal(normalized.resolutions[0].icon, 'ratio16_9', '真 4:3 保持横向分类');
  assert.equal(normalized.resolutions[1].icon, 'ratio9_16', '真 3:4 保持竖向分类');
  const videoRatio = require('../src/canvas-video.js').snapVideoAspectRatio;
  assert.equal(videoRatio('1344x1008'), '4:3');
  assert.equal(videoRatio('1008x1344'), '3:4');
  const source = fs.readFileSync(path.join(__dirname, '../src/canvas-reactflow.js'), 'utf8');
  assert.match(source, /'4:3': '1344x1008'/);
  assert.match(source, /'3:4': '1008x1344'/);
});

test('AuditFix 7 - Grok 视频统一传 aspect_ratio、小写 resolution 且不带 audio', async () => {
  const calls = [];
  await requestVideoGeneration('https://relay.example/v1', 'key', {
    model: 'grok-imagine-video-1.5', prompt: 'a shot', duration: 5,
    size: '1920x1080', aspect_ratio: '9:16',
    fetchFn: async (url, init) => {
      calls.push({ url, init });
      return okJson({ url: 'https://cdn.example/grok.mp4' });
    }
  });
  assert.equal(calls.length, 1);
  const payload = JSON.parse(calls[0].init.body);
  assert.equal(payload.resolution, '1080p');
  assert.equal(payload.aspect_ratio, '9:16');
  assert.equal('audio' in payload, false);
  const canvasPayload = buildVideoPayload({ model: 'grok-imagine-video-1.5', size: '1920x1080', ratio: '9:16' });
  assert.equal(canvasPayload.resolution, '1080p');
  assert.equal(canvasPayload.aspect_ratio, '9:16');
  assert.equal('audio' in canvasPayload, false);
});

test('AuditFix 8 - ReactFlow 视频/图片下拉按模型能力收敛', () => {
  const h3 = resolveVideoNodeOptions(require('../src/canvas-video.js'), 'MiniMax-H3');
  const h32k = resolveVideoNodeOptions(require('../src/canvas-video.js'), 'MiniMax-H3-2K');
  const omni = resolveVideoNodeOptions(require('../src/canvas-video.js'), 'omni-1.2-flash');
  assert.deepEqual(h3.durations, [4, 5, 6, 10, 15]);
  assert.deepEqual(h32k.durations, [5, 6, 10, 15]);
  assert.deepEqual(h32k.resolutions, ['2K']);
  assert.ok(!omni.resolutions.includes('1080P') && !omni.resolutions.includes('2K'));
  assert.ok(!omni.aspectRatios.includes('4:3') && !omni.aspectRatios.includes('3:4'));
  const museImage = getImageModelCapabilities({ id: 'muse-image', resolutions: ['1024x1024'], qualities: ['1K'] });
  assert.deepEqual(museImage.qualityOptions, ['1K']);
  assert.deepEqual(museImage.aspectRatios, ['1:1']);
  const nanoImage = getImageModelCapabilities({ id: 'nano-banana-2.1', resolutions: ['1024x1024', '1344x1008'], qualities: ['1K', '2K', '4K'] });
  assert.ok(nanoImage.aspectRatios.includes('4:3'));
  assert.deepEqual(nanoImage.qualityOptions, ['1K', '2K', '4K']);
});

test('AuditFix 9 - Studio H3/H3-2K 首帧空提示词前置拦截', () => {
  assert.equal(client.validateStudioVideoPrompt({ model: 'MiniMax-H3', prompt: '', hasReference: false }).valid, false);
  assert.equal(client.validateStudioVideoPrompt({ model: 'MiniMax-H3-2K', prompt: '  ', hasReference: false }).valid, false);
  assert.equal(client.validateStudioVideoPrompt({ model: 'MiniMax-H3', prompt: 'scene', hasReference: false }).valid, true);
  const source = fs.readFileSync(path.join(__dirname, '../src/client.js'), 'utf8');
  assert.match(source, /isH3StudioModel && videoRefType !== 'reference' && !prompt\.trim\(\)/);
});

test('AuditFix 10 - Nano Banana 参考图与 medium/high 画质映射真实透传', () => {
  const refs = Array.from({ length: 7 }, (_, i) => ({ url: `https://img.example/${i}.png` }));
  const request = client.buildImageRequest({
    baseUrl: 'https://relay.example/v1', apiKey: 'key', model: 'nano-banana-2.1',
    prompt: 'edit', size: '1344x1008', quality: 'medium', n: 1, referenceSlots: refs
  });
  assert.equal(request.payload.quality, 'medium');
  assert.equal(request.payload.images.length, 5);
  assert.deepEqual(request.payload.images[0], { url: refs[0].url });
  const high = client.buildImageRequest({ model: 'nano-banana-2.1', prompt: 'p', size: '1008x1344', quality: 'high' });
  assert.equal(high.payload.quality, 'high');
  assert.equal(client.validateImageModelSupport('nano-banana-2.1', true).supported, true);
});

test('AuditFix 11 - 已删除的 gemini-imagen-3 不再进入客户端回退或工具说明', () => {
  for (const file of ['client.js', 'canvas-reactflow.js', 'tool.js']) {
    const source = fs.readFileSync(path.join(__dirname, '../src', file), 'utf8');
    assert.equal(source.includes('gemini-imagen-3'), false, `${file} 不应引用已下架幽灵模型`);
  }
});

test('AuditFix 12 - Studio 余额预检只用已乘张数一次的预估值', () => {
  assert.equal(client.calculateImageBatchCost(0.15, 4), 0.6);
  assert.equal(client.calculateImageBatchCost(0.15, 1), 0.15);
  const source = fs.readFileSync(path.join(__dirname, '../src/client.js'), 'utf8');
  assert.match(source, /const totalEstCost = estCost;/);
  assert.doesNotMatch(source, /const totalEstCost = estCost \* count/);
});

test('AuditFix 5b - ReactFlow videoNode 从 aspectRatio 驱动 H3 payload ratio', async () => {
  const slots = [];
  let cursor = 0;
  const testReact = {
    beginRender() { cursor = 0; },
    createElement: React.createElement,
    useState(init) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof init === 'function' ? init() : init;
      return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }];
    },
    useRef(init) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = { current: init };
      return slots[i];
    },
    useEffect() { cursor++; },
    useMemo(fn) { cursor++; return fn(); },
    useCallback(fn) { cursor++; return fn; }
  };
  const calls = [];
  const project = {
    version: '2.5.1',
    nodes: [{
      id: 'vid_vertical', type: 'videoNode', position: { x: 0, y: 0 },
      data: { name: '竖屏测试', prompt: 'portrait', videoState: { status: 'idle' }, params: {
        model: 'MiniMax-H3', duration: 5, resolution: '720P', aspectRatio: '9:16'
      } }
    }],
    edges: [], viewport: { x: 0, y: 0, zoom: 1 }
  };
  const workspace = createReactFlowWorkspace({
    React: testReact,
    initXyFlow: () => ({
      ReactFlow: 'MockReactFlow', MiniMap: 'MockMiniMap', Controls: 'MockControls',
      Background: 'MockBackground', Panel: 'MockPanel', Handle: 'MockHandle',
      Position: { Left: 'left', Right: 'right' }
    }),
    canvasProjectStore: {
      ensureLegacyMigration() {}, getActiveId: () => 'project', loadProject: () => project, saveProject() {}
    },
    CanvasVideoUtils: require('../src/canvas-video.js'),
    getKey: () => 'test-key',
    BASE_URL: 'https://relay.example/v1',
    fetchFn: async (url, init) => {
      calls.push({ url, init });
      return okJson({ url: 'https://cdn.example/vertical.mp4' });
    }
  });
  testReact.beginRender();
  const tree = workspace({ theme: { isDark: true }, availableVideoModels: [{ id: 'MiniMax-H3', name: 'MiniMax H3' }] });
  await tree.props.value.generateNode('vid_vertical');
  assert.equal(calls.length, 1);
  const payload = JSON.parse(calls[0].init.body);
  assert.equal(payload.metadata.ratio, '9:16');
});
