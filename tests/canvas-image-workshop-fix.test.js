// -*- coding: utf-8 -*-
/**
 * 图像工坊垫图路由与历史去串图修复契约测试
 * 1. sensenova 有垫图时请求打到 edits 且 body 形状正确（images[0].image_url 为 Data URL、watermark=false）
 * 2. gpt-image 有垫图时走 multipart edits
 * 3. 无垫图 generations 的 payload 里不含任何图字段
 * 4. 不支持模型 + 有垫图时被拦截不发请求
 * 5. 历史条目 id 唯一且回写只命中一条
 * 全部 mock fetch，绝不发任何真实网络请求。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

// 初始化宿主环境桩 (供 client.js 加载)
if (typeof global.window === 'undefined') {
  const store = new Map();
  global.window = {
    __ModuleLoader__: { load() {} },
    addEventListener() {},
    removeEventListener() {},
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k)
    }
  };
  global.document = {
    createElement: () => ({ style: {}, appendChild() {} }),
    head: { appendChild() {} },
    addEventListener() {},
    removeEventListener() {},
    documentElement: { className: '', getAttribute: () => null }
  };
  global.localStorage = global.window.localStorage;
}

const {
  validateImageModelSupport,
  buildImageRequest,
  sendImageRequest,
  createStudioHistoryItem,
  updateHistoryLocalPath,
  dataURLtoFile
} = require('../src/client.js');

const SAMPLE_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

test('① sensenova 有垫图时请求打到 edits 且 body 形状正确 (images[0].image_url 为 Data URL, watermark=false)', async () => {
  let capturedCall = null;
  const mockFetch = async (url, options) => {
    capturedCall = { url, options };
    return {
      ok: true,
      json: async () => ({
        created: 1795350000,
        data: [{ url: 'https://sensenova.cn/output/edited_sample.png' }]
      })
    };
  };

  const resp = await sendImageRequest({
    baseUrl: 'https://www.winetoken.asia',
    apiKey: 'sk-test-sensenova-key',
    model: 'sensenova-u1.5-lite',
    prompt: '帮我更改右下角名字为学生单人套餐，价位为65.9',
    size: '1792x1024',
    n: 1,
    referenceSlots: [{ dataUrl: SAMPLE_DATA_URL }],
    fetchFn: mockFetch
  });

  assert.ok(capturedCall, '必须发起网络请求');
  assert.equal(capturedCall.url, 'https://www.winetoken.asia/v1/images/edits', '端点必须路由到 /v1/images/edits');
  assert.equal(capturedCall.options.method, 'POST');
  assert.equal(capturedCall.options.headers['Content-Type'], 'application/json', '商汤 edits 必须是 application/json 报文头');
  assert.equal(capturedCall.options.headers['Authorization'], 'Bearer sk-test-sensenova-key');

  const body = JSON.parse(capturedCall.options.body);
  assert.equal(body.model, 'sensenova-u1.5-lite');
  assert.equal(body.prompt, '帮我更改右下角名字为学生单人套餐，价位为65.9');
  assert.equal(body.size, '1792x1024');
  assert.equal(body.response_format, 'url');
  assert.equal(body.watermark, false, 'watermark 必须显式为 false (去水印)');
  assert.ok(Array.isArray(body.images), 'images 必须为数组');
  assert.equal(body.images.length, 1);
  assert.equal(body.images[0].image_url, SAMPLE_DATA_URL, 'images[0].image_url 必须为完整 Data URL 前缀');

  // 验证返回解析正常
  assert.equal(resp.data[0].url, 'https://sensenova.cn/output/edited_sample.png');
});

test('①.1 sensenova 垫图超过 5 张时严格截断并使用 auto 兜底尺寸', () => {
  const sixSlots = Array.from({ length: 6 }, (_, i) => ({ dataUrl: `${SAMPLE_DATA_URL}&idx=${i}` }));
  const req = buildImageRequest({
    baseUrl: 'https://www.winetoken.asia',
    apiKey: 'sk-test',
    model: 'sensenova-u1.5-lite',
    prompt: '多图测试',
    size: '', // 未选尺寸
    n: 1,
    referenceSlots: sixSlots
  });

  assert.equal(req.url, 'https://www.winetoken.asia/v1/images/edits');
  const body = JSON.parse(req.body);
  assert.equal(body.images.length, 5, '超过 5 张必须严格截断至 5 张上限');
  assert.equal(body.size, 'auto', '未传尺寸时必须自适应 auto');
  assert.equal(body.watermark, false);
});

test('② gpt-image 有垫图时走 multipart edits', async () => {
  let capturedCall = null;
  const mockFetch = async (url, options) => {
    capturedCall = { url, options };
    return {
      ok: true,
      json: async () => ({
        created: 1795350000,
        data: [{ url: 'https://ai.huanling.icu/images/edits/result.png' }]
      })
    };
  };

  const resp = await sendImageRequest({
    baseUrl: 'https://www.winetoken.asia',
    apiKey: 'sk-test-gpt-key',
    model: 'gpt-image-2.6-sunburst',
    prompt: '修改为学生单人套餐',
    size: '1024x1024',
    n: 1,
    referenceSlots: [{ dataUrl: SAMPLE_DATA_URL }],
    fetchFn: mockFetch
  });

  assert.ok(capturedCall, '必须发起网络请求');
  assert.equal(capturedCall.url, 'https://www.winetoken.asia/v1/images/edits', '端点必须路由到 /v1/images/edits');
  assert.equal(capturedCall.options.method, 'POST');
  assert.equal(capturedCall.options.headers['Authorization'], 'Bearer sk-test-gpt-key');
  assert.equal(capturedCall.options.headers['Content-Type'], undefined, 'multipart 请求不得显式指定 Content-Type 以保留 boundary');

  const formData = capturedCall.options.body;
  assert.ok(formData && typeof formData.get === 'function', '请求体必须是 FormData 实例');
  assert.equal(formData.get('model'), 'gpt-image-2.6-sunburst');
  assert.equal(formData.get('prompt'), '修改为学生单人套餐');
  assert.equal(formData.get('n'), '1');
  assert.equal(formData.get('size'), '1024x1024');
  assert.equal(formData.get('response_format'), 'url');

  const imageField = formData.get('image');
  assert.ok(imageField, 'FormData 必须包含 image 字段');
  assert.ok(imageField.size > 0, 'image 字段必须是有效二进制 Blob/File');

  assert.equal(resp.data[0].url, 'https://ai.huanling.icu/images/edits/result.png');
});

test('③ 无垫图 generations 的 payload 里不含任何图字段', async () => {
  let capturedCall = null;
  const mockFetch = async (url, options) => {
    capturedCall = { url, options };
    return {
      ok: true,
      json: async () => ({
        created: 1795350000,
        data: [{ url: 'https://winetoken.asia/gen.png' }]
      })
    };
  };

  await sendImageRequest({
    baseUrl: 'https://www.winetoken.asia',
    apiKey: 'sk-test-key',
    model: 'sensenova-u1.5-lite',
    prompt: '纯文生图：金黄秋天银杏树林',
    size: '1024x1024',
    n: 1,
    referenceSlots: [],
    fetchFn: mockFetch
  });

  assert.ok(capturedCall);
  assert.equal(capturedCall.url, 'https://www.winetoken.asia/v1/images/generations', '无垫图必须走 /v1/images/generations');
  assert.equal(capturedCall.options.headers['Content-Type'], 'application/json');

  const body = JSON.parse(capturedCall.options.body);
  assert.equal(body.model, 'sensenova-u1.5-lite');
  assert.equal(body.prompt, '纯文生图：金黄秋天银杏树林');
  assert.equal(body.size, '1024x1024');
  assert.equal(body.n, 1);
  assert.equal(body.response_format, 'url');

  // 严苛契约校验：坚决彻底剔除任何散弹枪图字段
  assert.equal('image' in body, false, 'payload 绝不包含 image 字段');
  assert.equal('image_url' in body, false, 'payload 绝不包含 image_url 字段');
  assert.equal('reference_image' in body, false, 'payload 绝不包含 reference_image 字段');
  assert.equal('images' in body, false, 'payload 绝不包含 images 字段');
});

test('③.1 grok-imagine-image 无垫图时保留 aspect_ratio 转换且不塞图字段', () => {
  const req = buildImageRequest({
    baseUrl: 'https://www.winetoken.asia',
    apiKey: 'sk-test',
    model: 'grok-imagine-image-2.0',
    prompt: '赛博街道',
    size: '1792x1024', // 接近 16:9
    n: 1,
    referenceSlots: []
  });

  assert.equal(req.url, 'https://www.winetoken.asia/v1/images/generations');
  const body = JSON.parse(req.body);
  assert.equal(body.model, 'grok-imagine-image-2.0');
  assert.equal('size' in body, false, 'grok 必须剔除 size');
  assert.equal(body.aspect_ratio, '16:9', 'grok 必须转换为最近档位 aspect_ratio');
  assert.equal('image' in body, false);
  assert.equal('image_url' in body, false);
});

test('④ 不支持模型 + 有垫图时被拦截不发请求', async () => {
  // 1. 能力校验函数拦截
  const checkGrok = validateImageModelSupport('grok-imagine-image-2.0', true);
  assert.equal(checkGrok.supported, false);
  assert.match(checkGrok.error, /当前模型不支持垫图改图/);

  const checkGemini = validateImageModelSupport('gemini-imagen-3', true);
  assert.equal(checkGemini.supported, false);

  const checkNoRef = validateImageModelSupport('grok-imagine-image-2.0', false);
  assert.equal(checkNoRef.supported, true, '无垫图时支持文生图');

  // 2. 发包管道拦截且零网络请求
  let fetchCalls = 0;
  const mockFetch = async () => {
    fetchCalls++;
    return { ok: true, json: async () => ({}) };
  };

  await assert.rejects(
    async () => {
      await sendImageRequest({
        baseUrl: 'https://www.winetoken.asia',
        apiKey: 'sk-test',
        model: 'grok-imagine-image-2.0',
        prompt: '修改海报',
        size: '1024x1024',
        n: 1,
        referenceSlots: [{ dataUrl: SAMPLE_DATA_URL }],
        fetchFn: mockFetch
      });
    },
    /当前模型不支持垫图改图/
  );

  assert.equal(fetchCalls, 0, '不支持模型有垫图时绝对不发起任何网络请求');
});

test('⑤ 历史条目 id 唯一且回写只命中一条 (根除 undefined===undefined 串图)', () => {
  // 1. 唯一 ID 与时间戳生成验证
  const item1 = createStudioHistoryItem({
    url: 'https://cdn.com/1.png',
    prompt: '海报 1',
    model: 'gpt-image-2.6-sunburst',
    size: '1024x1024',
    hasRef: true,
    type: 'image'
  });
  const item2 = createStudioHistoryItem({
    url: 'https://cdn.com/2.png',
    prompt: '海报 2',
    model: 'sensenova-u1.5-lite',
    size: '1792x1024',
    hasRef: true,
    type: 'image'
  });
  const item3 = createStudioHistoryItem({
    url: 'https://cdn.com/3.png',
    prompt: '海报 3',
    model: 'gpt-image-2.6-sunburst',
    size: '1024x1024',
    hasRef: true,
    type: 'image'
  });

  assert.ok(item1.id && item1.id.startsWith('img_'));
  assert.ok(item2.id && item2.id.startsWith('img_'));
  assert.ok(item3.id && item3.id.startsWith('img_'));
  assert.notEqual(item1.id, item2.id);
  assert.notEqual(item2.id, item3.id);
  assert.ok(typeof item1.createdAt === 'number' && item1.createdAt > 0);

  // 2. 视频项 ID 验证
  const vidItem = createStudioHistoryItem({
    url: 'https://cdn.com/v.mp4',
    prompt: '长街雨夜',
    model: 'MiniMax-H3',
    size: '768P',
    duration: 5,
    type: 'video'
  });
  assert.ok(vidItem.id && vidItem.id.startsWith('vid_'));
  assert.equal(vidItem.type, 'video');

  // 3. 历史回写精确匹配：仅更新被选中的 item2，item1 与 item3 保持不动
  const initialHistory = [item1, item2, item3];
  const updatedHistory = updateHistoryLocalPath(initialHistory, item2, '/Pictures/WineToken/local_item2.png');

  assert.equal(updatedHistory.length, 3);
  assert.equal(updatedHistory[1].localPath, '/Pictures/WineToken/local_item2.png', '选中的 item2 必须更新 localPath');
  assert.equal(updatedHistory[0].localPath, undefined, 'item1 绝不被串线覆盖');
  assert.equal(updatedHistory[2].localPath, undefined, 'item3 绝不被串线覆盖');

  // 4. 旧数据兼容与防御：即使 item 没有 id，也不能触发 undefined===undefined 批量误杀
  const legacy1 = { url: 'https://cdn.com/legacy1.png', prompt: '旧记录 1' };
  const legacy2 = { url: 'https://cdn.com/legacy2.png', prompt: '旧记录 2' };
  const legacyUpdated = updateHistoryLocalPath([legacy1, legacy2], legacy1, '/local/legacy1.png');

  assert.equal(legacyUpdated[0].localPath, '/local/legacy1.png');
  assert.equal(legacyUpdated[1].localPath, undefined, '无 id 的旧条目间绝对不能因 undefined===undefined 互相覆盖');
});
