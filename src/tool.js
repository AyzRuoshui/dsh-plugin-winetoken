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
  return (size && size.includes && size.includes('1080')) ? '1080P' : '720P';
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
async function requestSingleImage(baseUrl, apiKey, { model, prompt, size, image_url }) {
  const finalSize = normalizeImageSize(size, model);
  const payload = {
    model: model || resolveDefaultImageModel(),
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
    payload.image_url = finalImageUrl;
  }

  const endpoint = baseUrl.endsWith('/') ? `${baseUrl}images/generations` : `${baseUrl}/images/generations`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    let msg = `HTTP ${res.status}`;
    try {
      const parsed = JSON.parse(errText);
      msg = parsed.error?.message || msg;
    } catch (_) {
      if (errText) msg = errText.slice(0, 100);
    }
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
async function requestVideoGeneration(baseUrl, apiKey, { model, prompt, duration, size, image_url }) {
  const chosenModel = model || 'MiniMax-H3';
  const isGrokVideo = /grok-imagine-video/i.test(chosenModel);
  const payload = {
    model: chosenModel,
    prompt: prompt.trim(),
    seconds: duration || 5,
    duration: duration || 5,
    // Grok Imagine 视频族：xAI 仅接受 480p/720p/1080p，768P 会被上游 400 拒绝
    resolution: isGrokVideo ? resolveGrokVideoResolution(size) : ((size && size.includes('1080')) ? '1080P' : '768P')
  };

  if (image_url) {
    payload.image = image_url;
    payload.image_url = image_url;
    payload.first_frame_image = image_url;
  }

  const endpoint = baseUrl.endsWith('/') ? `${baseUrl}videos/generations` : `${baseUrl}/videos/generations`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    let msg = `HTTP ${res.status}`;
    try {
      const parsed = JSON.parse(errText);
      msg = parsed.error?.message || msg;
    } catch (_) {
      if (errText) msg = errText.slice(0, 100);
    }
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

  // 轮询最多 40 次，每次间隔 3 秒 (共最长 120 秒)
  const pollUrl = `${endpoint}/${taskId}`;
  for (let attempt = 0; attempt < 40; attempt++) {
    await new Promise(r => setTimeout(r, 3000));
    try {
      const pollRes = await fetch(pollUrl, {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      if (!pollRes.ok) continue;

      const pollData = await pollRes.json();
      const status = (pollData.status || pollData.state || '').toLowerCase();
      if (status === 'succeeded' || status === 'success') {
        const directUrl = pollData.url || (pollData.data && pollData.data[0] && pollData.data[0].url) || (pollData.output && pollData.output.url);
        if (directUrl) return directUrl;
      }
      if (status === 'failed' || status === 'error') {
        throw new Error(pollData.error?.message || pollData.message || '视频渲染失败');
      }
    } catch (pollErr) {
      if (pollErr.message.includes('视频渲染失败')) throw pollErr;
    }
  }

  throw new Error(`视频生成超时 (Task ID: ${taskId})，请稍后在创作工坊历史中查看`);
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
      description: '【WineToken 创作工坊·AI绘图工具（高耗付费操作）】仅在获得用户明确授权确认后方可调用，单次严格限出 1 张，绝对禁止并发多调。生成结果将内联渲染并存入工坊画廊。',
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
            description: '生图基底模型：留空则自动使用工坊当前可用列表中的首个限免/默认模型；也可显式指定服务端 manifest 中已上架的模型 ID（如 gpt-image-2.6-flare、gpt-image-2.6-sunburst、sensenova-u1.5-lite、grok-imagine-image-2.0、gemini-imagen-3）',
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
            error: err.message
          };
        }
      }
    });

    // 2. 注册生视频技能工具
    toolsService.register({
      name: 'winetoken_generate_video',
      label: 'WineToken 创作工坊·AI视频生成',
      category: 'creative',
      description: '【WineToken 创作工坊·AI视频生成工具（高额付费操作）】仅在获得用户明确授权确认后方可调用，单轮严格限生成 1 个视频，绝对禁止并发多调。成果直接在聊天中通过视频播放器预览并存入工坊画廊。',
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
            enum: ['MiniMax-H3', 'grok-imagine-video-1.5'],
            description: '视频基底模型：MiniMax-H3 (电影感/支持4~15秒)，grok-imagine-video-1.5 (物理真实/连贯运镜)',
            default: 'MiniMax-H3'
          },
          duration: {
            type: 'number',
            enum: [4, 5, 6, 10, 15],
            description: '视频生成时长秒数（MiniMax-H3 支持 4, 5, 6, 10, 15 秒；Grok 支持 5, 10 秒）',
            default: 5
          },
          size: {
            type: 'string',
            enum: ['1280x720', '720x1280', '1920x1080', '1080x1920'],
            description: '视频画面分辨率与横竖屏，默认为 1280x720 (720P 横屏)',
            default: '1280x720'
          },
          image_url: {
            type: 'string',
            description: '首帧参考图 URL（可选，用于首帧图生视频）'
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

    // 3. 向会话注入动态 System Prompt 指令（严格遵循付费资产保护、用户明确授权与防暴走规范）
    if (ctx.systemPrompt && typeof ctx.systemPrompt.section === 'function') {
      try {
        ctx.systemPrompt.section({
          name: 'tool:winetoken_creative',
          order: 850,
          text: () => `
## WineToken 创作工坊·高能多模态工具调用与付费资产保护铁律 (STRICT TOOL USE & ASSET PROTECTION POLICY)

你已接入 WineToken 创作工坊的专业级图像生成 (winetoken_generate_image) 与视频生成 (winetoken_generate_video) 工具。
⚠️ **最高资产警示**：每次调用生图/生视频工具均会直接扣除用户的真实钱包资产或高价值会员限时配额，属于**不可逆的高耗付费操作**！为坚决杜绝未经允许扣费与模型无节制滥调，你必须严格无条件遵守以下铁律：

### 1. 严格执行二阶段确认协议（未获明确授权，绝对严禁擅自调用）
- **第一阶段（画面构思与授权征询）**：当用户在对话中提到想画图、构思海报、想要配图或探讨视觉设计时，**严禁直接触发生成工具**！你必须先在回复中为用户规划画面构思（包含艺术风格、画面主体、镜头光影、尺寸比例等），并明确征求用户同意（例如：“生图属于付费操作，若您认可上述构思请回复‘确认生成’，我将为您正式制作”）。
- **第二阶段（单次授权调用）**：**只有当用户在对话中给出了极其明确的授权指令**（例如明确说：“确认生成”、“开始画吧”、“立即出图”、“同意制作”等肯定句）时，你才可以调用对应工具。

### 2. 严禁批量并发与单次限量铁律（绝对防暴走）
- **单轮严格限调 1 次**：在任何单次模型回复中，**绝对禁止发起多个并行的工具调用**！严禁一次性触发多次生图或视频调用！
- **单次最多生成 1 张**：生图工具的 count 参数必须始终为 1。严禁一次批量生成多张！若用户需要多种方案，必须一张生成完毕并经用户再次审阅满意后，逐轮按需生成。
- **严禁擅自追加衍生作品**：严禁在生成一张后自作主张连续生成多角度或变体画面。

### 3. 直接调用的唯一例外
- 仅当用户在**最初的提问中明确且强烈地发出了免确认出图指令**（例如：“立刻帮我画一张赛博朋克猫咪壁纸，无需向我确认，马上出图”），你才可直接调用。即使在此例外下，**也必须坚守单轮仅调 1 次、单次仅出 1 张的铁律**！
`
        });
      } catch (err) {
        console.warn('[WineToken Plugin] 注入 systemPrompt 失败:', err.message);
      }
    }

    console.log('[WineToken Plugin] [OK] 成功向 DeepSeek Harness 注入 AI 绘图与视频生成 2 大原生 Tools/Skill。');
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
  toolCircuitBreaker
};