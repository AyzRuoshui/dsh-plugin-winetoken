// -*- coding: utf-8 -*-
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  VIDEO_STATUS,
  DEFAULT_MAX_ATTEMPTS,
  parseSubmitResponse,
  reducePollResponse,
  createVideoNodeState,
  applyVideoState,
  isBusy,
  isTerminal,
  buildVideoPayload,
  resolveVideoEndpoints
} = require('../src/canvas-video.js');

test('CanvasVideo - parseSubmitResponse 兼容直接 URL / task_id / data 嵌套', () => {
  assert.deepEqual(parseSubmitResponse({ url: 'https://v/a.mp4' }), { directUrl: 'https://v/a.mp4', taskId: '', error: '' });
  assert.deepEqual(parseSubmitResponse({ task_id: 'task_1' }), { directUrl: '', taskId: 'task_1', error: '' });
  assert.equal(parseSubmitResponse({ data: [{ url: 'https://v/b.mp4' }] }).directUrl, 'https://v/b.mp4');
  assert.equal(parseSubmitResponse({ data: { id: 'task_2' } }).taskId, 'task_2');
  assert.equal(parseSubmitResponse({ output: { task_id: 'task_3' } }).taskId, 'task_3');
  assert.match(parseSubmitResponse({}).error, /未返回任务 ID/);
  for (const bad of [null, 'junk', [], 42]) {
    assert.match(parseSubmitResponse(bad).error, /不是合法对象|未返回任务 ID/);
  }
});

test('CanvasVideo - reducePollResponse 成功/失败/无状态直链/进行中', () => {
  assert.deepEqual(reducePollResponse({ status: 'succeeded', url: 'https://v/ok.mp4' }, 1), {
    status: VIDEO_STATUS.SUCCEEDED, videoUrl: 'https://v/ok.mp4', error: '', done: true
  });
  assert.equal(reducePollResponse({ state: 'SUCCESS', data: [{ url: 'x.mp4' }] }, 2).status, VIDEO_STATUS.SUCCEEDED);
  const failed = reducePollResponse({ status: 'failed', error: { message: '额度不足' } }, 3);
  assert.equal(failed.status, VIDEO_STATUS.FAILED);
  assert.equal(failed.error, '额度不足');
  assert.equal(failed.done, true);
  assert.equal(reducePollResponse({ url: 'direct.mp4' }, 1).done, true, '无 status 但有直链应视为成功');
  const pending = reducePollResponse({ status: 'processing' }, 1);
  assert.equal(pending.status, VIDEO_STATUS.POLLING);
  assert.equal(pending.done, false);
  // 声称成功但缺 URL 不得误判完成
  assert.equal(reducePollResponse({ status: 'succeeded' }, 1).done, false);
  // 站点形态: status=completed 且响应无 URL 时, 以内容端点地址收口; 未给内容端点则不误判完成
  const viaContent = reducePollResponse({ status: 'completed' }, 5, 100, 'https://s/v1/videos/task_x/content');
  assert.equal(viaContent.done, true);
  assert.equal(viaContent.status, VIDEO_STATUS.SUCCEEDED);
  assert.equal(viaContent.videoUrl, 'https://s/v1/videos/task_x/content');
  assert.equal(reducePollResponse({ status: 'completed' }, 5).done, false);
  // 脏响应不抛错、保持轮询
  assert.equal(reducePollResponse(null, 1).done, false);
  assert.equal(reducePollResponse({ status: NaN }, NaN).done, false);
});

test('CanvasVideo - 破坏性契约: 达到最大轮询次数判定超时而非无限等待', () => {
  const r = reducePollResponse({ status: 'processing' }, DEFAULT_MAX_ATTEMPTS, DEFAULT_MAX_ATTEMPTS);
  assert.equal(r.status, VIDEO_STATUS.TIMEOUT);
  assert.equal(r.done, true);
  assert.match(r.error, /超时/);
  // 恰好最后一次返回成功仍应成功，不被超时误杀
  const ok = reducePollResponse({ status: 'succeeded', url: 'late.mp4' }, DEFAULT_MAX_ATTEMPTS, DEFAULT_MAX_ATTEMPTS);
  assert.equal(ok.status, VIDEO_STATUS.SUCCEEDED);
});

test('CanvasVideo - 节点状态机 create/apply/isBusy/isTerminal', () => {
  const s0 = createVideoNodeState();
  assert.equal(s0.status, VIDEO_STATUS.IDLE);
  assert.equal(isBusy(s0), false);
  const running = applyVideoState(s0, { status: VIDEO_STATUS.POLLING, taskId: 't1', attempt: 3 });
  assert.equal(isBusy(running), true);
  assert.equal(isTerminal(running), false);
  assert.equal(running.taskId, 't1');
  const done = applyVideoState(running, { status: VIDEO_STATUS.SUCCEEDED, videoUrl: 'v.mp4', assetKey: 'a.mp4' });
  assert.equal(isTerminal(done), true);
  assert.equal(done.assetKey, 'a.mp4');
  assert.equal(isTerminal(applyVideoState(s0, { status: VIDEO_STATUS.FAILED })), true);
  // 脏输入安全降级
  assert.equal(applyVideoState(null, null).status, VIDEO_STATUS.POLLING);
  assert.equal(isBusy(null), false);
});

test('CanvasVideo - buildVideoPayload 与 StudioPage 已验证协议完全一致', () => {
  const base = buildVideoPayload({ model: 'MiniMax-H3', prompt: '  雨夜推镜  ', duration: 5, size: '1280x720' });
  assert.equal(base.model, 'MiniMax-H3');
  assert.equal(base.prompt, '雨夜推镜');
  assert.equal(base.seconds, 5);
  assert.equal(base.duration, 5);
  assert.equal(base.resolution, '768P');

  const grok = buildVideoPayload({ model: 'grok-imagine-video-1.5', size: '1920x1080' });
  assert.equal(grok.resolution, '1080p');
  const grok720 = buildVideoPayload({ model: 'grok-imagine-video-1.5', size: '1280x720' });
  assert.equal(grok720.resolution, '720p');
  assert.equal(grok720.images, undefined, 'Grok 族绝不使用 images 数组');

  const minimaxFrames = buildVideoPayload({
    model: 'MiniMax-H3', firstFrameUrl: 'data:image/png;base64,AAA', lastFrameUrl: 'data:image/png;base64,BBB'
  });
  assert.equal(minimaxFrames.image, 'data:image/png;base64,AAA');
  assert.equal(minimaxFrames.metadata.first_frame_image, 'data:image/png;base64,AAA');
  assert.equal(minimaxFrames.metadata.last_frame_image, undefined, '尾帧已下线：绝不下发 last_frame_image');
  const grokFrames = buildVideoPayload({ model: 'grok-imagine-video-1.5', firstFrameUrl: 'F', lastFrameUrl: 'L' });
  assert.equal(grokFrames.image_url, 'F');
  assert.equal(grokFrames.last_frame, undefined, '尾帧已下线：绝不下发 last_frame');
  assert.equal(grokFrames.metadata, undefined);

  // MiniMax-H3-2K 分辨率强制收敛为 2K，横竖屏均合规
  const h32kHoriz = buildVideoPayload({ model: 'MiniMax-H3-2K', size: '2560x1440' });
  assert.equal(h32kHoriz.resolution, '2K');
  const h32kVert = buildVideoPayload({ model: 'MiniMax-H3-2K', size: '1440x2560' });
  assert.equal(h32kVert.resolution, '2K');

  // 破坏性断言：对 MiniMax-H3-2K 即使传入 size: '1920x1080'，也必须产出 resolution: '2K'
  const h32kDirty = buildVideoPayload({ model: 'MiniMax-H3-2K', size: '1920x1080' });
  assert.equal(h32kDirty.resolution, '2K');

  // 破坏性断言：对 MiniMax-H3 即使传入 size: '1920x1080'（旧工程脏数据），也必须强制产出 resolution: '768P'
  const h3Dirty = buildVideoPayload({ model: 'MiniMax-H3', size: '1920x1080' });
  assert.equal(h3Dirty.resolution, '768P');
});

test('CanvasVideo - resolveVideoEndpoints 模型端点收敛', () => {
  const epH3 = resolveVideoEndpoints('https://www.winetoken.asia', 'MiniMax-H3');
  assert.equal(epH3.submitUrl, 'https://www.winetoken.asia/v1/videos');
  assert.equal(epH3.pollUrl('task_123'), 'https://www.winetoken.asia/v1/videos/task_123');
  assert.equal(epH3.contentUrl('task_123'), 'https://www.winetoken.asia/v1/videos/task_123/content');
  assert.equal(epH3.protocol, 'minimax-videos');

  const ep2K = resolveVideoEndpoints('https://www.winetoken.asia/v1', 'MiniMax-H3-2K');
  assert.equal(ep2K.submitUrl, 'https://www.winetoken.asia/v1/videos');
  assert.equal(ep2K.pollUrl('task_456'), 'https://www.winetoken.asia/v1/videos/task_456');
  assert.equal(ep2K.contentUrl('task_456'), 'https://www.winetoken.asia/v1/videos/task_456/content');
  assert.equal(ep2K.protocol, 'minimax-videos');

  const epGrok = resolveVideoEndpoints('https://www.winetoken.asia/v1/', 'grok-imagine-video-1.5');
  assert.equal(epGrok.submitUrl, 'https://www.winetoken.asia/v1/videos/generations');
  assert.equal(epGrok.pollUrl('task_789'), 'https://www.winetoken.asia/v1/videos/generations/task_789');
  assert.equal(epGrok.contentUrl('task_789'), 'https://www.winetoken.asia/v1/videos/generations/task_789');
  assert.equal(epGrok.protocol, 'standard-generations');

  // 基准 URL 无论是带 /v1 还是不带 /v1 或带尾随斜杠，拼接结果均唯一标准化
  assert.equal(resolveVideoEndpoints('http://api.test', 'MiniMax-H3').submitUrl, 'http://api.test/v1/videos');
  assert.equal(resolveVideoEndpoints('http://api.test/v1', 'MiniMax-H3').submitUrl, 'http://api.test/v1/videos');
  assert.equal(resolveVideoEndpoints('http://api.test/v1/', 'MiniMax-H3').submitUrl, 'http://api.test/v1/videos');
});

test('CanvasVideo - 破坏性契约: 超时/越界参数被 clamp，绝不臆造非法上游参数', () => {
  const p = buildVideoPayload({ duration: 999, size: null, prompt: '长'.repeat(9999), model: '' });
  assert.equal(p.seconds, 30);
  assert.equal(p.duration, 30);
  assert.equal(p.prompt.length, 4000);
  assert.equal(p.model, 'MiniMax-H3');
  assert.equal(p.resolution, '768P');
  const p2 = buildVideoPayload({ duration: -5 });
  assert.equal(p2.seconds, 1);
});

const {
  MAX_VIDEO_REF_TOTAL_BYTES,
  getVideoModelCapabilities,
  compileVideoPrompt,
  findOutOfRangeVideoTags,
  computeScaledDimensions,
  estimateReferencePayloadBytes,
  assertVideoPayloadBudget,
  downscaleImageDataUrl
} = require('../src/canvas-video.js');

test('CanvasVideo - getVideoModelCapabilities 模型能力声明契约', () => {
  const h3 = getVideoModelCapabilities('MiniMax-H3');
  assert.equal(h3.supportsMultiRef, true);
  assert.equal(h3.maxRefImages, 9);
  assert.equal(h3.multiRefExclusiveWithFirstFrame, true);
  assert.equal(h3.refField, 'metadata.content');
  assert.equal(h3.protocol, 'minimax-videos');

  const h32k = getVideoModelCapabilities('MiniMax-H3-2K');
  assert.equal(h32k.supportsMultiRef, true);
  assert.equal(h32k.maxRefImages, 9);
  assert.equal(h32k.multiRefExclusiveWithFirstFrame, true);

  const omni = getVideoModelCapabilities('omni-1.2-flash');
  assert.equal(omni.supportsMultiRef, true);
  assert.equal(omni.maxRefImages, 3);
  assert.equal(omni.multiRefExclusiveWithFirstFrame, false);
  assert.equal(omni.refField, 'metadata.reference_images');
  assert.equal(omni.protocol, 'minimax-videos');

  const muse = getVideoModelCapabilities('muse-video');
  assert.equal(muse.supportsMultiRef, false);
  assert.equal(muse.maxRefImages, 1);
  assert.equal(muse.protocol, 'sora-videos');

  const grok = getVideoModelCapabilities('grok-imagine-video-1.5');
  assert.equal(grok.supportsMultiRef, false);
  assert.equal(grok.maxRefImages, 1);
  assert.equal(grok.disallowImagesArray, true);
  assert.equal(grok.protocol, 'standard-generations');
});

test('CanvasVideo - H3 多图参考协议 (1~9张 metadata.content, 超 9 截断, 零首帧字段)', () => {
  const refs = Array.from({ length: 11 }, (_, i) => `https://cdn.test/ref_${i + 1}.png`);
  const p = buildVideoPayload({
    model: 'MiniMax-H3',
    prompt: '图1 与 图2 在雨夜交锋',
    duration: 6,
    size: '1280x720',
    referenceImages: refs,
    referenceMode: 'reference'
  });

  assert.equal(p.image, undefined);
  assert.equal(p.image_url, undefined);
  assert.equal(p.metadata.first_frame_image, undefined);
  assert.ok(Array.isArray(p.metadata.content));
  assert.equal(p.metadata.content.length, 10, '1条text + 最多9张参考图');
  assert.deepEqual(p.metadata.content[0], { type: 'text', text: '图1 与 图2 在雨夜交锋' });
  assert.deepEqual(p.metadata.content[1], {
    type: 'image_url',
    image_url: { url: 'https://cdn.test/ref_1.png' },
    role: 'reference_image'
  });
  assert.deepEqual(p.metadata.content[9], {
    type: 'image_url',
    image_url: { url: 'https://cdn.test/ref_9.png' },
    role: 'reference_image'
  });

  const p2k = buildVideoPayload({
    model: 'MiniMax-H3-2K',
    prompt: '特写推镜',
    referenceImages: ['https://cdn.test/a.png'],
    referenceMode: 'reference',
    ratio: '16:9'
  });
  assert.equal(p2k.resolution, '2K');
  assert.equal(p2k.metadata.ratio, '16:9');
  assert.equal(p2k.metadata.content.length, 2);
});

test('CanvasVideo - H3 模式互斥契约 (firstFrameUrl 与 referenceImages 并存不串场)', () => {
  const refModePayload = buildVideoPayload({
    model: 'MiniMax-H3',
    prompt: '全能参考模式',
    firstFrameUrl: 'https://cdn.test/first.png',
    referenceImages: ['https://cdn.test/r1.png', 'https://cdn.test/r2.png'],
    referenceMode: 'reference'
  });
  assert.equal(refModePayload.image, undefined);
  assert.equal(refModePayload.metadata.first_frame_image, undefined);
  assert.equal(refModePayload.metadata.content.length, 3);

  const emptyRefModePayload = buildVideoPayload({
    model: 'MiniMax-H3',
    prompt: '全能参考空槽位不漏首帧',
    firstFrameUrl: 'https://cdn.test/stale_first.png',
    referenceImages: [],
    referenceMode: 'reference'
  });
  assert.equal(emptyRefModePayload.image, undefined);
  assert.deepEqual(emptyRefModePayload.metadata, { ratio: '16:9' });
  assert.equal(emptyRefModePayload.metadata.first_frame_image, undefined);
  assert.equal(emptyRefModePayload.metadata.content, undefined);

  const firstFrameModePayload = buildVideoPayload({
    model: 'MiniMax-H3',
    prompt: '首帧模式',
    firstFrameUrl: 'https://cdn.test/first.png',
    referenceImages: ['https://cdn.test/r1.png', 'https://cdn.test/r2.png'],
    referenceMode: 'first_frame'
  });
  assert.equal(firstFrameModePayload.image, 'https://cdn.test/first.png');
  assert.equal(firstFrameModePayload.metadata.first_frame_image, 'https://cdn.test/first.png');
  assert.equal(firstFrameModePayload.metadata.content, undefined);
});

test('CanvasVideo - Omni 1.2 Flash 多图参考协议 (2/3/5张走 reference_images, 单首帧兼容)', () => {
  const refs5 = ['u1', 'u2', 'u3', 'u4', 'u5'];
  const p5 = buildVideoPayload({
    model: 'omni-1.2-flash',
    prompt: '角色同框',
    duration: 8,
    size: '720x1280',
    referenceImages: refs5
  });
  assert.equal(p5.resolution, '720P');
  assert.equal(p5.size, '720x1280');
  assert.equal(p5.image, undefined, 'Omni 多图不得冗余重复塞入 image');
  assert.equal(p5.metadata.first_frame_image, undefined, 'Omni 多图不得冗余塞入 first_frame_image');
  assert.deepEqual(p5.metadata.reference_images, ['u1', 'u2', 'u3']);

  const p2 = buildVideoPayload({
    model: 'omni-1.2-flash',
    prompt: '双图',
    referenceImages: ['a', 'b']
  });
  assert.deepEqual(p2.metadata.reference_images, ['a', 'b']);

  const p1Compat = buildVideoPayload({
    model: 'omni-1.2-flash',
    prompt: '旧单首帧兼容',
    firstFrameUrl: 'single_first'
  });
  assert.equal(p1Compat.image, 'single_first');
  assert.equal(p1Compat.metadata.first_frame_image, 'single_first');
  assert.equal(p1Compat.metadata.reference_images, undefined);
});

test('CanvasVideo - 单首帧模型退化防御 (muse-video 与 grok-imagine-video-1.5)', () => {
  const refs = ['img_1', 'img_2', 'img_3', 'img_4'];
  const muse = buildVideoPayload({
    model: 'muse-video',
    prompt: '航拍',
    duration: 10,
    size: '1280x720',
    referenceImages: refs
  });
  assert.equal(muse.seconds, '10');
  assert.equal(muse.image, 'img_1');
  assert.equal(muse.image_url, 'img_1');
  assert.equal(muse.metadata, undefined);
  assert.equal(muse.images, undefined);

  const grok = buildVideoPayload({
    model: 'grok-imagine-video-1.5',
    prompt: '穿梭',
    size: '1920x1080',
    referenceImages: refs
  });
  assert.equal(grok.image, 'img_1');
  assert.equal(grok.image_url, 'img_1');
  assert.equal(grok.metadata, undefined);
  assert.equal(grok.images, undefined);
});

test('CanvasVideo - compileVideoPrompt 顺序转换与跳过超界/空槽位', () => {
  const slots = [
    { index: 1, name: '主角', dataUrl: 'data:image/png;base64,A' },
    { index: 2, name: '反派', dataUrl: 'data:image/png;base64,B' }
  ];
  assert.equal(
    compileVideoPrompt('@[图1:主角] 与 @[图2:反派] 对峙', slots),
    '图1(主角) 与 图2(反派) 对峙'
  );

  // 空槽位与超界标记自动跳过，后续有效槽位按 FIFO 重排序号
  const sparseSlots = [
    { index: 1, name: '主角', dataUrl: 'data:image/png;base64,A' },
    { index: 2, name: '空图', dataUrl: '' },
    { index: 3, name: '场景', dataUrl: 'data:image/png;base64,C' }
  ];
  assert.equal(
    compileVideoPrompt('@[图1:主角] 在 @[图3:场景] 等待 @[图2:空图] 和 @[图5:路人]', sparseSlots),
    '图1(主角) 在 图2(场景) 等待 和'
  );
  assert.deepEqual(
    findOutOfRangeVideoTags('@[图1:主角] @[图4:越界]', slots),
    ['@[图4:越界]']
  );
  // 手写自然序数原样保留
  assert.equal(compileVideoPrompt('图1 和 第2张图 同框', slots), '图1 和 第2张图 同框');
});

test('CanvasVideo - 图片轻量化缩放计算与 40MB 总载荷预算守卫', async () => {
  assert.deepEqual(computeScaledDimensions(4096, 2048, 2048), { width: 2048, height: 1024, scaled: true });
  assert.deepEqual(computeScaledDimensions(1280, 720, 2048), { width: 1280, height: 720, scaled: false });
  assert.equal(MAX_VIDEO_REF_TOTAL_BYTES, 40 * 1024 * 1024);

  // 非 DOM 下安全原样返回
  const passthrough = await downscaleImageDataUrl('data:image/png;base64,AAAA');
  assert.equal(passthrough, 'data:image/png;base64,AAAA');

  const big = 'data:image/jpeg;base64,' + 'A'.repeat(21 * 1024 * 1024);
  assert.equal(estimateReferencePayloadBytes([big, big]), big.length * 2);
  assert.throws(() => assertVideoPayloadBudget([big, big]), /超过安全上限/);
  assert.throws(
    () => buildVideoPayload({ model: 'MiniMax-H3', prompt: '过大', referenceImages: [big, big], referenceMode: 'reference' }),
    /超过安全上限/
  );
});
