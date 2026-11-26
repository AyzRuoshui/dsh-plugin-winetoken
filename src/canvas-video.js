// -*- coding: utf-8 -*-
/**
 * WineToken 漫剧画布视频节点状态机 (CanvasVideo)
 * 对位上游 infinite-canvas 的 video 节点 + 异步任务轮询，但按 DSH 实际拆为：
 *   - 纯函数: 提交响应解析 / 轮询状态归约 / 超时与取消判定 (本模块，可 node --test)
 *   - 副作用: fetch 提交与轮询、二进制落盘 (由 client.js 执行，协议与 StudioPage 一致)
 * 零依赖、零 fs/网络/DOM、无动态代码执行。
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

function normalizeV1Base(url) {
  const clean = (url || '').trim().replace(/\/+$/, '');
  return clean.endsWith('/v1') ? clean : `${clean}/v1`;
}

function resolveVideoEndpoints(baseUrl, model = '') {
  const v1 = normalizeV1Base(baseUrl);
  const isMiniMax = /minimax|hailuo/i.test(model);
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
    const msg = firstString(
      isObject(payload.error) ? payload.error.message : '',
      payload.message, payload.error_msg, '视频渲染失败'
    );
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

/**
 * 生成请求体 (与 StudioPage 已验证协议完全一致，绝不臆造上游参数)。
 * 首帧参考图按模型族填入对应字段，Grok 族绝不用 images 数组。
 */
function buildVideoPayload({ model = 'MiniMax-H3', prompt = '', duration = 5, size = '1280x720', firstFrameUrl = '' } = {}) {
  const chosenModel = typeof model === 'string' && model.trim() ? model.trim() : 'MiniMax-H3';
  const isGrokVideo = /grok-imagine-video/i.test(chosenModel);
  const seconds = Number.isFinite(duration) ? Math.max(1, Math.min(30, Math.round(duration))) : 5;
  let resolution;
  if (/minimax-h3-2k/i.test(chosenModel)) {
    resolution = '2K';
  } else if (/minimax/i.test(chosenModel)) {
    resolution = '768P';
  } else if (isGrokVideo) {
    resolution = (typeof size === 'string' && size.includes('1080')) ? '1080P' : '720P';
  } else {
    resolution = (typeof size === 'string' && (size.includes('2K') || size.startsWith('2560') || size.startsWith('1440')))
      ? '2K'
      : ((typeof size === 'string' && size.includes('1080')) ? '1080P' : '768P');
  }
  const payload = {
    model: chosenModel,
    prompt: typeof prompt === 'string' ? prompt.trim().slice(0, 4000) : '',
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
  const first = typeof firstFrameUrl === 'string' ? firstFrameUrl.trim() : '';
  // 尾帧已下线 (2026-11-25 站长决定)：上游中转接口不收 last_frame，载荷绝不下发任何尾帧字段。
  if (/minimax|hailuo/i.test(chosenModel)) {
    if (first) {
      payload.image = first;
      payload.metadata = { first_frame_image: first };
    }
  } else {
    if (first) { payload.image = first; payload.image_url = first; }
  }
  return payload;
}

module.exports = {
  VIDEO_STATUS,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_POLL_INTERVAL_MS,
  TERMINAL_STATUSES,
  parseSubmitResponse,
  reducePollResponse,
  createVideoNodeState,
  applyVideoState,
  isBusy,
  isTerminal,
  buildVideoPayload,
  resolveVideoEndpoints
};
