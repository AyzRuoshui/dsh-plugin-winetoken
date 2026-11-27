// -*- coding: utf-8 -*-
/**
 * WineToken 漫剧画布视频节点状态机 (CanvasVideo)
 * 对位上游 infinite-canvas 的 video 节点 + 异步任务轮询，但按 DSH 实际拆为：
 *   - 纯函数: 模型能力描述 / 提示词编译 / 载荷构建 / 提交与轮询归约 / 体积预算守卫 (本模块，可 node --test)
 *   - 副作用: 离屏轻量化压缩与经注入 fetchFn 执行的提交/轮询编排
 * 零依赖、零 fs/网络/DOM 顶层依赖、无动态代码执行。
 */

const VIDEO_STATUS = Object.freeze({
  IDLE: 'idle',
  SUBMITTING: 'submitting',
  POLLING: 'polling',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  TIMEOUT: 'timeout'
});

const DEFAULT_MAX_ATTEMPTS = 100;      // 与 StudioPage 一致: 3 秒 × 100 = 300 秒
const DEFAULT_POLL_INTERVAL_MS = 3000;
const TERMINAL_STATUSES = Object.freeze(['succeeded', 'failed', 'cancelled', 'timeout']);
const MAX_VIDEO_REF_TOTAL_BYTES = 40 * 1024 * 1024; // 40MB 参考图总载荷硬上限，防止网关 413
const DEFAULT_IMAGE_MAX_EDGE = 2048;
const DEFAULT_IMAGE_QUALITY = 0.88;
const DEFAULT_IMAGE_COMPRESS_THRESHOLD_BYTES = 1.5 * 1024 * 1024;
const H3_ALLOWED_RATIOS = new Set(['adaptive', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16']);

function normalizeV1Base(url) {
  const clean = (url || '').trim().replace(/\/+$/, '');
  return clean.endsWith('/v1') ? clean : `${clean}/v1`;
}

function resolveVideoEndpoints(baseUrl, model = '') {
  const v1 = normalizeV1Base(baseUrl);
  const isMiniMax = /minimax|hailuo/i.test(model) || /^omni-1\.2-flash$/i.test(model);
  if (/^muse-video$/i.test(model)) {
    // Muse 视频走 New-API 内置 sora 插件的标准 /v1/videos 任务协议
    return {
      submitUrl: `${v1}/videos`,
      pollUrl: (taskId) => `${v1}/videos/${taskId}`,
      contentUrl: (taskId) => `${v1}/videos/${taskId}/content`,
      protocol: 'sora-videos'
    };
  }
  if (isMiniMax) {
    return {
      submitUrl: `${v1}/videos`,
      pollUrl: (taskId) => `${v1}/videos/${taskId}`,
      contentUrl: (taskId) => `${v1}/videos/${taskId}/content`,
      protocol: 'minimax-videos'
    };
  }
  return {
    submitUrl: `${v1}/videos/generations`,
    pollUrl: (taskId) => `${v1}/videos/generations/${taskId}`,
    contentUrl: (taskId) => `${v1}/videos/generations/${taskId}`,
    protocol: 'standard-generations'
  };
}

/**
 * 统一视频模型能力描述符，供 StudioPage 与画布工作台共用。
 */
function getVideoModelCapabilities(model = '') {
  const chosen = typeof model === 'string' && model.trim() ? model.trim() : 'MiniMax-H3';
  const protocol = resolveVideoEndpoints('', chosen).protocol;
  if (/minimax-h3/i.test(chosen)) {
    return {
      model: chosen,
      protocol,
      supportsMultiRef: true,
      maxRefImages: 9,
      multiRefExclusiveWithFirstFrame: true,
      refField: 'metadata.content',
      disallowImagesArray: true,
      durations: /minimax-h3-2k/i.test(chosen) ? [5, 6, 10, 15] : [4, 5, 6, 10, 15],
      resolutions: /minimax-h3-2k/i.test(chosen) ? ['2K'] : ['720P'],
      aspectRatios: ['adaptive', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16']
    };
  }
  if (/^omni-1\.2-flash$/i.test(chosen)) {
    return {
      model: chosen,
      protocol,
      supportsMultiRef: true,
      maxRefImages: 3,
      multiRefExclusiveWithFirstFrame: false,
      refField: 'metadata.reference_images',
      disallowImagesArray: true,
      durations: Array.from({ length: 13 }, (_, i) => i + 3),
      resolutions: ['720P'],
      aspectRatios: ['16:9', '9:16']
    };
  }
  if (/^muse-video$/i.test(chosen)) {
    return {
      model: chosen,
      protocol,
      supportsMultiRef: false,
      maxRefImages: 1,
      multiRefExclusiveWithFirstFrame: false,
      refField: 'image_url',
      disallowImagesArray: true,
      durations: [5, 6, 10, 15],
      resolutions: ['720P'],
      aspectRatios: ['16:9', '9:16']
    };
  }
  if (/grok-imagine-video/i.test(chosen)) {
    return {
      model: chosen,
      protocol,
      supportsMultiRef: false,
      maxRefImages: 1,
      multiRefExclusiveWithFirstFrame: false,
      refField: 'image_url',
      disallowImagesArray: true,
      durations: [5, 10],
      resolutions: ['720P', '1080P'],
      aspectRatios: ['16:9', '9:16', '1:1']
    };
  }
  return {
    model: chosen,
    protocol,
    supportsMultiRef: false,
    maxRefImages: 1,
    multiRefExclusiveWithFirstFrame: false,
    refField: protocol === 'minimax-videos' ? 'metadata.first_frame_image' : 'image_url',
    disallowImagesArray: true,
    durations: [5],
    resolutions: ['720P'],
    aspectRatios: ['16:9', '9:16']
  };
}

function snapVideoAspectRatio(size = '') {
  const ratios = [
    ['adaptive', 1], ['21:9', 21 / 9], ['16:9', 16 / 9], ['4:3', 4 / 3],
    ['1:1', 1], ['3:4', 3 / 4], ['9:16', 9 / 16]
  ];
  const match = String(size).match(/^(\d{2,5})\s*[xX]\s*(\d{2,5})$/);
  if (!match) return '16:9';
  const value = Number(match[1]) / Math.max(1, Number(match[2]));
  let best = '16:9';
  let distance = Infinity;
  for (const [label, ratio] of ratios) {
    if (label === 'adaptive') continue;
    const next = Math.abs(Math.log(value) - Math.log(ratio));
    if (next < distance) { best = label; distance = next; }
  }
  return best;
}

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** 从提交响应里抽出「直接视频 URL」或「任务 ID」，兼容多级 data 嵌套 (实测协议) */
function parseSubmitResponse(payload) {
  if (!isObject(payload)) return { directUrl: '', taskId: '', error: '提交响应不是合法对象' };
  const directUrl = firstString(
    payload.url,
    payload.video_url,
    nestedUrl(payload.data),
    nestedUrl(payload.output)
  );
  const taskId = firstString(
    payload.task_id, payload.id, payload.taskId,
    isObject(payload.data) ? (payload.data.task_id || payload.data.id) : '',
    isObject(payload.output) ? (payload.output.task_id || payload.output.id) : ''
  );
  if (!directUrl && !taskId) return { directUrl: '', taskId: '', error: '视频接口未返回任务 ID 或直接视频链接' };
  return { directUrl, taskId, error: '' };
}

function nestedUrl(node) {
  if (Array.isArray(node)) {
    const first = node[0];
    return isObject(first) ? firstString(first.url, first.video_url) : '';
  }
  if (!isObject(node)) return '';
  const first = Array.isArray(node.data) ? node.data[0] : null;
  return firstString(
    node.url, node.video_url,
    nestedUrl(node.data),
    isObject(first) ? (first.url || first.video_url) : ''
  );
}

function firstString(...vals) {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
  }
  return '';
}

const MAX_ERROR_TEXT_LEN = 200;

function truncateErrorText(text, maxLen = MAX_ERROR_TEXT_LEN) {
  if (typeof text !== 'string') return '';
  const trimmed = text.trim();
  if (!trimmed) return '';
  return trimmed.length > maxLen ? trimmed.slice(0, maxLen) : trimmed;
}

/**
 * 按优先级提取接口失败错误文案：
 * 1. parsed.error?.message
 * 2. parsed.message（顶层）
 * 3. parsed.error_msg / parsed.msg
 * 4. 原始响应文本截断
 * 5. HTTP <status>
 */
function extractApiErrorMessage({ parsed = null, rawText = '', status = null, fallback = '' } = {}) {
  let obj = parsed;
  if (!obj && typeof rawText === 'string' && rawText.trim()) {
    try {
      const candidate = JSON.parse(rawText);
      if (isObject(candidate)) obj = candidate;
    } catch (_) {}
  }

  if (isObject(obj)) {
    const structuredMsg = firstString(
      isObject(obj.error) ? obj.error.message : '',
      obj.message,
      obj.error_msg,
      obj.msg
    );
    if (structuredMsg) return structuredMsg;
  }

  const truncated = truncateErrorText(rawText);
  if (truncated) return truncated;

  if (status) return `HTTP ${status}`;
  return firstString(fallback);
}

/** 从 Fetch Response 读取文本并按统一优先级提取错误文案 */
async function readResponseErrorMessage(res, fallback = '') {
  let rawText = '';
  let textReadOk = false;
  let parsed = null;
  if (res && typeof res.text === 'function') {
    try {
      rawText = await res.text();
      textReadOk = true;
    } catch (_) {}
  }
  if (!textReadOk && res && typeof res.json === 'function') {
    try {
      const candidate = await res.json();
      if (isObject(candidate)) parsed = candidate;
    } catch (_) {}
  }
  return extractApiErrorMessage({
    parsed,
    rawText,
    status: res ? res.status : null,
    fallback
  });
}

/**
 * 轮询状态归约: 输入一次轮询响应，输出推进后的状态。
 * 返回 { status, videoUrl, error, done } —— done=true 时调用方应停止轮询。
 */
function reducePollResponse(payload, attempt = 1, maxAttempts = DEFAULT_MAX_ATTEMPTS, contentUrl = '') {
  const at = Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 1;
  const cap = Number.isFinite(maxAttempts) && maxAttempts > 0 ? Math.floor(maxAttempts) : DEFAULT_MAX_ATTEMPTS;
  if (!isObject(payload)) {
    return { status: VIDEO_STATUS.POLLING, videoUrl: '', error: '', done: false };
  }
  const rawStatus = firstString(payload.status, payload.state, payload.task_status).toLowerCase();
  const url = nestedUrl(payload) || nestedUrl(payload.data) || nestedUrl(payload.output);

  if (rawStatus === 'succeeded' || rawStatus === 'success' || rawStatus === 'completed') {
    if (url) return { status: VIDEO_STATUS.SUCCEEDED, videoUrl: url, error: '', done: true };
    // 站点轮询响应不带成片 URL: 成片在协议的内容端点, 以其为地址收口 (取流需鉴权, 由调用方负责)
    const fallbackUrl = typeof contentUrl === 'string' ? contentUrl.trim() : '';
    if (fallbackUrl) return { status: VIDEO_STATUS.SUCCEEDED, videoUrl: fallbackUrl, error: '', done: true };
    // 声称成功但没给 URL: 继续轮询，不误判完成
    return { status: VIDEO_STATUS.POLLING, videoUrl: '', error: '', done: false };
  }
  if (rawStatus === 'failed' || rawStatus === 'error' || rawStatus === 'cancelled') {
    const msg = extractApiErrorMessage({ parsed: payload, fallback: '视频渲染失败' });
    return { status: VIDEO_STATUS.FAILED, videoUrl: '', error: msg, done: true };
  }
  // 直接返回 URL (无 status 字段的兼容形态)
  if (url) return { status: VIDEO_STATUS.SUCCEEDED, videoUrl: url, error: '', done: true };
  if (at >= cap) {
    return {
      status: VIDEO_STATUS.TIMEOUT, videoUrl: '', error: '视频生成已提交但轮询超时，稍后可在创作工坊历史中核对', done: true
    };
  }
  return { status: VIDEO_STATUS.POLLING, videoUrl: '', error: '', done: false };
}

/** 构建视频节点初始状态 (创建节点时调用) */
function createVideoNodeState() {
  return {
    status: VIDEO_STATUS.IDLE,
    taskId: '',
    videoUrl: '',
    assetKey: '',
    error: '',
    attempt: 0,
    startedAt: 0
  };
}

/** 状态推进纯函数：把一次归约结果合并进节点状态 */
function applyVideoState(prev, patch) {
  const base = isObject(prev) ? { ...createVideoNodeState(), ...prev } : createVideoNodeState();
  const next = { ...base, ...(isObject(patch) ? patch : {}) };
  if (!TERMINAL_STATUSES.includes(next.status)) next.status = VIDEO_STATUS.POLLING;
  return next;
}

/** 是否处于不可再提交的运行态 (防重复扣费) */
function isBusy(state) {
  const s = isObject(state) ? state.status : '';
  return s === VIDEO_STATUS.SUBMITTING || s === VIDEO_STATUS.POLLING;
}

/** 是否终态 (SUCCEEDED 也允许显式重跑，但由 UI 二次确认) */
function isTerminal(state) {
  return isObject(state) && TERMINAL_STATUSES.includes(state.status);
}

function isSlotPresent(slot) {
  if (!slot) return false;
  if (typeof slot === 'string') return slot.trim().length > 0;
  if (!isObject(slot)) return false;
  const hasMediaProp = Object.prototype.hasOwnProperty.call(slot, 'dataUrl') || Object.prototype.hasOwnProperty.call(slot, 'url');
  if (hasMediaProp) {
    const media = typeof slot.dataUrl === 'string' ? slot.dataUrl : (typeof slot.url === 'string' ? slot.url : '');
    return media.trim().length > 0;
  }
  return Boolean((typeof slot.name === 'string' && slot.name.trim()) || Number.isFinite(Number(slot.index)));
}

function buildSlotIndexMap(slots) {
  if (!Array.isArray(slots)) return null;
  const byDeclaredIndex = new Map();
  let compactPos = 0;
  slots.forEach((slot, arrIdx) => {
    if (!isSlotPresent(slot)) return;
    compactPos += 1;
    const rawIdx = isObject(slot) ? Number(slot.index) : NaN;
    const declaredIndex = Number.isInteger(rawIdx) && rawIdx >= 1 ? rawIdx : (arrIdx + 1);
    const rawName = (isObject(slot) && typeof slot.name === 'string') ? slot.name.trim() : '';
    byDeclaredIndex.set(declaredIndex, { seq: compactPos, name: rawName });
  });
  return { byDeclaredIndex, validCount: compactPos };
}

/**
 * 编译视频提示词：将 Studio 拖拽标签 `@[图N:别名]` / `@[图N]` 转为自然文本 `图N(别名)` / `图N`，
 * 严格保持有效槽位顺序；跳过超界或空槽位标记；手写的 `图1`/`第1张图` 原样保留。
 */
function compileVideoPrompt(rawPrompt, slots) {
  if (typeof rawPrompt !== 'string') return '';
  const trimmed = rawPrompt.trim();
  if (!trimmed) return '';
  const slotMap = buildSlotIndexMap(slots);
  const replaced = trimmed.replace(/@\[图(\d+)(?::([^\]]*))?\]/g, (_full, numStr, tagAlias) => {
    const num = Number(numStr);
    if (!Number.isInteger(num) || num < 1) return '';
    if (slotMap) {
      const entry = slotMap.byDeclaredIndex.get(num);
      if (!entry) return '';
      const alias = (entry.name || (typeof tagAlias === 'string' ? tagAlias : '')).trim();
      if (!alias || alias === `图${entry.seq}` || alias === `图${num}`) {
        return `图${entry.seq}`;
      }
      return `图${entry.seq}(${alias})`;
    }
    const cleanAlias = typeof tagAlias === 'string' ? tagAlias.trim() : '';
    if (!cleanAlias || cleanAlias === `图${num}`) return `图${num}`;
    return `图${num}(${cleanAlias})`;
  });
  return replaced
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/^[ \t]+|[ \t]+$/gm, '')
    .trim();
}

/** 检测提示词中超出有效槽位或指向空槽位的 `@[图N...]` 标记，供 UI 轻量提醒 */
function findOutOfRangeVideoTags(rawPrompt, slots) {
  if (typeof rawPrompt !== 'string' || !rawPrompt.trim() || !Array.isArray(slots)) return [];
  const slotMap = buildSlotIndexMap(slots);
  const invalid = [];
  const re = /@\[图(\d+)(?::([^\]]*))?\]/g;
  let match;
  while ((match = re.exec(rawPrompt)) !== null) {
    const num = Number(match[1]);
    if (!Number.isInteger(num) || num < 1 || !slotMap || !slotMap.byDeclaredIndex.has(num)) {
      invalid.push(match[0]);
    }
  }
  return invalid;
}

/** 计算等比缩放目标宽高（长边不超过 maxEdge） */
function computeScaledDimensions(width, height, maxEdge = DEFAULT_IMAGE_MAX_EDGE) {
  const w = Number(width);
  const h = Number(height);
  const cap = Number.isFinite(maxEdge) && maxEdge > 0 ? Math.floor(maxEdge) : DEFAULT_IMAGE_MAX_EDGE;
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return { width: 0, height: 0, scaled: false };
  }
  const longEdge = Math.max(w, h);
  if (longEdge <= cap) {
    return { width: Math.round(w), height: Math.round(h), scaled: false };
  }
  const scale = cap / longEdge;
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
    scaled: true
  };
}

/** 估算参考图数组在 JSON 载荷中的总字符字节量 */
function estimateReferencePayloadBytes(refs) {
  if (!Array.isArray(refs)) return 0;
  let total = 0;
  for (const item of refs) {
    if (typeof item === 'string') total += item.length;
  }
  return total;
}

/** 提交前总字节预算守卫：超过上限立即抛错阻断，避免 413 必败请求 */
function assertVideoPayloadBudget(refs, maxTotalBytes = MAX_VIDEO_REF_TOTAL_BYTES) {
  const cap = Number.isFinite(maxTotalBytes) && maxTotalBytes > 0 ? maxTotalBytes : MAX_VIDEO_REF_TOTAL_BYTES;
  const totalBytes = estimateReferencePayloadBytes(refs);
  if (totalBytes > cap) {
    const usedMB = (totalBytes / (1024 * 1024)).toFixed(1);
    const capMB = Math.round(cap / (1024 * 1024));
    throw new Error(`参考图总载荷 (${usedMB}MB) 超过安全上限 (${capMB}MB)，请删减或压缩图片后重试`);
  }
  return { ok: true, totalBytes, maxTotalBytes: cap };
}

/**
 * 浏览器离屏 Canvas 图片轻量化缩放压缩：
 * 像素超限或字节超过阈值时缩放到长边 <= maxEdge 并转为高质量 WebP/JPEG；
 * 在非 DOM 环境 (如 Node 单测) 或非光栅 Data URL 时安全原样返回。
 */
async function downscaleImageDataUrl(dataUrl, options = {}) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return dataUrl;
  if (dataUrl.startsWith('data:image/svg+xml')) return dataUrl;
  if (typeof document === 'undefined' || typeof Image === 'undefined') return dataUrl;

  const maxEdge = Number.isFinite(options.maxEdge) && options.maxEdge > 0 ? options.maxEdge : DEFAULT_IMAGE_MAX_EDGE;
  const quality = Number.isFinite(options.quality) && options.quality > 0 && options.quality <= 1 ? options.quality : DEFAULT_IMAGE_QUALITY;
  const minBytes = Number.isFinite(options.minBytes) && options.minBytes >= 0 ? options.minBytes : DEFAULT_IMAGE_COMPRESS_THRESHOLD_BYTES;

  return await new Promise((resolve) => {
    try {
      const img = new Image();
      img.onload = () => {
        try {
          const w = img.naturalWidth || img.width || 0;
          const h = img.naturalHeight || img.height || 0;
          if (!w || !h) { resolve(dataUrl); return; }
          const dim = computeScaledDimensions(w, h, maxEdge);
          if (!dim.scaled && dataUrl.length <= minBytes) {
            resolve(dataUrl);
            return;
          }
          const canvas = document.createElement('canvas');
          canvas.width = dim.width;
          canvas.height = dim.height;
          const ctx = canvas.getContext && canvas.getContext('2d');
          if (!ctx) { resolve(dataUrl); return; }
          ctx.drawImage(img, 0, 0, dim.width, dim.height);
          let compressed = canvas.toDataURL('image/webp', quality);
          if (!compressed || !compressed.startsWith('data:image/webp')) {
            compressed = canvas.toDataURL('image/jpeg', quality);
          }
          if (compressed && compressed.length > 0 && compressed.length < dataUrl.length) {
            resolve(compressed);
          } else {
            resolve(dataUrl);
          }
        } catch (_) {
          resolve(dataUrl);
        }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    } catch (_) {
      resolve(dataUrl);
    }
  });
}

/**
 * 生成请求体 (与 StudioPage 已验证协议完全一致，绝不臆造上游参数)。
 * 支持 H3 1~9 图 (metadata.content)、Omni 1~3 图 (metadata.reference_images) 与单首帧向后兼容；
 * 尾帧已下线，Grok 族绝不用 images 数组。
 */
function buildVideoPayload({
  model = 'MiniMax-H3',
  prompt = '',
  duration = 5,
  size = '1280x720',
  firstFrameUrl = '',
  referenceImages = [],
  referenceMode = 'auto',
  ratio = ''
} = {}) {
  const chosenModel = typeof model === 'string' && model.trim() ? model.trim() : 'MiniMax-H3';
  const isGrokVideo = /grok-imagine-video/i.test(chosenModel);
  const seconds = Number.isFinite(duration) ? Math.max(1, Math.min(30, Math.round(duration))) : 5;
  let resolution;
  if (/minimax-h3-2k/i.test(chosenModel)) {
    resolution = '2K';
  } else if (/minimax/i.test(chosenModel)) {
    resolution = '768P';
  } else if (isGrokVideo) {
    resolution = (typeof size === 'string' && size.includes('1080')) ? '1080p' : '720p';
  } else {
    resolution = (typeof size === 'string' && (size.includes('2K') || size.startsWith('2560') || size.startsWith('1440')))
      ? '2K'
      : ((typeof size === 'string' && size.includes('1080')) ? '1080P' : '768P');
  }
  const safePrompt = typeof prompt === 'string' ? prompt.trim().slice(0, 4000) : '';
  const payload = {
    model: chosenModel,
    prompt: safePrompt,
    seconds,
    duration: seconds,
    resolution
  };
  if (/^muse-video$/i.test(chosenModel)) {
    // sora 协议: seconds 必须是字符串; 画幅靠 size 表达, 分辨率固定 720P
    payload.seconds = String(seconds);
    payload.size = typeof size === 'string' && size ? size : '1280x720';
    payload.resolution = '720P';
  }
  if (/^omni-1\.2-flash$/i.test(chosenModel)) {
    // hailuo 协议: seconds 保持数字; 画幅靠 size 表达 (中转层据此选横竖屏), 分辨率固定 720P
    payload.size = typeof size === 'string' && size ? size : '1280x720';
    payload.resolution = '720P';
  }

  const first = typeof firstFrameUrl === 'string' ? firstFrameUrl.trim() : '';
  const refs = Array.isArray(referenceImages)
    ? referenceImages.map((s) => (typeof s === 'string' ? s.trim() : '')).filter(Boolean)
    : [];
  const mode = (referenceMode === 'first_frame' || referenceMode === 'reference') ? referenceMode : 'auto';
  const cleanRatio = (typeof ratio === 'string' && ratio.trim()) ? ratio.trim() : snapVideoAspectRatio(size);

  if (isGrokVideo) {
    payload.aspect_ratio = ['16:9', '9:16', '1:1'].includes(cleanRatio) ? cleanRatio : snapVideoAspectRatio(size);
  }

  // 尾帧已下线 (2026-11-25 站长决定)：上游中转接口不收 last_frame，载荷绝不下发任何尾帧字段。
  if (/minimax-h3/i.test(chosenModel)) {
    const useH3Reference = mode === 'reference' ? refs.length > 0 : (mode === 'auto' && refs.length > 1);
    if (useH3Reference) {
      const chosenRefs = refs.slice(0, 9);
      assertVideoPayloadBudget(chosenRefs);
      const content = [
        { type: 'text', text: safePrompt || 'Cinematic motion' },
        ...chosenRefs.map((url) => ({
          type: 'image_url',
          image_url: { url },
          role: 'reference_image'
        }))
      ];
      payload.metadata = { content };
    } else if (mode !== 'reference') {
      const single = first || refs[0] || '';
      if (single) {
        assertVideoPayloadBudget([single]);
        payload.image = single;
        payload.metadata = { first_frame_image: single };
      }
    }
    if (H3_ALLOWED_RATIOS.has(cleanRatio)) {
      payload.metadata = { ...(payload.metadata || {}), ratio: cleanRatio };
    }
  } else if (/^omni-1\.2-flash$/i.test(chosenModel)) {
    const effective = refs.length ? refs.slice(0, 3) : (first ? [first] : []);
    if (effective.length > 0) {
      assertVideoPayloadBudget(effective);
      if (effective.length === 1 && mode !== 'reference') {
        payload.image = effective[0];
        payload.metadata = { first_frame_image: effective[0] };
      } else {
        payload.metadata = { reference_images: effective };
      }
    }
  } else if (/minimax|hailuo/i.test(chosenModel)) {
    const single = first || refs[0] || '';
    if (single) {
      assertVideoPayloadBudget([single]);
      payload.image = single;
      payload.metadata = { first_frame_image: single };
    }
  } else {
    const single = first || refs[0] || '';
    if (single) {
      assertVideoPayloadBudget([single]);
      payload.image = single;
      payload.image_url = single;
    }
  }
  return payload;
}

/**
 * 画布共享视频节点任务执行器 (供 LegacyCanvasWorkspace 与 ReactFlowWorkspace 共用):
 * 负责参考图按模型上限裁剪 -> 离屏轻量化压缩 -> 提示词编译 -> 构建载荷 -> 提交 -> 长轮询 -> 本地资产落盘。
 */
async function executeVideoNodeTask({
  baseUrl,
  apiKey,
  model = 'MiniMax-H3',
  prompt = '',
  duration = 5,
  size = '1280x720',
  generateAudio = false,
  ratio = '',
  referenceUrls = [],
  assetsDriver = null,
  fetchFn = (typeof fetch !== 'undefined' ? fetch : null),
  signal = null,
  onStateChange = null,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS
} = {}) {
  if (!apiKey) throw new Error('未检测到 API Key，请先配置密钥');
  if (!fetchFn) throw new Error('全局 fetch 未就绪');

  const notify = (patch) => {
    if (typeof onStateChange === 'function') {
      try { onStateChange(patch); } catch (_) {}
    }
  };

  notify({ status: VIDEO_STATUS.SUBMITTING, error: '', startedAt: Date.now() });

  const caps = getVideoModelCapabilities(model);
  const rawRefs = Array.isArray(referenceUrls)
    ? referenceUrls.map((u) => (typeof u === 'string' ? u.trim() : '')).filter(Boolean)
    : [];
  const clippedRefs = rawRefs.slice(0, caps.maxRefImages);
  const effectiveRefs = [];
  for (const refUrl of clippedRefs) {
    effectiveRefs.push(await downscaleImageDataUrl(refUrl, { maxEdge: DEFAULT_IMAGE_MAX_EDGE, quality: DEFAULT_IMAGE_QUALITY }));
  }

  const slots = effectiveRefs.map((url, idx) => ({ index: idx + 1, name: `图${idx + 1}`, dataUrl: url }));
  const compiledPrompt = compileVideoPrompt(prompt || '电影感运镜，光线流动', slots) || '电影感运镜，光线流动';
  const payload = buildVideoPayload({
    model,
    prompt: compiledPrompt,
    duration,
    size,
    firstFrameUrl: effectiveRefs[0] || '',
    referenceImages: effectiveRefs,
    referenceMode: effectiveRefs.length > 1 ? 'reference' : 'auto',
    ratio
  });
  if (generateAudio && !/grok-imagine-video/i.test(model)) {
    payload.audio = true;
  }

  const endpoints = resolveVideoEndpoints(baseUrl, model);
  const submitRes = await fetchFn(endpoints.submitUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify(payload),
    ...(signal ? { signal } : {})
  });
  if (!submitRes.ok) {
    const msg = await readResponseErrorMessage(submitRes);
    throw new Error(`创建视频任务失败: ${msg}`);
  }
  const submitData = await submitRes.json();
  const parsed = parseSubmitResponse(submitData);
  if (parsed.error) throw new Error(parsed.error);

  let videoUrl = parsed.directUrl;
  let finalAttempt = 0;

  if (!videoUrl && parsed.taskId) {
    notify({ status: VIDEO_STATUS.POLLING, taskId: parsed.taskId });
    const pollUrl = endpoints.pollUrl(parsed.taskId);
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      finalAttempt = attempt;
      if (signal && signal.aborted) throw new Error('已由用户取消');
      await new Promise((r) => setTimeout(r, pollIntervalMs));
      if (signal && signal.aborted) throw new Error('已由用户取消');
      let pollData = {};
      try {
        const pollRes = await fetchFn(pollUrl, {
          headers: { 'Authorization': `Bearer ${apiKey}` },
          ...(signal ? { signal } : {})
        });
        if (pollRes.ok) pollData = await pollRes.json();
      } catch (pollErr) {
        if (signal && signal.aborted) throw new Error('已由用户取消');
        pollData = {};
      }
      const reduced = reducePollResponse(pollData, attempt, maxAttempts, endpoints.contentUrl(parsed.taskId));
      notify({ status: reduced.status, attempt, error: reduced.error, videoUrl: reduced.videoUrl });
      if (reduced.error && reduced.done && reduced.status === VIDEO_STATUS.FAILED) throw new Error(reduced.error);
      if (reduced.done && reduced.status === VIDEO_STATUS.TIMEOUT) throw new Error(reduced.error);
      if (reduced.done && reduced.videoUrl) {
        videoUrl = reduced.videoUrl;
        break;
      }
    }
  }
  if (!videoUrl) throw new Error('视频生成已提交但未取得结果，稍后可在创作工坊历史中核对');

  let finalUrl = videoUrl;
  let assetKey = '';
  let assetWarning = '';
  if (assetsDriver && typeof assetsDriver.saveBuffer === 'function') {
    try {
      const isContentEndpoint = Boolean(parsed.taskId) && videoUrl === endpoints.contentUrl(parsed.taskId);
      const binRes = await fetchFn(videoUrl, {
        ...(isContentEndpoint ? { headers: { 'Authorization': `Bearer ${apiKey}` } } : {}),
        ...(signal ? { signal } : {})
      });
      if (binRes.ok) {
        const ab = await binRes.arrayBuffer();
        const buf = typeof Buffer !== 'undefined' ? Buffer.from(ab) : new Uint8Array(ab);
        if (buf.length > 0) {
          const saved = assetsDriver.saveBuffer(buf, 'video/mp4');
          assetKey = saved.assetKey;
          finalUrl = `asset:${assetKey}`;
        }
      }
    } catch (assetErr) {
      assetWarning = `视频已生成但本地落盘失败: ${assetErr.message} (仍可用远程链接播放)`;
    }
  }

  const finalState = {
    status: VIDEO_STATUS.SUCCEEDED,
    error: '',
    videoUrl: finalUrl,
    assetKey,
    taskId: parsed.taskId || '',
    attempt: finalAttempt
  };
  notify(finalState);
  return { ...finalState, assetWarning };
}

module.exports = {
  VIDEO_STATUS,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_POLL_INTERVAL_MS,
  TERMINAL_STATUSES,
  MAX_VIDEO_REF_TOTAL_BYTES,
  DEFAULT_IMAGE_MAX_EDGE,
  DEFAULT_IMAGE_QUALITY,
  parseSubmitResponse,
  reducePollResponse,
  createVideoNodeState,
  applyVideoState,
  isBusy,
  isTerminal,
  getVideoModelCapabilities,
  compileVideoPrompt,
  findOutOfRangeVideoTags,
  computeScaledDimensions,
  estimateReferencePayloadBytes,
  assertVideoPayloadBudget,
  downscaleImageDataUrl,
  buildVideoPayload,
  snapVideoAspectRatio,
  resolveVideoEndpoints,
  executeVideoNodeTask,
  extractApiErrorMessage,
  readResponseErrorMessage
};
