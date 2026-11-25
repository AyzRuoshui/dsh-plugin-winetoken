// -*- coding: utf-8 -*-
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildGenerationContext, listNodes } = require('../src/canvas-nodes.js');

test('CanvasEdgeInjection - 0 图汇入视频节点：纯文生视频 text_to_video', () => {
  const project = {
    version: '2.5.1',
    nodes: [
      {
        id: 'txt1',
        type: 'textNode',
        position: { x: 100, y: 100 },
        data: { text: '暴风雪席卷雪原，狂风呼啸' }
      },
      {
        id: 'vid1',
        type: 'videoNode',
        position: { x: 500, y: 100 },
        data: {
          prompt: '慢动作特写镜头',
          params: { duration: 5, resolution: '720P', aspectRatio: '16:9', generateAudio: false }
        }
      }
    ],
    edges: [
      { id: 'e1', source: 'txt1', target: 'vid1', type: 'default' }
    ]
  };

  const ctx = buildGenerationContext(project, 'vid1');
  assert.equal(ctx.mode, 'text_to_video');
  assert.equal(ctx.referenceImages.length, 0);
  assert.equal(ctx.firstFrameUrl, '');
  assert.equal(ctx.lastFrameUrl, undefined, '尾帧已下线：上下文不再派生 lastFrameUrl');
  assert.equal(ctx.multiReferenceCount, 0);
  assert.match(ctx.prompt, /慢动作特写镜头/);
  assert.match(ctx.prompt, /暴风雪席卷雪原，狂风呼啸/);
  assert.equal(ctx.params.duration, 5);
  assert.equal(ctx.params.resolution, '720P');
});

test('CanvasEdgeInjection - 1 图汇入视频节点：单图首帧参考 single_reference', () => {
  const project = {
    version: '2.5.1',
    nodes: [
      {
        id: 'img1',
        type: 'imageNode',
        position: { x: 100, y: 100 },
        data: { url: 'https://cdn.example.com/start_frame.png', prompt: '主角拔剑' }
      },
      {
        id: 'vid1',
        type: 'videoNode',
        position: { x: 500, y: 100 },
        data: { prompt: '剑锋挥斩' }
      }
    ],
    edges: [
      { id: 'e1', source: 'img1', target: 'vid1', type: 'default' }
    ]
  };

  const ctx = buildGenerationContext(project, 'vid1');
  assert.equal(ctx.mode, 'single_reference');
  assert.equal(ctx.firstFrameUrl, 'https://cdn.example.com/start_frame.png');
  assert.equal(ctx.lastFrameUrl, undefined, '尾帧已下线：上下文不再派生 lastFrameUrl');
  assert.equal(ctx.multiReferenceCount, 1);
  assert.deepEqual(ctx.referenceImages, ['https://cdn.example.com/start_frame.png']);
  assert.match(ctx.prompt, /剑锋挥斩/);
  assert.match(ctx.prompt, /主角拔剑/);
});

test('CanvasEdgeInjection - 多图汇入视频节点：自动升级全能多图参考 multi_reference', () => {
  const project = {
    version: '2.5.1',
    nodes: [
      {
        id: 'img1',
        type: 'imageNode',
        position: { x: 100, y: 80 },
        data: { url: 'https://cdn.example.com/frame1.png', prompt: '起势' }
      },
      {
        id: 'img2',
        type: 'imageNode',
        position: { x: 100, y: 220 },
        data: { assetKey: 'frame2_key.png', prompt: '蓄力' }
      },
      {
        id: 'img3',
        type: 'imageNode',
        position: { x: 100, y: 360 },
        data: { url: 'https://cdn.example.com/frame3.png', prompt: '收势' }
      },
      {
        id: 'txt1',
        type: 'textNode',
        position: { x: 100, y: 500 },
        data: { text: '刀光剑影，火花四溅' }
      },
      {
        id: 'vid1',
        type: 'videoNode',
        position: { x: 600, y: 200 },
        data: {
          prompt: '运镜推进全景',
          params: { duration: 10, resolution: '1080P', generateAudio: true }
        }
      }
    ],
    edges: [
      { id: 'e1', source: 'img1', target: 'vid1', type: 'default' },
      { id: 'e2', source: 'img2', target: 'vid1', type: 'default' },
      { id: 'e3', source: 'img3', target: 'vid1', type: 'default' },
      { id: 'e4', source: 'txt1', target: 'vid1', type: 'default' }
    ]
  };

  const ctx = buildGenerationContext(project, 'vid1');
  assert.equal(ctx.mode, 'multi_reference');
  assert.equal(ctx.multiReferenceCount, 3);
  assert.equal(ctx.firstFrameUrl, 'https://cdn.example.com/frame1.png');
  assert.equal(ctx.lastFrameUrl, undefined, '尾帧已下线：上下文不再派生 lastFrameUrl');
  assert.deepEqual(ctx.referenceImages, [
    'https://cdn.example.com/frame1.png',
    'asset:frame2_key.png',
    'https://cdn.example.com/frame3.png'
  ]);
  assert.match(ctx.prompt, /运镜推进全景/);
  assert.match(ctx.prompt, /起势/);
  assert.match(ctx.prompt, /蓄力/);
  assert.match(ctx.prompt, /收势/);
  assert.match(ctx.prompt, /刀光剑影，火花四溅/);
  assert.equal(ctx.params.duration, 10);
  assert.equal(ctx.params.resolution, '1080P');
  assert.equal(ctx.params.generateAudio, true);
});

test('CanvasEdgeInjection - 连线类型契约：React Flow 连线类型必须为 default 而非 bezier', () => {
  const project = {
    version: '2.5.1',
    nodes: [
      { id: 'n1', type: 'imageNode', position: { x: 0, y: 0 }, data: { url: 'a.png' } },
      { id: 'n2', type: 'panelNode', position: { x: 200, y: 0 }, data: { prompt: '分镜' } }
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'n2', type: 'default' }
    ]
  };

  project.edges.forEach(e => {
    assert.equal(e.type, 'default', 'React Flow 边的类型必须统一为 default');
    assert.notEqual(e.type, 'bezier', '不得落 bezier 边类型');
  });
});
