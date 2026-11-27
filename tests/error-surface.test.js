// -*- coding: utf-8 -*-
const test = require('node:test');
const assert = require('node:assert/strict');

const canvasVideo = require('../src/canvas-video.js');
const client = require('../src/client.js');
const tool = require('../src/tool.js');

function mockResponse({ ok = false, status = 400, body = '', jsonOnly = null }) {
  if (jsonOnly !== null) {
    return {
      ok,
      status,
      async json() {
        return jsonOnly;
      }
    };
  }
  return {
    ok,
    status,
    async text() {
      return body;
    },
    async json() {
      return JSON.parse(body);
    }
  };
}

for (const [label, extractFn, readFn] of [
  ['canvas-video.js', canvasVideo.extractApiErrorMessage, canvasVideo.readResponseErrorMessage],
  ['client.js', client.extractApiErrorMessage, client.readResponseErrorMessage]
]) {
  test(`${label} 提取优先级覆盖四类标准输入与兜底字段`, async () => {
    // 1. New API 宿主结构: { error: { message } }
    assert.equal(
      extractFn({ rawText: JSON.stringify({ error: { message: 'Host API error' } }), status: 400 }),
      'Host API error'
    );
    // 1 > 2 优先级验证
    assert.equal(
      extractFn({
        rawText: JSON.stringify({ error: { message: 'Nested error' }, message: 'Top message' }),
        status: 400
      }),
      'Nested error'
    );

    // 2. Hailuo / 插件侧结构: { code, message, data: null }
    assert.equal(
      extractFn({
        rawText: JSON.stringify({ code: 'H3_400', message: '视频参考图格式不支持', data: null }),
        status: 400
      }),
      '视频参考图格式不支持'
    );
    // 空白 error.message 自动跳过并回落到顶层 message
    assert.equal(
      extractFn({
        rawText: JSON.stringify({ error: { message: '   ' }, message: '真实错误原因' }),
        status: 400
      }),
      '真实错误原因'
    );

    // 3. error_msg / msg 兜底
    assert.equal(
      extractFn({ rawText: JSON.stringify({ error_msg: '参数非法', msg: '次级提示' }), status: 400 }),
      '参数非法'
    );
    assert.equal(
      extractFn({ rawText: JSON.stringify({ msg: '触发限流' }), status: 429 }),
      '触发限流'
    );

    // 4. 纯文本 & 超长文本截断
    assert.equal(
      extractFn({ rawText: '502 Bad Gateway from upstream nginx', status: 502 }),
      '502 Bad Gateway from upstream nginx'
    );
    const longText = 'E'.repeat(260);
    assert.equal(extractFn({ rawText: longText, status: 500 }).length, 200);
    // 无已知识别字段的 JSON 仍保留截断后的原始响应文本
    assert.equal(
      extractFn({ rawText: JSON.stringify({ code: 'ERR_UNKNOWN', detail: 'bad' }), status: 400 }),
      '{"code":"ERR_UNKNOWN","detail":"bad"}'
    );

    // 5. 空体 / 纯空白响应回落 HTTP <status>
    assert.equal(extractFn({ rawText: '', status: 400 }), 'HTTP 400');
    assert.equal(extractFn({ rawText: '   \n\t ', status: 502 }), 'HTTP 502');

    // Response 读取器兼容标准 text() 与仅实现 json() 的 mock
    assert.equal(
      await readFn(mockResponse({
        status: 400,
        body: JSON.stringify({ code: 'BAD_PARAM', message: 'Plugin rejection reason', data: null })
      })),
      'Plugin rejection reason'
    );
    assert.equal(
      await readFn(mockResponse({ status: 400, body: '' })),
      'HTTP 400'
    );
    assert.equal(
      await readFn(mockResponse({ status: 400, jsonOnly: { message: 'Only json mock message' } })),
      'Only json mock message'
    );
  });
}

test('reducePollResponse 按同优先级提取轮询失败原因并保留中文默认兜底', () => {
  assert.equal(
    canvasVideo.reducePollResponse({ status: 'failed', error: { message: '审核未通过' }, message: '次要' }).error,
    '审核未通过'
  );
  assert.equal(
    canvasVideo.reducePollResponse({ status: 'error', code: '500', message: 'H3 推理节点异常' }).error,
    'H3 推理节点异常'
  );
  assert.equal(
    canvasVideo.reducePollResponse({ status: 'failed', msg: '任务队列已满' }).error,
    '任务队列已满'
  );
  assert.equal(
    canvasVideo.reducePollResponse({ status: 'failed' }).error,
    '视频渲染失败'
  );
});

test('sendImageRequest 在 {code,message}、纯文本与空体失败时透出清晰原因', async () => {
  await assert.rejects(
    () => client.sendImageRequest({
      baseUrl: 'https://example.com',
      apiKey: 'sk-test',
      model: 'nano-banana-2.1',
      prompt: 'test prompt',
      size: '1024x1024',
      fetchFn: async () => mockResponse({
        status: 400,
        body: JSON.stringify({ code: 'PLUGIN_400', message: '上游生图校验失败', data: null })
      })
    }),
    /上游生图校验失败/
  );

  await assert.rejects(
    () => client.sendImageRequest({
      baseUrl: 'https://example.com',
      apiKey: 'sk-test',
      model: 'nano-banana-2.1',
      prompt: 'test prompt',
      size: '1024x1024',
      fetchFn: async () => mockResponse({ status: 502, body: 'Upstream 502 Gateway Error' })
    }),
    /Upstream 502 Gateway Error/
  );

  await assert.rejects(
    () => client.sendImageRequest({
      baseUrl: 'https://example.com',
      apiKey: 'sk-test',
      model: 'nano-banana-2.1',
      prompt: 'test prompt',
      size: '1024x1024',
      fetchFn: async () => mockResponse({ status: 400, body: '' })
    }),
    /^Error: HTTP 400$/
  );
});

test('executeVideoNodeTask 在视频提交失败与轮询失败时透出服务端具体错误', async () => {
  await assert.rejects(
    () => canvasVideo.executeVideoNodeTask({
      baseUrl: 'https://example.com/v1',
      apiKey: 'sk-test',
      model: 'MiniMax-H3',
      prompt: 'a fox running',
      pollIntervalMs: 0,
      maxAttempts: 2,
      fetchFn: async () => mockResponse({
        status: 400,
        body: JSON.stringify({ code: 'INVALID_REQUEST', message: '首帧分辨率超过限制', data: null })
      })
    }),
    /创建视频任务失败: 首帧分辨率超过限制/
  );

  let callCount = 0;
  await assert.rejects(
    () => canvasVideo.executeVideoNodeTask({
      baseUrl: 'https://example.com/v1',
      apiKey: 'sk-test',
      model: 'MiniMax-H3',
      prompt: 'a fox running',
      pollIntervalMs: 0,
      maxAttempts: 2,
      fetchFn: async () => {
        callCount++;
        if (callCount === 1) {
          return mockResponse({
            ok: true,
            status: 200,
            body: JSON.stringify({ task_id: 'vid_task_1' })
          });
        }
        return mockResponse({
          ok: true,
          status: 200,
          body: JSON.stringify({ status: 'failed', code: 'UPSTREAM_400', message: '参考图解码失败' })
        });
      }
    }),
    /参考图解码失败/
  );
});

test('tool.js 生图与视频提交失败在 {code,message}、纯文本与空体下保留原因', async () => {
  await assert.rejects(
    () => tool.requestSingleImage('https://example.com/v1', 'sk-test', {
      model: 'nano-banana-2.1',
      prompt: 'test prompt',
      size: '1024x1024',
      fetchFn: async () => mockResponse({
        status: 400,
        body: JSON.stringify({ code: '400', message: '生图参数不支持当前尺寸', data: null })
      })
    }),
    /生图失败: 生图参数不支持当前尺寸/
  );

  await assert.rejects(
    () => tool.requestVideoGeneration('https://example.com/v1', 'sk-test', {
      model: 'MiniMax-H3',
      prompt: 'a bird flying',
      duration: 5,
      size: '1280x720',
      fetchFn: async () => mockResponse({
        status: 400,
        body: JSON.stringify({ code: '400', message: 'H3 插件拒绝了当前请求参数', data: null })
      })
    }),
    /创建视频任务失败: H3 插件拒绝了当前请求参数/
  );

  await assert.rejects(
    () => tool.requestVideoGeneration('https://example.com/v1', 'sk-test', {
      model: 'MiniMax-H3',
      prompt: 'a bird flying',
      duration: 5,
      size: '1280x720',
      fetchFn: async () => mockResponse({ status: 500, body: '' })
    }),
    /创建视频任务失败: HTTP 500/
  );
});
