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
  assert.equal(grok.resolution, '1080P');
  const grok720 = buildVideoPayload({ model: 'grok-imagine-video-1.5', size: '1280x720' });
  assert.equal(grok720.resolution, '720P');
  assert.equal(grok720.images, undefined, 'Grok 族绝不使用 images 数组');

  const minimaxFrames = buildVideoPayload({
    model: 'MiniMax-H3', firstFrameUrl: 'data:image/png;base64,AAA', lastFrameUrl: 'data:image/png;base64,BBB'
  });
  assert.equal(minimaxFrames.image, 'data:image/png;base64,AAA');
  assert.equal(minimaxFrames.metadata.first_frame_image, 'data:image/png;base64,AAA');
  assert.equal(minimaxFrames.metadata.last_frame_image, 'data:image/png;base64,BBB');
  const grokFrames = buildVideoPayload({ model: 'grok-imagine-video-1.5', firstFrameUrl: 'F', lastFrameUrl: 'L' });
  assert.equal(grokFrames.image_url, 'F');
  assert.equal(grokFrames.last_frame, 'L');
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
