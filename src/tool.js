// -*- coding: utf-8 -*-
/**
 * WineToken 创作工坊·大模型 Tool Calling (Skill) 技能注入引擎
 * 赋予大模型直接调用本地 DSH 创作工坊生图与生视频的能力
 * 成果可在聊天中直接预览，并全量持久化沉淀至工坊历史库
 */
const fs = require('fs');
const path = require('path');
const { homedir } = require('os');
const { addHistoryItem } = require('./history.js');
const { resolveApiKey, getResolvedBaseUrl } = require('./credentials.js');
const { resolveVideoEndpoints, extractApiErrorMessage, readResponseErrorMessage } = require('./canvas-video.js');

// 对标 infinite-canvas 的本地 Canvas Agent: 宿主侧画布状态桥 (磁盘工程文件为唯一权威)
// 可选加载，模块缺失时画布工具自动禁用，绝不拖垮既有生图/生视频工具注册
let CanvasStateBridgeClass = null;
try {
  CanvasStateBridgeClass = require('./canvas-state.js').CanvasStateBridge;
} catch (err) {
  console.warn('[WineToken Tool] 画布状态桥不可用，画布工具将禁用:', err.message);
}

const DEFAULT_BASE_URL = 'https://www.winetoken.asia/v1';

/**
 * 解析 Tool Calling 的默认生图模型。
 * host 端读不到渲染进程的 WineTokenManifestManager，只能读客户端落盘的 manifest 缓存；
 * 以服务端 enabled 为准，优先取限免模型，异常时退回当前在架的限免模型。
 */
function resolveDefaultImageModel() {
  try {
    const cacheFile = path.join(homedir(), '.dsh', 'storages', 'winetoken_manifest.json');
    if (fs.existsSync(cacheFile)) {
      const data = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      const usable = (Array.isArray(data.imageModels) ? data.imageModels : [])
        .filter(m => m && m.id && m.enabled !== false);
      const free = usable.find(m => m.price === 0 || (m.tag && String(m.tag).includes('限免')));
      const picked = free || usable[0];
      if (picked) return picked.id;
    }
  } catch (_) {}
  return 'sensenova-u1.5-lite';
}

/**
 * 会话级滑动窗口熔断器 (SessionCircuitBreaker)
 * 连续 2 次失败触发 30 秒熔断，杜绝大模型重试死循环消耗用户资产 (TOOL-01)
 */
class SessionCircuitBreaker {
  constructor() {
    this.sessions = new Map();
  }
  getRecord(sessionId = 'default') {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, { failureCount: 0, lastFailureTime: 0 });
    }
    return this.sessions.get(sessionId);
  }
  isTripped(sessionId = 'default') {
    const rec = this.getRecord(sessionId);
    if (rec.failureCount >= 2 && Date.now() - rec.lastFailureTime < 30000) return true;
    if (Date.now() - rec.lastFailureTime >= 30000) rec.failureCount = 0;
    return false;
  }
  recordFailure(sessionId = 'default') {
    const rec = this.getRecord(sessionId);
    rec.failureCount++;
    rec.lastFailureTime = Date.now();
  }
  recordSuccess(sessionId = 'default') {
    const rec = this.getRecord(sessionId);
    rec.failureCount = 0;
  }
}
const toolCircuitBreaker = new SessionCircuitBreaker();

/**
 * 图像分辨率 32 倍数智能对齐算法 (兼容商汤日日新 sensenova-u1.5-lite 等严苛引擎)
 */
function normalizeImageSize(size, model = '') {
  if (!size || typeof size !== 'string') return '1024x1024';
  const parts = size.toLowerCase().split('x');
  if (parts.length !== 2) return size;
  let w = parseInt(parts[0], 10);
  let h = parseInt(parts[1], 10);
  if (isNaN(w) || isNaN(h)) return size;

  // 1280x720 与 720x1280 经典非 32 倍数优雅映射为标准 32 倍数
  if (w === 1280 && h === 720) return '1280x768';
  if (w === 720 && h === 1280) return '768x1280';

  // Clamp 限制在 [512, 4096]
  w = Math.max(512, Math.min(4096, w));
  h = Math.max(512, Math.min(4096, h));

  // 向上/四舍五入对齐至 32 的整数倍
  if (w % 32 !== 0) w = Math.round(w / 32) * 32;
  if (h % 32 !== 0) h = Math.round(h / 32) * 32;

  return `${w}x${h}`;
}

/**
 * 获取系统配置的 API Key (已接入 credentials 统一中枢)
 */
function getApiKey() {
  const resolved = resolveApiKey({ autoAlias: true });
  return resolved.apiKey;
}

/**
 * Grok Imagine 协议适配：xAI 生图原生协议没有 size 参数（用固定档 aspect_ratio），
 * 视频 resolution 仅接受 480p/720p/1080p —— 非法参数会被上游以 400 拒绝
 */
const XAI_RATIOS = [
  { label: '1:1', v: 1 }, { label: '9:16', v: 9 / 16 }, { label: '16:9', v: 16 / 9 },
  { label: '3:4', v: 3 / 4 }, { label: '4:3', v: 4 / 3 }, { label: '2:3', v: 2 / 3 },
  { label: '3:2', v: 3 / 2 }, { label: '21:9', v: 21 / 9 }, { label: '5:2', v: 5 / 2 }
];

function snapAspectRatio(sizeStr) {
  try {
    const parts = String(sizeStr).toLowerCase().split('x');
    const w = Number(parts[0]);
    const h = Number(parts[1]);
    if (!w || !h) return '1:1';
    const r = w / h;
    let best = '1:1';
    let bestDiff = Infinity;
    for (const it of XAI_RATIOS) {
      const d = Math.abs(Math.log(r) - Math.log(it.v));
      if (d < bestDiff) { bestDiff = d; best = it.label; }
    }
    return best;
  } catch (_) { return '1:1'; }
}

function resolveGrokVideoResolution(size) {
  return (size && size.includes && size.includes('1080')) ? '1080p' : '720p';
}

/**
 * 获取 Base URL (已接入 credentials 统一中枢)
 */
function getBaseUrl() {
  return getResolvedBaseUrl();
}

/**
 * 单张生图请求核心逻辑 (并发单张调度，彻底规避上游 invalid n 与非 32 倍数尺寸错误)
 */
async function requestSingleImage(baseUrl, apiKey, { model, prompt, size, image_url, quality = '', fetchFn = (typeof fetch !== 'undefined' ? fetch : null) }) {
  if (!fetchFn) throw new Error('全局 fetch 未就绪');
  const finalSize = normalizeImageSize(size, model);
  const chosenModel = model || resolveDefaultImageModel();
  const payload = {
    model: chosenModel,
    prompt: prompt.trim(),
    n: 1,
    size: finalSize,
    response_format: 'url'
  };
  // Grok Imagine 生图族：xAI 原生协议没有 size 参数，改发最近档位 aspect_ratio，杜绝 400
  if (/grok-imagine-image/i.test(payload.model)) {
    delete payload.size;
    payload.aspect_ratio = snapAspectRatio(finalSize);
  }

  const cleanBase = baseUrl.replace(/\/+$/, '');
  let endpoint = `${cleanBase}/images/generations`;
  let reqBody = payload;
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`
  };

  if (/nano-banana-2\.1/i.test(payload.model)) {
    const q = String(quality || '').toLowerCase();
    if (q === '2k' || q === 'medium') payload.quality = 'medium';
    else if (q === '4k' || q === 'high') payload.quality = 'high';
  }

  if (image_url) {
    let finalImageUrl = image_url;
    // 本地垫图文件自动转 Base64 管道 (TOOL-02)
    if (typeof image_url === 'string' && fs.existsSync(image_url)) {
      try {
        const fileBuf = fs.readFileSync(image_url);
        const ext = path.extname(image_url).toLowerCase().replace('.', '') || 'png';
        finalImageUrl = `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${fileBuf.toString('base64')}`;
      } catch (err) {
        console.warn('[WineToken Tool] 读取本地垫图失败，降级使用原始路径:', err.message);
      }
    }
    if (/sensenova/i.test(payload.model)) {
      endpoint = `${cleanBase}/images/edits`;
      reqBody = {
        model: payload.model,
        prompt: payload.prompt,
        images: [{ image_url: finalImageUrl }],
        size: finalSize,
        n: 1,
        response_format: 'url',
        watermark: false
      };
    } else if (/gpt-image/i.test(payload.model)) {
      endpoint = `${cleanBase}/images/edits`;
      const form = new FormData();
      form.append('model', payload.model);
      form.append('prompt', payload.prompt);
      form.append('n', '1');
      form.append('size', finalSize);
      form.append('response_format', 'url');
      if (finalImageUrl.startsWith('data:')) {
        const comma = finalImageUrl.indexOf(',');
        const header = finalImageUrl.slice(0, comma);
        const mime = (header.match(/^data:([^;]+)/) || [])[1] || 'image/png';
        const bytes = Buffer.from(finalImageUrl.slice(comma + 1), 'base64');
        form.append('image', new Blob([bytes], { type: mime }), 'reference.png');
      } else {
        form.append('image_url', finalImageUrl);
      }
      reqBody = form;
      delete headers['Content-Type'];
    } else if (/nano-banana-2\.1/i.test(payload.model)) {
      endpoint = `${cleanBase}/images/generations`;
      reqBody = { ...payload, images: [{ url: finalImageUrl }] };
    } else {
      throw new Error(`当前模型 ${payload.model} 不支持参考图输入，已阻止按文生图发送`);
    }
  }

  const init = { method: 'POST', headers };
  if (reqBody instanceof FormData) init.body = reqBody;
  else {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(reqBody);
  }
  const res = await fetchFn(endpoint, init);

  if (!res.ok) {
    const msg = await readResponseErrorMessage(res);
    throw new Error(`生图失败: ${msg}`);
  }

  const data = await res.json();
  if (data.data && Array.isArray(data.data) && data.data[0]) {
    const item = data.data[0];
    return item.url || (item.b64_json ? `data:image/png;base64,${item.b64_json}` : '');
  }
  throw new Error('生图返回数据结构异常，未获取到图片直链');
}

/**
 * 视频生成请求与异步轮询任务
 */
async function requestVideoGeneration(baseUrl, apiKey, { model, prompt, duration, size, aspect_ratio = '', image_url, fetchFn = (typeof fetch !== 'undefined' ? fetch : null) }) {
  if (!fetchFn) throw new Error('全局 fetch 未就绪');
  const chosenModel = model || 'MiniMax-H3';
  const isGrokVideo = /grok-imagine-video/i.test(chosenModel);
  let resolution;
  if (/minimax-h3-2k/i.test(chosenModel)) {
    resolution = '2K';
  } else if (/minimax/i.test(chosenModel)) {
    resolution = '768P';
  } else if (isGrokVideo) {
    resolution = resolveGrokVideoResolution(size);
  } else if (/^muse-video$/i.test(chosenModel) || /^omni-1\.2-flash$/i.test(chosenModel)) {
    resolution = '720P';
  } else {
    resolution = (typeof size === 'string' && (size.includes('2K') || size.startsWith('2560') || size.startsWith('1440')))
      ? '2K'
      : ((typeof size === 'string' && size.includes('1080')) ? '1080P' : '768P');
  }

  const payload = {
    model: chosenModel,
    prompt: prompt.trim(),
    seconds: duration || 5,
    duration: duration || 5,
    resolution
  };
  if (/^muse-video$/i.test(chosenModel)) {
    // Muse 走 sora 协议: seconds 必须字符串, 画幅靠 size 表达
    payload.seconds = String(duration || 5);
    payload.size = size || '1280x720';
  }
  if (/^omni-1\.2-flash$/i.test(chosenModel)) {
    // Omni 走 hailuo 协议: seconds 保持数字, 画幅靠 size 表达 (中转层据此选横竖屏)
    payload.size = size || '1280x720';
  }
  const ratio = aspect_ratio || snapAspectRatio(size || '1280x720');
  if (isGrokVideo) {
    payload.aspect_ratio = ratio;
    delete payload.audio;
  } else if (/minimax-h3/i.test(chosenModel) && ['adaptive', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'].includes(ratio)) {
    payload.metadata = { ...(payload.metadata || {}), ratio };
  }

  if (image_url) {
    let finalImageUrl = image_url;
    // 本地首帧文件自动转 Base64 管道 (与生图工具 TOOL-02 同款)：用户给本机图片路径时直接读文件随请求发送，无需先传图床
    if (typeof image_url === 'string' && fs.existsSync(image_url)) {
      try {
        const fileBuf = fs.readFileSync(image_url);
        const ext = path.extname(image_url).toLowerCase().replace('.', '') || 'png';
        finalImageUrl = `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${fileBuf.toString('base64')}`;
      } catch (err) {
        console.warn('[WineToken Tool] 读取本地首帧图失败，降级使用原始路径:', err.message);
      }
    }
    payload.image = finalImageUrl;
    payload.image_url = finalImageUrl;
    payload.first_frame_image = finalImageUrl;
    if (/minimax|hailuo/i.test(chosenModel) || /^omni-1\.2-flash$/i.test(chosenModel)) {
      payload.metadata = { ...(payload.metadata || {}), first_frame_image: finalImageUrl };
    }
  }

  const endpoints = (typeof resolveVideoEndpoints === 'function')
    ? resolveVideoEndpoints(baseUrl, chosenModel)
    : (() => {
        const clean = (baseUrl || '').trim().replace(/\/+$/, '');
        const v1 = clean.endsWith('/v1') ? clean : `${clean}/v1`;
        const isMiniMax = /minimax|hailuo/i.test(chosenModel) || /^muse-video$/i.test(chosenModel) || /^omni-1\.2-flash$/i.test(chosenModel);
        return isMiniMax ? {
          submitUrl: `${v1}/videos`,
          pollUrl: (taskId) => `${v1}/videos/${taskId}`,
          contentUrl: (taskId) => `${v1}/videos/${taskId}/content`
        } : {
          submitUrl: `${v1}/videos/generations`,
          pollUrl: (taskId) => `${v1}/videos/generations/${taskId}`,
          contentUrl: (taskId) => `${v1}/videos/generations/${taskId}`
        };
      })();

  const res = await fetchFn(endpoints.submitUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const msg = await readResponseErrorMessage(res);
    throw new Error(`创建视频任务失败: ${msg}`);
  }

  const data = await res.json();

  // 若同步返回直链
  if (data.url || (data.data && data.data[0] && data.data[0].url)) {
    return data.url || data.data[0].url;
  }

  // 异步轮询任务 ID
  const taskId = data.task_id || data.id || (data.data && data.data.id);
  if (!taskId) {
    throw new Error('视频接口未返回任务 ID 或直接视频链接');
  }

  // 轮询最多 100 次，每次间隔 3 秒 (共最长 300 秒, 与工坊/画布一致)
  const pollUrl = endpoints.pollUrl(taskId);
  for (let attempt = 0; attempt < 100; attempt++) {
    await new Promise(r => setTimeout(r, 3000));
    try {
      const pollRes = await fetchFn(pollUrl, {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      if (!pollRes.ok) continue;

      const pollData = await pollRes.json();
      const status = (pollData.status || pollData.state || '').toLowerCase();
      if (status === 'succeeded' || status === 'success' || status === 'completed') {
        const directUrl = pollData.url || (pollData.data && pollData.data[0] && pollData.data[0].url) || (pollData.output && pollData.output.url);
        if (directUrl) return directUrl;
        // 站点轮询响应不回传成片 URL: 带鉴权到内容端点取流, 转 data URL 返回
        if (typeof endpoints.contentUrl === 'function') {
          const contentRes = await fetchFn(endpoints.contentUrl(taskId), {
            headers: { 'Authorization': `Bearer ${apiKey}` }
          });
          if (contentRes.ok) {
            const buf = Buffer.from(await contentRes.arrayBuffer());
            if (buf.length > 0) return `data:video/mp4;base64,${buf.toString('base64')}`;
          }
        }
      }
      if (status === 'failed' || status === 'error') {
        const errMsg = extractApiErrorMessage({ parsed: pollData, fallback: '视频渲染失败' });
        const pollErr = new Error(errMsg);
        pollErr.isTerminalPollFailure = true;
        throw pollErr;
      }
    } catch (pollErr) {
      if (pollErr && (pollErr.isTerminalPollFailure || (pollErr.message && pollErr.message.includes('视频渲染失败')))) throw pollErr;
    }
  }

  throw new Error(`视频生成超时 (Task ID: ${taskId})，请稍后在创作工坊历史中查看。注意: 这是等待超时而非模型不可用，必须原样向用户报告并等待指示，严禁擅自改用其他模型重新生成。`);
}

/**
 * 注册 WineToken 大模型工具体系
 */
function registerWineTokenTools(ctx) {
  const registerHandler = (toolsService) => {
    if (!toolsService || typeof toolsService.register !== 'function') return;

    // 1. 注册生图技能工具
    toolsService.register({
      name: 'winetoken_generate_image',
      label: 'WineToken 创作工坊·AI绘图',
      category: 'creative',
      description: '【WineToken 创作工坊·AI绘图工具（高耗付费操作）】仅在获得用户明确授权确认后方可调用，单次严格限出 1 张，绝对禁止并发多调。用户指定了模型时必须严格使用那一个，不得自行替换；用户未指定时才可留空自动选用工坊可用列表中的首个模型。调用失败必须原样报告并停下等待用户指示，严禁擅自改用其他模型重新生成——换模型等于换作品，必须由用户本人决定。生成结果将内联渲染并存入工坊画廊。',
      permission: 'sensitive',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: '生图详细描述词，包含画面主体、构图比例、光影色调与艺术风格（中英文均可）'
          },
          model: {
            type: 'string',
            description: '生图基底模型：留空则自动使用工坊当前可用列表中的首个限免/默认模型；也可显式指定服务端 manifest 中已上架的模型 ID（如 gpt-image-2.6-flare、gpt-image-2.6-sunburst、sensenova-u1.5-lite、grok-imagine-image-2.0、muse-image、nano-banana-2.1）。用户已指定模型时只能用该模型，不得自行替换；仅在用户未指定时才可留空自动选用',
            default: ''
          },
          size: {
            type: 'string',
            enum: ['1024x1024', '1792x1024', '1024x1792', '1280x768', '768x1280', '1280x720', '720x1280'],
            description: '输出尺寸比例：1024x1024 为正方形，1792x1024/1280x768 为横屏，1024x1792/768x1280 为竖屏 (非 32 倍数将自动智能对齐校准以兼容商汤等引擎)',
            default: '1024x1024'
          },
          count: {
            type: 'number',
            enum: [1],
            description: '出图张数，强制为 1。为保护用户资产，严禁单次批量生成。',
            default: 1
          },
          image_url: {
            type: 'string',
            description: '参考底图 URL（可选，用于垫图重绘或图生图）'
          },
          quality: {
            type: 'string',
            enum: ['1K', '2K', '4K', 'low', 'medium', 'high'],
            description: '图片画质档位；Nano Banana 将 2K/medium 映射为 medium、4K/high 映射为 high。'
          }
        },
        required: ['prompt']
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            type: { type: 'string' },
            model: { type: 'string' },
            count: { type: 'number' },
            urls: {
              type: 'array',
              items: { type: 'string' }
            },
            markdown: { type: 'string' },
            tip: { type: 'string' },
            error: { type: 'string' }
          }
        },
        render: (args, value) => [{
          type: 'text',
          text: value.markdown || (value.error ? `AI 绘图失败: ${value.error}` : JSON.stringify(value))
        }]
      },
      isConcurrencySafe: () => false,
      async execute(args) {
        const sessionId = args.session_id || 'default';
        if (toolCircuitBreaker.isTripped(sessionId)) {
          return {
            success: false,
            status: 'circuit_broken',
            error: 'Tool 调用连续失败超限，已触发 30 秒熔断保护，请告知用户稍后手动重试，切勿继续重试发包。'
          };
        }

        const apiKey = getApiKey();
        if (!apiKey) {
          return {
            success: false,
            error: '未检测到有效 API Key (已探测 WINETOKEN_API_KEY 与 ZHAIZHU_API_KEY 等别名)，请先在 WineToken 插件设置或账户设置中配置。'
          };
        }

        const baseUrl = getBaseUrl();
        const model = args.model || resolveDefaultImageModel();
        const prompt = args.prompt || '';
        const size = args.size || '1024x1024';
        // 物理级防暴走：强制单次调用只出 1 张，坚决杜绝模型批量并发消耗用户资产
        const count = 1;
        const imageUrl = args.image_url || null;

        try {
          console.log(`[WineToken Tool] 大模型触发 AI 绘画: model=${model}, count=${count}, size=${size}`);

          // 并发单张出图，彻底杜绝上游 invalid n 报错
          const tasks = Array.from({ length: count }, () =>
            requestSingleImage(baseUrl, apiKey, { model, prompt, size, image_url: imageUrl })
          );
          const urls = await Promise.all(tasks);
          const validUrls = urls.filter(u => !!u);

          if (validUrls.length === 0) {
            throw new Error('未成功生成任何有效图片');
          }

          // 自动沉淀至本地工坊画廊历史
          validUrls.forEach((url) => {
            addHistoryItem({
              type: 'image',
              model: model,
              prompt: prompt,
              url: url,
              size: size,
              source: 'llm_skill'
            });
          });

          // 构造 Markdown 高保真内联渲染输出
          const markdownImages = validUrls.map((u, idx) => `![生成画面 ${idx + 1}](${u})`).join('\n\n');
          const markdownDisplay = `${markdownImages}\n\n*基底模型: **${model}** | 分辨率: **${size}** | 已自动同步至 WineToken 创作工坊展台，可在创作工坊中以本地文件直接打开或定位*`;

          // 记录熔断器成功状态
          toolCircuitBreaker.recordSuccess(sessionId);

          return {
            success: true,
            type: 'image',
            model: model,
            count: validUrls.length,
            urls: validUrls,
            markdown: markdownDisplay,
            tip: '请直接向用户展示以上生成的图片与相关创作说明。'
          };
        } catch (err) {
          toolCircuitBreaker.recordFailure(sessionId);
          console.error('[WineToken Tool] 生图执行失败:', err.message);
          return {
            success: false,
            error: err.message + '（注意：这是本次调用失败，必须原样向用户报告并等待指示，严禁擅自改用其他模型重新生成。）'
          };
        }
      }
    });

    // 2. 注册生视频技能工具
    toolsService.register({
      name: 'winetoken_generate_video',
      label: 'WineToken 创作工坊·AI视频生成',
      category: 'creative',
      description: '【WineToken 创作工坊·AI视频生成工具（高额付费操作）】仅在获得用户明确授权确认后方可调用，单轮严格限生成 1 个视频，绝对禁止并发多调。模型必须严格使用用户指定的那一个（用户未指定时用默认 MiniMax-H3）；调用失败或超时必须原样报告并停下等待用户指示，严禁擅自改用其他模型——换模型等于换作品，必须由用户本人决定。成果直接在聊天中通过视频播放器预览并存入工坊画廊。',
      permission: 'sensitive',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: '视频内容与运镜动态描述词（提示词），包含主体动作、镜头推进、光影与氛围'
          },
          model: {
            type: 'string',
            enum: ['MiniMax-H3', 'MiniMax-H3-2K', 'grok-imagine-video-1.5', 'muse-video', 'omni-1.2-flash'],
            description: '视频基底模型：MiniMax-H3 (电影感/支持5~15秒)，MiniMax-H3-2K (2K超清/支持5~15秒)，grok-imagine-video-1.5 (物理真实/连贯运镜)，muse-video (超值/720P/支持5、6、10、15秒)，omni-1.2-flash (谷歌出品/原生音频/720P/支持3~15秒任意整数秒)。只能用用户指定的模型，不得自行替换。',
            default: 'MiniMax-H3'
          },
          duration: {
            type: 'number',
            enum: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
            description: '视频生成时长秒数（omni-1.2-flash 支持 3~15 秒任意整数；MiniMax-H3 / MiniMax-H3-2K / muse-video 支持 5, 6, 10, 15 秒；Grok 支持 5, 10 秒）',
            default: 5
          },
          size: {
            type: 'string',
            enum: ['1280x720', '720x1280', '1920x1080', '1080x1920', '2560x1440', '1440x2560'],
            description: '视频画面分辨率与横竖屏，默认为 1280x720 (720P 横屏)。2K 模型请选 2560x1440 或 1440x2560；MiniMax-H3 仅支持 720P (768P)，不推荐使用 1080P。',
            default: '1280x720'
          },
          image_url: {
            type: 'string',
            description: '首帧参考图（可选，用于首帧图生视频）：可传公网 http/https 直链，也可直接传用户本机图片的完整文件路径，本地文件会自动读取并随请求发送，无需先传图床'
          },
          aspect_ratio: {
            type: 'string',
            enum: ['16:9', '9:16', '1:1', '4:3', '3:4'],
            description: '视频画幅比例；Grok Imagine 使用 aspect_ratio，其他模型仍按各自协议传递画幅。'
          }
        },
        required: ['prompt']
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            type: { type: 'string' },
            model: { type: 'string' },
            duration: { type: 'number' },
            video_url: { type: 'string' },
            markdown: { type: 'string' },
            tip: { type: 'string' },
            error: { type: 'string' }
          }
        },
        render: (args, value) => [{
          type: 'text',
          text: value.markdown || (value.error ? `AI 绘图失败: ${value.error}` : JSON.stringify(value))
        }]
      },
      isConcurrencySafe: () => false,
      async execute(args) {
        const sessionId = args.session_id || 'default';
        if (toolCircuitBreaker.isTripped(sessionId)) {
          return {
            success: false,
            status: 'circuit_broken',
            error: 'Tool 调用连续失败超限，已触发 30 秒熔断保护，请告知用户稍后手动重试，切勿继续重试发包。'
          };
        }

        const apiKey = getApiKey();
        if (!apiKey) {
          return {
            success: false,
            error: '未检测到有效 API Key (已探测 WINETOKEN_API_KEY 与 ZHAIZHU_API_KEY 等别名)，请先在 WineToken 插件设置或账户设置中配置。'
          };
        }

        const baseUrl = getBaseUrl();
        const model = args.model || 'MiniMax-H3';
        const prompt = args.prompt || '';
        const duration = Number(args.duration) || 5;
        const size = args.size || '1280x720';
        const imageUrl = args.image_url || null;

        try {
          console.log(`[WineToken Tool] 大模型触发 AI 视频生成: model=${model}, duration=${duration}s, size=${size}`);

          const videoUrl = await requestVideoGeneration(baseUrl, apiKey, {
            model,
            prompt,
            duration,
            size,
            aspect_ratio: args.aspect_ratio || '',
            image_url: imageUrl
          });

          // 自动沉淀至本地工坊画廊历史
          addHistoryItem({
            type: 'video',
            model: model,
            prompt: prompt,
            url: videoUrl,
            size: size,
            duration: duration,
            source: 'llm_skill'
          });

          // 构造 HTML5 原生播放器控件 Markdown 输出
          const markdownDisplay = `<video src="${videoUrl}" controls width="100%" style="max-height:480px;border-radius:8px;outline:none;background:#000;"></video>\n\n*基底模型: **${model}** (${duration}秒) | 已自动同步至 WineToken 创作工坊展台，可在创作工坊中以本地文件直接打开或定位*`;

          // 记录熔断器成功状态
          toolCircuitBreaker.recordSuccess(sessionId);

          return {
            success: true,
            type: 'video',
            model: model,
            duration: duration,
            video_url: videoUrl,
            markdown: markdownDisplay,
            tip: '请直接向用户展示以上视频播放控件与运镜说明。'
          };
        } catch (err) {
          toolCircuitBreaker.recordFailure(sessionId);
          console.error('[WineToken Tool] 视频生成失败:', err.message);
          return {
            success: false,
            error: err.message
          };
        }
      }
    });

    // ==========================================
    // 3. 漫剧画布原生工具 (对标 infinite-canvas Canvas Agent / MCP)
    // 宿主进程通过磁盘工程文件桥读写画布，绝不臆测渲染进程 IPC (铁律 1)
    // ==========================================
    const canvasBridge = CanvasStateBridgeClass ? new CanvasStateBridgeClass() : null;

    if (canvasBridge) {
      // 3.1 只读: 感知当前故事板 (safe，不触发付费熔断器)
      toolsService.register({
        name: 'winetoken_canvas_get_storyboard',
        label: 'WineToken 漫剧画布·读取故事板',
        category: 'canvas',
        description: '【只读工具】读取当前漫剧画布工程的角色、分镜、节点、连线与模型摘要，用于在对话中感知用户正在创作的内容。不产生任何扣费，可随时调用。',
        permission: 'safe',
        parameters: { type: 'object', properties: {}, required: [] },
        output: {
          schema: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              totalPanels: { type: 'number' },
              characters: { type: 'array' },
              panels: { type: 'array' },
              markdown: { type: 'string' },
              error: { type: 'string' }
            }
          },
          render: (args, value) => [{ type: 'text', text: value.markdown || (value.error ? `读取画布失败: ${value.error}` : JSON.stringify(value)) }]
        },
        isConcurrencySafe: () => true,
        async execute() {
          try {
            const sb = canvasBridge.getStoryboard();
            const panelLines = sb.panels.map(p =>
              `- 镜${p.num === null ? '?' : p.num} [${p.shot || 'MS'}] ${p.prompt || '(空提示词)'}${p.hasImage ? ' (已出图)' : ''}${p.dialogue ? ' | 台词:' + p.dialogue : ''}`
            ).join('\n');
            const charLines = sb.characters.map(c => `- ${c.name} (${c.id})`).join('\n');
            const markdown = [
              `## 当前漫剧画布故事板 (工程 ${sb.projectId || 'legacy'})`,
              '',
              `分镜 ${sb.totalPanels} 格 | 通用节点 ${sb.totalItems} 个 | 连线 ${sb.totalEdges} 条 | 分组 ${sb.totalGroups} 个 | 生图模型: ${sb.activeModel || '默认'}`,
              '',
              '### 角色', charLines || '(暂无角色)',
              '',
              '### 分镜', panelLines || '(暂无分镜)'
            ].join('\n');
            return { success: true, totalPanels: sb.totalPanels, characters: sb.characters, panels: sb.panels, markdown };
          } catch (err) {
            return { success: false, error: err.message };
          }
        }
      });

      // 3.2 写入: 追加分镜 (写工程但不扣费，仍需人工确认防误改)
      toolsService.register({
        name: 'winetoken_canvas_add_panel',
        label: 'WineToken 漫剧画布·追加分镜',
        category: 'canvas',
        description: '【写入工具·不扣费】向当前漫剧画布工程追加一格分镜卡（自动续排镜号与坐标）。仅写入本地工程文件，不触发 AI 生成、不产生任何费用。修改后画布会在下次刷新/轮询时水合显示。需要用户在对话中明确同意修改画布。',
        permission: 'sensitive',
        parameters: {
          type: 'object',
          properties: {
            prompt: { type: 'string', description: '该分镜的画面描述/提示词' },
            dialogue: { type: 'string', description: '该分镜的角色台词 (可选)' },
            shot: { type: 'string', enum: ['CU', 'MS', 'WS', 'FS'], description: '景别: 特写/中景/远景/全景，默认 MS', default: 'MS' },
            characterId: { type: 'string', description: '关联角色 id (可选，可先用 get_storyboard 查询)' },
            aspectRatio: { type: 'string', enum: ['2:3', '16:9', '1:1'], description: '画幅比例，默认 2:3', default: '2:3' }
          },
          required: ['prompt']
        },
        output: {
          schema: {
            type: 'object',
            properties: {
              success: { type: 'boolean' }, panelId: { type: 'string' },
              num: { type: 'number' }, markdown: { type: 'string' }, error: { type: 'string' }
            }
          },
          render: (args, value) => [{ type: 'text', text: value.markdown || (value.error ? `追加分镜失败: ${value.error}` : JSON.stringify(value)) }]
        },
        isConcurrencySafe: () => false,
        async execute(args) {
          try {
            const result = canvasBridge.addPanel({
              prompt: args.prompt || '', dialogue: args.dialogue || '',
              shot: args.shot || 'MS', characterId: args.characterId || '',
              aspectRatio: args.aspectRatio || '2:3'
            });
            toolCircuitBreaker.recordSuccess(args.session_id || 'default');
            return {
              success: true,
              panelId: result.panel.id,
              num: result.panel.num,
              markdown: `已在漫剧画布追加第 ${result.panel.num} 格分镜 (${result.panel.shotLabel})，提示词: ${result.panel.prompt || '(空)'}。画布将在下次水合刷新后显示。`
            };
          } catch (err) {
            // 写盘失败真实透传，但不计入「付费调用失败」熔断计数
            return { success: false, error: err.message };
          }
        }
      });

      // 3.3 生成入队: 只写 WAL 存根，绝不宿主直发付费请求 (杜绝双花)
      toolsService.register({
        name: 'winetoken_canvas_generate',
        label: 'WineToken 漫剧画布·排队生成',
        category: 'canvas',
        description: '【付费操作·仅入队】为指定分镜排队一次 AI 生成。本工具只把任务写入本地 WAL 存根，由画布前端消费执行真实请求，宿主绝不直接发包扣费，杜绝双花。调用前必须获得用户明确授权；单次仅入队 1 个任务。',
        permission: 'sensitive',
        parameters: {
          type: 'object',
          properties: {
            panelId: { type: 'string', description: '目标分镜 id (可先用 get_storyboard 查询)' },
            prompt: { type: 'string', description: '覆盖提示词 (可选，留空则用分镜现有提示词)' },
            kind: { type: 'string', enum: ['image', 'video'], description: '生成类型，默认 image', default: 'image' },
            model: { type: 'string', description: '模型 id (可选，留空用画布当前模型)' }
          },
          required: ['panelId']
        },
        output: {
          schema: {
            type: 'object',
            properties: {
              success: { type: 'boolean' }, taskId: { type: 'string' },
              status: { type: 'string' }, markdown: { type: 'string' }, error: { type: 'string' }
            }
          },
          render: (args, value) => [{ type: 'text', text: value.markdown || (value.error ? `排队失败: ${value.error}` : JSON.stringify(value)) }]
        },
        isConcurrencySafe: () => false,
        async execute(args) {
          const sessionId = args.session_id || 'default';
          if (toolCircuitBreaker.isTripped(sessionId)) {
            return { success: false, status: 'circuit_broken', error: '画布生成工具连续失败超限，已触发 30 秒熔断保护，请告知用户稍后手动重试。' };
          }
          try {
            const queued = canvasBridge.enqueueGeneration({
              panelId: args.panelId || '', prompt: args.prompt || '',
              kind: args.kind === 'video' ? 'video' : 'image', model: args.model || ''
            });
            toolCircuitBreaker.recordSuccess(sessionId);
            return {
              success: true, taskId: queued.taskId, status: queued.status,
              markdown: `已把 ${args.kind === 'video' ? '视频' : '图片'} 生成任务 ${queued.taskId} 排入画布队列，等待画布前端执行。任务仅入队，尚未产生扣费。`
            };
          } catch (err) {
            toolCircuitBreaker.recordFailure(sessionId);
            return { success: false, error: err.message };
          }
        }
      });
    }

    // 4. 向会话注入动态 System Prompt 指令（严格遵循付费资产保护、用户明确授权与防暴走规范）
    if (ctx.systemPrompt && typeof ctx.systemPrompt.section === 'function') {
      try {
        ctx.systemPrompt.section({
          name: 'tool:winetoken_creative',
          order: 850,
          text: () => `
## WineToken 创作工坊·高能多模态工具调用与付费资产保护铁律 (STRICT TOOL USE & ASSET PROTECTION POLICY)

你已接入 WineToken 创作工坊的专业级图像生成 (winetoken_generate_image) 与视频生成 (winetoken_generate_video) 工具，
以及漫剧画布协作工具 (winetoken_canvas_get_storyboard 只读 / winetoken_canvas_add_panel 写入不扣费 / winetoken_canvas_generate 付费入队)。
[资产警示] **最高资产警示**：每次调用生图/生视频工具均会直接扣除用户的真实钱包资产或高价值会员限时配额，属于**不可逆的高耗付费操作**！为坚决杜绝未经允许扣费与模型无节制滥调，你必须严格无条件遵守以下铁律：

### 1. 严格执行二阶段确认协议（未获明确授权，绝对严禁擅自调用）
- **第一阶段（画面构思与授权征询）**：当用户在对话中提到想画图、构思海报、想要配图或探讨视觉设计时，**严禁直接触发生成工具**！你必须先在回复中为用户规划画面构思（包含艺术风格、画面主体、镜头光影、尺寸比例等），并明确征求用户同意（例如：“生图属于付费操作，若您认可上述构思请回复‘确认生成’，我将为您正式制作”）。
- **第二阶段（单次授权调用）**：**只有当用户在对话中给出了极其明确的授权指令**（例如明确说：“确认生成”、“开始画吧”、“立即出图”、“同意制作”等肯定句）时，你才可以调用对应工具。

### 2. 严禁批量并发与单次限量铁律（绝对防暴走）
- **单轮严格限调 1 次**：在任何单次模型回复中，**绝对禁止发起多个并行的工具调用**！严禁一次性触发多次生图或视频调用！
- **单次最多生成 1 张**：生图工具的 count 参数必须始终为 1。严禁一次批量生成多张！若用户需要多种方案，必须一张生成完毕并经用户再次审阅满意后，逐轮按需生成。
- **严禁擅自追加衍生作品**：严禁在生成一张后自作主张连续生成多角度或变体画面。

### 3. 直接调用的唯一例外
- 仅当用户在**最初的提问中明确且强烈地发出了免确认出图指令**（例如：“立刻帮我画一张赛博朋克猫咪壁纸，无需向我确认，马上出图”），你才可直接调用。即使在此例外下，**也必须坚守单轮仅调 1 次、单次仅出 1 张的铁律**！
- **画布生成工具 (winetoken_canvas_generate)**：仅把任务排入本地 WAL 队列，真实扣费由画布前端执行；同样必须遵守「单轮仅 1 次、先征询授权再调用」。切勿连续入队多个任务。
- **画布写入工具 (winetoken_canvas_add_panel)**：不扣费但会修改用户工程文件，仍须用户明确同意后才能调用。
- **画布读取工具 (winetoken_canvas_get_storyboard)**：只读、零费用，可随时调用以感知画布内容。
`
        });
      } catch (err) {
        console.warn('[WineToken Plugin] 注入 systemPrompt 失败:', err.message);
      }
    }

    console.log('[WineToken Plugin] [OK] 成功注入 AI 绘图/视频生成/画布协作 共 5 大原生 Tools/Skill。');
  };

  let unregister = () => {};

  // 支持直接注入与延迟注入
  if (ctx.tools) {
    registerHandler(ctx.tools);
  } else if (typeof ctx.inject === 'function') {
    ctx.inject(['tools'], (injectedCtx) => {
      registerHandler(injectedCtx.tools);
    });
  }

  return unregister;
}

module.exports = {
  registerWineTokenTools,
  SessionCircuitBreaker,
  toolCircuitBreaker,
  requestSingleImage,
  requestVideoGeneration,
  resolveGrokVideoResolution
};
