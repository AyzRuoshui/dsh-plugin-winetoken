// -*- coding: utf-8 -*-
/**
 * WineToken 漫剧 AI 画布 React Flow 工作台组件 (v2.5.1)
 * 基于 @xyflow/react (React Flow v12) 原生视图层，深度契合 Linear / Raycast 极简纯净工程美学
 * 1. 6 个自定义节点：characterNode / panelNode / imageNode / videoNode / textNode / groupNode
 * 2. 节点参数集照现行全量：
 *    - 视频时长: 4/5/6/10/15 秒、720P/1080P、比例 (16:9/9:16/1:1/4:3/3:4)、音频开关 (开/关)
 *    - 图片比例: 1:1/16:9/9:16/4:3/3:4、画质: 1K/2K/4K、张数: 1/2/4
 * 3. 边类型统一为 'default' (内置贝塞尔)，严禁出现 'bezier'
 * 4. 归属徽章隐藏：proOptions={{ hideAttribution: true }}
 * 5. 全能参考注入规则复用 canvas-nodes.js 纯函数 buildGenerationContext
 * 6. 原生 MiniMap 与 React Flow Panel 底部浮动工具栏
 * 7. 画布空白处双击弹出添加节点菜单 (图片/视频/文本/分镜/角色)，防事件冲突
 * 8. 彻底去 Emoji，纯矢量极简工程风格
 */

const React = require('react');
const h = React.createElement;

// 依赖按需解析兜底
let CanvasNodeUtils = null;
try { CanvasNodeUtils = require('./canvas-nodes.js'); } catch (_) {}
let CanvasPricingUtils = null;
try { CanvasPricingUtils = require('./canvas-pricing.js'); } catch (_) {}
let CanvasPromptUtils = null;
try { CanvasPromptUtils = require('./canvas-prompts.js'); } catch (_) {}
let CanvasVideoUtils = null;
let canvasVideoLoadError = null;
try {
  CanvasVideoUtils = require('./canvas-video.js');
} catch (err) {
  canvasVideoLoadError = err;
  if (typeof console !== 'undefined' && typeof console.error === 'function') {
    console.error('[WineToken CanvasReactFlow] 视频组件加载失败 (./canvas-video.js):', err);
  }
}
const VIDEO_MODULE_LOAD_ERROR_MSG = '视频组件加载失败（canvas-video.js），插件安装不完整，请删除后重新安装插件';
let CanvasExportUtils = null;
try { CanvasExportUtils = require('./canvas-export.js'); } catch (_) {}
let initXyFlowFactory = null;
try { initXyFlowFactory = require('./vendor/xyflow.factory.cjs'); } catch (_) {}

// 全局节点操作调度 Context
const NodeActionContext = React.createContext(null);

const DEFAULT_VIDEO_MODELS_FALLBACK = [
  { id: 'MiniMax-H3', name: 'MiniMax H3', tag: '电影感' },
  { id: 'MiniMax-H3-2K', name: 'MiniMax H3 2K', tag: '2K超清' },
  { id: 'omni-1.2-flash', name: 'Omni 1.2 Flash', tag: '原生音频' },
  { id: 'muse-video', name: 'Muse Video', tag: '超值' },
  { id: 'grok-imagine-video-1.5', name: 'Grok Imagine 视频旗舰', tag: '物理连贯' }
];

const MAX_IMAGE_REF_IMAGES = 5;

const DEFAULT_IMAGE_MODELS_FALLBACK = [
  { id: 'sensenova-u1.5-lite', name: '商汤 SenseNova U1.5 Lite', tag: '限免4K', price: 0, vipPrice: 0, singleNOnly: true, qualities: ['1K', '2K', '4K'] },
  { id: 'gpt-image-2.6-flare', name: 'GPT-Image 2.6 Flare', tag: '超快极速', price: 0.20, vipPrice: 0.16, singleNOnly: true, qualities: ['1K', '2K', '4K'] },
  { id: 'gpt-image-2.6-sunburst', name: 'GPT-Image 2.6 Sunburst', tag: '细腻逼真', price: 0.30, vipPrice: 0.24, singleNOnly: true, qualities: ['1K', '2K', '4K'] },
  { id: 'grok-imagine-image-2.0', name: 'Grok Imagine 2.0 旗舰', tag: '创意先锋', price: 0.50, vipPrice: 0.40, singleNOnly: true, qualities: ['1K'] },
  { id: 'muse-image', name: 'Muse Image', tag: '超值', price: 0.05, vipPrice: 0.04, singleNOnly: true, qualities: ['1K'] },
  { id: 'nano-banana-2.1', name: 'Nano Banana 2.1', tag: '谷歌出图', price: 0.03, vipPrice: 0.024, singleNOnly: true, qualities: ['1K', '2K', '4K'] }
];

const IMAGE_RATIO_SIZE_MAP = Object.freeze({
  '1:1': '1024x1024',
  '16:9': '1792x1024',
  '9:16': '1024x1792',
  '4:3': '1344x1008',
  '3:4': '1008x1344',
  '2:3': '1024x1536',
  '3:2': '1536x1024'
});

function resolveImageModelList(rawModels) {
  return (Array.isArray(rawModels) && rawModels.length > 0)
    ? rawModels
    : DEFAULT_IMAGE_MODELS_FALLBACK;
}

function pickDefaultImageModel(models, manifestMgr) {
  const list = Array.isArray(models) ? models : [];
  if (manifestMgr && typeof manifestMgr.getFreeImageModel === 'function') {
    try {
      const m = manifestMgr.getFreeImageModel();
      if (typeof m === 'string' && m.trim() && (list.length === 0 || list.some((it) => it && it.id === m.trim()))) {
        return m.trim();
      }
    } catch (_) {}
  }
  const free = list.find((m) => m && (m.price === 0 || (typeof m.tag === 'string' && m.tag.includes('限免'))));
  if (free && free.id) return free.id;
  if (list[0] && list[0].id) return list[0].id;
  return 'sensenova-u1.5-lite';
}

function inferImageRatio(size) {
  const match = String(size || '').match(/^(\d{2,5})\s*[xX]\s*(\d{2,5})$/);
  if (!match) return '';
  const value = Number(match[1]) / Math.max(1, Number(match[2]));
  const ratios = [['1:1', 1], ['16:9', 16 / 9], ['9:16', 9 / 16], ['4:3', 4 / 3], ['3:4', 3 / 4], ['2:3', 2 / 3], ['3:2', 3 / 2]];
  let best = '';
  let diff = Infinity;
  for (const [label, ratio] of ratios) {
    const next = Math.abs(Math.log(value) - Math.log(ratio));
    if (next < diff) { best = label; diff = next; }
  }
  return best;
}

function getImageModelCapabilities(modelObj = {}, modelId = '') {
  const id = String(modelObj.id || modelId || '').toLowerCase();
  const declaredRatios = Array.isArray(modelObj.aspectRatios) ? modelObj.aspectRatios : (Array.isArray(modelObj.ratios) ? modelObj.ratios : []);
  const values = Array.isArray(modelObj.resolutions) ? modelObj.resolutions.map(r => typeof r === 'string' ? r : (r && r.val)).filter(Boolean) : [];
  const derived = values.map(inferImageRatio).filter(Boolean);
  const fallbackRatios = /grok-imagine-image|muse-image/.test(id)
    ? ['1:1', '16:9', '9:16']
    : (/sensenova-u1\.5-lite|gpt-image-2\.6|nano-banana-2\.1/.test(id)
      ? ['1:1', '16:9', '9:16', '4:3', '3:4', '2:3', '3:2']
      : ['1:1', '16:9', '9:16']);
  const aspectRatios = [...new Set(declaredRatios.length ? declaredRatios : (derived.length ? derived : fallbackRatios))];
  let qualityOptions = Array.isArray(modelObj.qualities) ? modelObj.qualities : (Array.isArray(modelObj.qualityLevels) ? modelObj.qualityLevels : null);
  if (!qualityOptions) {
    qualityOptions = /grok-imagine-image|muse-image/.test(id) ? ['1K'] : ['1K', '2K', '4K'];
  }
  return { aspectRatios, qualityOptions, resolutions: values };
}

function resolveVideoNodeOptions(videoUtils, model) {
  const caps = resolveNodeVideoCapabilities(videoUtils, model);
  const defaults = /minimax-h3-2k/i.test(model)
    ? { durations: [5, 6, 10, 15], resolutions: ['2K'], aspectRatios: ['adaptive', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'] }
    : (/minimax-h3/i.test(model)
      ? { durations: [4, 5, 6, 10, 15], resolutions: ['720P'], aspectRatios: ['adaptive', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'] }
      : (/grok-imagine-video/i.test(model)
        ? { durations: [5, 10], resolutions: ['720P', '1080P'], aspectRatios: ['16:9', '9:16', '1:1'] }
        : (/^omni-1\.2-flash$/i.test(model)
          ? { durations: Array.from({ length: 13 }, (_, i) => i + 3), resolutions: ['720P'], aspectRatios: ['16:9', '9:16'] }
          : { durations: [5, 6, 10, 15], resolutions: ['720P'], aspectRatios: ['16:9', '9:16'] })));
  return {
    ...caps,
    durations: Array.isArray(caps.durations) && caps.durations.length ? caps.durations : defaults.durations,
    resolutions: Array.isArray(caps.resolutions) && caps.resolutions.length ? caps.resolutions : defaults.resolutions,
    aspectRatios: Array.isArray(caps.aspectRatios) && caps.aspectRatios.length ? caps.aspectRatios : defaults.aspectRatios
  };
}

function videoSizeForNode(resolution, ratio) {
  const vertical = ratio === '9:16';
  if (resolution === '2K') return vertical ? '1440x2560' : '2560x1440';
  if (resolution === '1080P') return vertical ? '1080x1920' : '1920x1080';
  return vertical ? '720x1280' : '1280x720';
}

function resolveImageModelValidation(validateFn, model, hasReference) {
  if (typeof validateFn === 'function') {
    try {
      const res = validateFn(model, hasReference);
      if (res && typeof res === 'object') return res;
    } catch (_) {}
  }
  if (!hasReference) return { supported: true, protocol: 'generations' };
  const m = String(model || '').toLowerCase();
  if (m.includes('sensenova')) return { supported: true, protocol: 'sensenova-edits' };
  if (m.includes('gpt-image')) return { supported: true, protocol: 'openai-multipart-edits' };
  if (m.includes('nano-banana-2.1')) return { supported: true, protocol: 'flow-relay-generations' };
  return {
    supported: false,
    error: '当前模型不支持垫图改图，请切换 sensenova 或 gpt-image 模型，或清空参考图'
  };
}

async function downscaleReferenceImage(videoUtils, dataUrl) {
  if (videoUtils && typeof videoUtils.downscaleImageDataUrl === 'function') {
    try {
      return await videoUtils.downscaleImageDataUrl(dataUrl, { maxEdge: 2048, quality: 0.88 });
    } catch (_) {
      return dataUrl;
    }
  }
  return dataUrl;
}

function resolveImageNodeModelState(actions, paramsModel) {
  const availableModels = resolveImageModelList(actions.availableImageModels);
  const defaultModel = actions.canvasModel || pickDefaultImageModel(availableModels, null);
  const chosenModel = paramsModel || defaultModel;
  const modelOptions = availableModels.some((m) => m && m.id === chosenModel)
    ? availableModels
    : [{ id: chosenModel, name: chosenModel, tag: '' }, ...availableModels];
  return { availableModels, chosenModel, modelOptions };
}

function computeImageReferenceMeta(actions, nodeId, chosenModel) {
  const ctx = (actions.genContextMap && actions.genContextMap[nodeId]) ? actions.genContextMap[nodeId] : null;
  const rawRefs = (ctx && Array.isArray(ctx.referenceImages))
    ? ctx.referenceImages.filter((r) => typeof r === 'string' && r.trim())
    : [];
  const totalRefs = rawRefs.length;
  const effectiveCount = Math.min(totalRefs, MAX_IMAGE_REF_IMAGES);
  const refCheck = resolveImageModelValidation(actions.validateImageModelSupport, chosenModel, totalRefs > 0);
  const isDark = actions.theme ? actions.theme.isDark !== false : true;

  let referenceBadge = '文生图';
  let refBadgeColor = '#a855f7';
  let refBadgeBg = isDark ? 'rgba(168,85,247,0.15)' : 'rgba(168,85,247,0.1)';
  if (totalRefs > 0) {
    if (!refCheck.supported) {
      referenceBadge = '不支持参考图';
      refBadgeColor = '#ef4444';
      refBadgeBg = isDark ? 'rgba(239,68,68,0.16)' : 'rgba(239,68,68,0.12)';
    } else if (totalRefs === 1) {
      referenceBadge = '单图参考';
      refBadgeColor = '#10b981';
      refBadgeBg = isDark ? 'rgba(16,185,129,0.16)' : 'rgba(16,185,129,0.12)';
    } else if (totalRefs > MAX_IMAGE_REF_IMAGES) {
      referenceBadge = `图生图 (仅前${MAX_IMAGE_REF_IMAGES}/共${totalRefs}图)`;
      refBadgeColor = '#f59e0b';
      refBadgeBg = isDark ? 'rgba(245,158,11,0.16)' : 'rgba(245,158,11,0.12)';
    } else {
      referenceBadge = `图生图 (${totalRefs}图)`;
      refBadgeColor = '#10b981';
      refBadgeBg = isDark ? 'rgba(16,185,129,0.16)' : 'rgba(16,185,129,0.12)';
    }
  }

  return { rawRefs, totalRefs, effectiveCount, refCheck, referenceBadge, refBadgeColor, refBadgeBg };
}

function renderImageModelSelector({ isDark, label, chosenModel, modelOptions, onChange }) {
  return h('div', { key: 'model-sec', style: { display: 'flex', flexDirection: 'column', gap: 2 } }, [
    h('label', { key: 'lbl', style: { fontSize: 10, color: isDark ? '#a1a1aa' : '#71717a' } }, label || '图片模型'),
    h('select', {
      key: 'model-sel',
      value: chosenModel,
      onChange,
      style: {
        width: '100%',
        background: isDark ? '#1f1f23' : '#f3f4f6',
        color: isDark ? '#ffffff' : '#000000',
        border: isDark ? '1px solid rgba(255,255,255,0.12)' : '1px solid rgba(0,0,0,0.12)',
        borderRadius: 4,
        fontSize: 11,
        padding: '4px 6px',
        outline: 'none'
      }
    }, modelOptions.map((m) => h('option', { key: m.id, value: m.id }, m.name ? `${m.name}${m.tag ? ' [' + m.tag + ']' : ''}` : m.id)))
  ]);
}

function renderImageReferenceStrip({ isDark, assetsDriver, rawRefs, totalRefs, effectiveCount, refCheck }) {
  if (!totalRefs) return null;
  const unsupported = Boolean(refCheck && !refCheck.supported);
  return h('div', {
    key: 'refs-strip',
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
      padding: '6px 8px',
      borderRadius: 6,
      background: isDark ? '#141417' : '#f9fafb',
      border: unsupported
        ? '1px solid rgba(239,68,68,0.45)'
        : (isDark ? '1px solid rgba(255,255,255,0.06)' : '1px solid rgba(0,0,0,0.06)')
    }
  }, [
    h('div', {
      key: 'refs-hdr',
      style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 10, color: isDark ? '#a1a1aa' : '#71717a' }
    }, [
      h('span', { key: 't' }, unsupported ? `参考图序 (共${totalRefs}张 · 不支持)` : `参考图序 (生效 ${effectiveCount}/${totalRefs} 张)`),
      unsupported
        ? h('span', { key: 'u', style: { color: '#ef4444', fontWeight: 600 } }, '当前模型不支持参考图')
        : (totalRefs > MAX_IMAGE_REF_IMAGES && h('span', { key: 'w', style: { color: '#f59e0b', fontWeight: 600 } }, `超出上限(${MAX_IMAGE_REF_IMAGES})将忽略`))
    ]),
    h('div', {
      key: 'refs-list',
      style: { display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }
    }, rawRefs.map((refVal, idx) => {
      const resolved = resolveAssetUrl(refVal, assetsDriver);
      const isDropped = idx >= MAX_IMAGE_REF_IMAGES;
      const isDimmed = unsupported || isDropped;
      return h('div', {
        key: `${idx}_${refVal.slice(0, 24)}`,
        title: unsupported
          ? `图${idx + 1}: 当前模型不支持垫图改图`
          : (isDropped ? `图${idx + 1}: 超出上限 (${MAX_IMAGE_REF_IMAGES}张)，本次不提交` : `图${idx + 1} (按连线顺序传入)`),
        style: {
          position: 'relative',
          width: 36,
          height: 36,
          borderRadius: 4,
          overflow: 'hidden',
          flexShrink: 0,
          opacity: isDimmed ? 0.45 : 1,
          border: unsupported ? '1px solid #ef4444' : (isDropped ? '1px solid #f59e0b' : (isDark ? '1px solid rgba(255,255,255,0.16)' : '1px solid rgba(0,0,0,0.14)')),
          background: isDark ? '#27272a' : '#e5e7eb'
        }
      }, [
        resolved ? h('img', {
          key: 'img',
          src: resolved,
          alt: `图${idx + 1}`,
          style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' }
        }) : null,
        h('div', {
          key: 'idx',
          style: {
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            background: isDropped ? 'rgba(245,158,11,0.88)' : 'rgba(0,0,0,0.7)',
            color: '#ffffff',
            fontSize: 9,
            lineHeight: '12px',
            textAlign: 'center',
            fontWeight: 600
          }
        }, isDropped ? '忽略' : `图${idx + 1}`)
      ]);
    })),
    unsupported && refCheck && refCheck.error && h('div', {
      key: 'unsupported-msg',
      style: { fontSize: 10, color: '#ef4444', lineHeight: 1.35, marginTop: 2 }
    }, refCheck.error)
  ]);
}

function renderImageErrorBanner({ isDark, errorText }) {
  if (!errorText) return null;
  return h('div', {
    key: 'error-banner',
    style: {
      fontSize: 10.5,
      lineHeight: 1.4,
      color: '#ef4444',
      background: isDark ? 'rgba(239,68,68,0.12)' : 'rgba(239,68,68,0.08)',
      border: '1px solid rgba(239,68,68,0.35)',
      borderRadius: 6,
      padding: '5px 8px',
      wordBreak: 'break-word'
    }
  }, `生成失败: ${errorText}`);
}

function resolveNodeVideoCapabilities(videoUtils, model) {
  if (videoUtils && typeof videoUtils.getVideoModelCapabilities === 'function') {
    return videoUtils.getVideoModelCapabilities(model);
  }
  const m = typeof model === 'string' ? model.trim() : '';
  if (/minimax-h3/i.test(m)) {
    return { model: m, supportsMultiRef: true, maxRefImages: 9, multiRefExclusiveWithFirstFrame: true };
  }
  if (/^omni-1\.2-flash$/i.test(m)) {
    return { model: m, supportsMultiRef: true, maxRefImages: 3, multiRefExclusiveWithFirstFrame: false };
  }
  return { model: m || 'MiniMax-H3', supportsMultiRef: false, maxRefImages: 1, multiRefExclusiveWithFirstFrame: false };
}

// 资产安全转 DataURL
function resolveAssetUrl(url, assetsDriver) {
  if (!url || typeof url !== 'string') return '';
  if (url.startsWith('asset:') && assetsDriver) {
    try {
      const key = url.slice(6);
      if (typeof assetsDriver.readAsDataUrl === 'function') {
        const dataUrl = assetsDriver.readAsDataUrl(key);
        if (dataUrl) return dataUrl;
      }
    } catch (_) {}
  }
  return url;
}

// 端口通用基础样式
const HANDLE_STYLE = {
  width: 10,
  height: 10,
  borderRadius: '50%',
  backgroundColor: '#3b82f6',
  border: '2px solid #ffffff',
  zIndex: 10
};

// 1. 角色卡节点 (CharacterNode)
function CharacterNode({ id, data, selected }) {
  const actions = React.useContext(NodeActionContext) || {};
  const theme = actions.theme || {};
  const isDark = theme.isDark !== false;
  const name = typeof data.name === 'string' ? data.name : '未命名角色';
  const dna = typeof data.dna === 'string' ? data.dna : '';
  const avatar = resolveAssetUrl(data.avatar, actions.canvasAssetsDriver);
  const tags = Array.isArray(data.tags) ? data.tags : [];
  const Handle = actions.Handle;
  const Position = actions.Position || { Right: 'right' };

  return h('div', {
    style: {
      width: 250,
      borderRadius: 10,
      background: isDark ? '#18181c' : '#ffffff',
      border: selected ? '2px solid #3b82f6' : (isDark ? '1px solid rgba(255,255,255,0.1)' : '1px solid rgba(0,0,0,0.1)'),
      boxShadow: selected ? '0 0 0 2px rgba(59,130,246,0.2), 0 8px 24px rgba(0,0,0,0.3)' : '0 4px 16px rgba(0,0,0,0.15)',
      overflow: 'hidden',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontSize: 12,
      color: isDark ? '#e4e4e7' : '#18181b',
      boxSizing: 'border-box'
    }
  }, [
    // 头部
    h('div', {
      key: 'header',
      style: {
        padding: '8px 12px',
        borderBottom: isDark ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(0,0,0,0.08)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: isDark ? '#141417' : '#f9fafb'
      }
    }, [
      h('div', { key: 'badge', style: { display: 'flex', alignItems: 'center', gap: 6 } }, [
        h('span', {
          key: 'tag',
          style: {
            fontSize: 10,
            padding: '2px 6px',
            borderRadius: 4,
            background: isDark ? 'rgba(59,130,246,0.15)' : 'rgba(59,130,246,0.1)',
            color: '#3b82f6',
            fontWeight: 600
          }
        }, '角色'),
        h('span', { key: 'name', style: { fontWeight: 600, maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, name)
      ]),
      h('button', {
        key: 'del',
        onClick: (e) => { e.stopPropagation(); actions.deleteNode?.(id); },
        title: '删除节点',
        style: {
          background: 'transparent',
          border: 'none',
          color: isDark ? '#71717a' : '#a1a1aa',
          cursor: 'pointer',
          padding: '2px 4px',
          fontSize: 14,
          lineHeight: 1
        }
      }, '×')
    ]),

    // 头像与名称
    h('div', {
      key: 'body',
      style: { padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }
    }, [
      h('div', { key: 'avatar-row', style: { display: 'flex', gap: 10, alignItems: 'center' } }, [
        h('div', {
          key: 'avatar-box',
          style: {
            width: 48,
            height: 48,
            borderRadius: 8,
            overflow: 'hidden',
            background: isDark ? '#27272a' : '#f3f4f6',
            border: isDark ? '1px solid rgba(255,255,255,0.1)' : '1px solid rgba(0,0,0,0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0
          }
        }, [
          avatar ? h('img', {
            key: 'avatar-img',
            src: avatar,
            alt: name,
            style: { width: '100%', height: '100%', objectFit: 'cover' }
          }) : h('span', { key: 'no-avatar', style: { fontSize: 10, color: isDark ? '#71717a' : '#9ca3af' } }, '无头像')
        ]),
        h('div', { key: 'name-col', style: { flex: 1, display: 'flex', flexDirection: 'column', gap: 4 } }, [
          h('label', { key: 'lbl', style: { fontSize: 10, color: isDark ? '#a1a1aa' : '#71717a' } }, '代号/姓名'),
          h('input', {
            key: 'ipt',
            value: name,
            onChange: (e) => actions.updateNodeData?.(id, { name: e.target.value }),
            placeholder: '角色代号',
            style: {
              width: '100%',
              padding: '4px 8px',
              borderRadius: 4,
              border: isDark ? '1px solid rgba(255,255,255,0.12)' : '1px solid rgba(0,0,0,0.12)',
              background: isDark ? '#1f1f23' : '#f3f4f6',
              color: isDark ? '#ffffff' : '#000000',
              fontSize: 12,
              outline: 'none',
              boxSizing: 'border-box'
            }
          })
        ])
      ]),

      // DNA 外貌描述
      h('div', { key: 'dna-row', style: { display: 'flex', flexDirection: 'column', gap: 4 } }, [
        h('label', { key: 'lbl', style: { fontSize: 10, color: isDark ? '#a1a1aa' : '#71717a' } }, 'DNA 外貌特征描述'),
        h('textarea', {
          key: 'txt',
          rows: 3,
          value: dna,
          onChange: (e) => actions.updateNodeData?.(id, { dna: e.target.value }),
          placeholder: '输入少年剑客、黑袍高领、银白碎发等 DNA 提示词...',
          style: {
            width: '100%',
            padding: '6px 8px',
            borderRadius: 6,
            border: isDark ? '1px solid rgba(255,255,255,0.12)' : '1px solid rgba(0,0,0,0.12)',
            background: isDark ? '#1f1f23' : '#f3f4f6',
            color: isDark ? '#ffffff' : '#000000',
            fontSize: 11,
            lineHeight: 1.4,
            resize: 'none',
            outline: 'none',
            boxSizing: 'border-box'
          }
        })
      ]),

      // 特征锁定标签
      tags.length > 0 && h('div', {
        key: 'tags-row',
        style: { display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 2 }
      }, tags.map((t, idx) => h('span', {
        key: idx,
        style: {
          fontSize: 10,
          padding: '2px 6px',
          borderRadius: 4,
          background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
          color: isDark ? '#a1a1aa' : '#52525b'
        }
      }, t)))
    ]),

    // 输出端口 (右侧)
    Handle && h(Handle, {
      key: 'handle-char-out',
      type: 'source',
      position: Position.Right,
      id: 'char-out',
      style: { ...HANDLE_STYLE, top: '50%' }
    })
  ]);
}

// 2. 分镜卡节点 (PanelNode)
function PanelNode({ id, data, selected }) {
  const actions = React.useContext(NodeActionContext) || {};
  const theme = actions.theme || {};
  const isDark = theme.isDark !== false;
  const num = data.num !== undefined ? data.num : 1;
  const shotLabel = data.shotLabel || (data.shot === 'CU' ? '特写' : (data.shot === 'MS' ? '中景' : (data.shot === 'WS' ? '远景' : '全景')));
  const params = data.params || {};
  const aspectRatio = data.aspectRatio || params.aspectRatio || '2:3';
  const prompt = typeof data.prompt === 'string' ? data.prompt : '';
  const dialogue = typeof data.dialogue === 'string' ? data.dialogue : '';
  const imageState = data.imageState || {};
  const imageUrl = resolveAssetUrl(data.imageUrl || imageState.url || data.url, actions.canvasAssetsDriver);
  const candidates = Array.isArray(data.candidates) ? data.candidates : [];
  const isGenerating = Boolean(data.isGenerating || imageState.status === 'generating');
  const errorText = (typeof data.error === 'string' && data.error)
    ? data.error
    : (typeof imageState.error === 'string' ? imageState.error : '');
  const Handle = actions.Handle;
  const Position = actions.Position || { Left: 'left', Right: 'right' };

  const { availableModels, chosenModel, modelOptions } = resolveImageNodeModelState(actions, params.model || data.model);
  const { rawRefs, totalRefs, effectiveCount, refCheck, referenceBadge, refBadgeColor, refBadgeBg } = computeImageReferenceMeta(actions, id, chosenModel);

  // 价格徽章计算 (先调 calculateImagePrice 得到价格字符串，再交 formatPriceBadge)
  const modelObj = availableModels.find((m) => m && m.id === chosenModel) || { id: chosenModel };
  let priceText = '';
  if (actions.CanvasPricingUtils && typeof actions.CanvasPricingUtils.calculateImagePrice === 'function') {
    try {
      const pInfo = actions.CanvasPricingUtils.calculateImagePrice(modelObj, {
        count: Number(params.count) || 1,
        isVip: actions.isVip,
        isSvip: actions.isSvip,
        isSuper: actions.isSuper
      });
      if (pInfo && pInfo.priceText) {
        priceText = typeof actions.CanvasPricingUtils.formatPriceBadge === 'function'
          ? actions.CanvasPricingUtils.formatPriceBadge(pInfo.priceText)
          : pInfo.priceText;
      }
    } catch (_) {}
  }
  if (!priceText && (modelObj.price === 0 || (typeof modelObj.tag === 'string' && modelObj.tag.includes('限免')))) {
    priceText = '限免';
  }

  return h('div', {
    style: {
      width: 280,
      minHeight: 380,
      borderRadius: 10,
      background: isDark ? '#18181c' : '#ffffff',
      border: selected ? '2px solid #3b82f6' : (isDark ? '1px solid rgba(255,255,255,0.1)' : '1px solid rgba(0,0,0,0.1)'),
      boxShadow: selected ? '0 0 0 2px rgba(59,130,246,0.2), 0 8px 24px rgba(0,0,0,0.3)' : '0 4px 16px rgba(0,0,0,0.15)',
      overflow: 'hidden',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontSize: 12,
      color: isDark ? '#e4e4e7' : '#18181b',
      boxSizing: 'border-box'
    }
  }, [
    // 输入端口 (左侧)
    Handle && h(Handle, {
      key: 'handle-panel-in',
      type: 'target',
      position: Position.Left,
      id: 'panel-in',
      style: { ...HANDLE_STYLE, top: '50%' }
    }),

    // 头部信息
    h('div', {
      key: 'header',
      style: {
        padding: '8px 12px',
        borderBottom: isDark ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(0,0,0,0.08)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 4,
        background: isDark ? '#141417' : '#f9fafb'
      }
    }, [
      h('div', { key: 'meta', style: { display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, flexWrap: 'wrap' } }, [
        h('span', {
          key: 'num-badge',
          style: {
            fontSize: 11,
            fontWeight: 700,
            padding: '2px 6px',
            borderRadius: 4,
            background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'
          }
        }, `#${num}`),
        h('span', {
          key: 'shot-badge',
          style: {
            fontSize: 10,
            padding: '2px 6px',
            borderRadius: 4,
            background: isDark ? 'rgba(59,130,246,0.15)' : 'rgba(59,130,246,0.1)',
            color: '#3b82f6',
            fontWeight: 600
          }
        }, shotLabel),
        priceText && h('span', {
          key: 'price-badge',
          style: {
            fontSize: 10,
            padding: '2px 5px',
            borderRadius: 4,
            background: isDark ? 'rgba(16,185,129,0.15)' : 'rgba(16,185,129,0.1)',
            color: '#10b981',
            fontWeight: 600
          }
        }, priceText),
        h('span', {
          key: 'ref-badge',
          style: {
            fontSize: 10,
            padding: '2px 5px',
            borderRadius: 4,
            background: refBadgeBg,
            color: refBadgeColor,
            fontWeight: 600,
            whiteSpace: 'nowrap'
          }
        }, referenceBadge)
      ]),
      h('div', { key: 'opts', style: { display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 } }, [
        h('select', {
          key: 'aspect-sel',
          value: aspectRatio,
          onChange: (e) => actions.updateNodeData?.(id, { aspectRatio: e.target.value, params: { ...params, aspectRatio: e.target.value } }),
          style: {
            background: isDark ? '#1f1f23' : '#f3f4f6',
            color: isDark ? '#ffffff' : '#000000',
            border: isDark ? '1px solid rgba(255,255,255,0.12)' : '1px solid rgba(0,0,0,0.12)',
            borderRadius: 4,
            fontSize: 10,
            padding: '2px 4px',
            outline: 'none'
          }
        }, [
          h('option', { key: '2:3', value: '2:3' }, '2:3'),
          h('option', { key: '16:9', value: '16:9' }, '16:9'),
          h('option', { key: '1:1', value: '1:1' }, '1:1'),
          h('option', { key: '4:3', value: '4:3' }, '4:3'),
          h('option', { key: '3:4', value: '3:4' }, '3:4')
        ]),
        h('button', {
          key: 'del-btn',
          onClick: (e) => { e.stopPropagation(); actions.deleteNode?.(id); },
          title: '删除分镜',
          style: {
            background: 'transparent',
            border: 'none',
            color: isDark ? '#71717a' : '#a1a1aa',
            cursor: 'pointer',
            padding: '2px 4px',
            fontSize: 14,
            lineHeight: 1
          }
        }, '×')
      ])
    ]),

    // 图片展台
    h('div', {
      key: 'stage',
      style: {
        width: '100%',
        height: 160,
        background: isDark ? '#0d0d0f' : '#f3f4f6',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        overflow: 'hidden'
      }
    }, [
      imageUrl ? h('img', {
        key: 'panel-img',
        src: imageUrl,
        alt: `分镜 #${num}`,
        style: { width: '100%', height: '100%', objectFit: 'contain' }
      }) : (
        isGenerating ? h('div', {
          key: 'gen-state',
          style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, color: '#3b82f6', fontSize: 11 }
        }, [
          h('div', { key: 'spinner', style: { width: 16, height: 16, border: '2px solid #3b82f6', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' } }),
          h('span', { key: 'status-txt' }, '正在生成分镜...')
        ]) : h('div', {
          key: 'placeholder',
          style: { color: errorText ? '#ef4444' : (isDark ? '#52525b' : '#9ca3af'), fontSize: 11, textAlign: 'center', padding: '0 10px', lineHeight: 1.4 }
        }, errorText ? `失败: ${errorText}` : '待生成画面')
      ),
      // 候选图角标
      candidates.length > 0 && h('div', {
        key: 'candidates-badge',
        style: {
          position: 'absolute',
          bottom: 6,
          right: 6,
          fontSize: 10,
          background: 'rgba(0,0,0,0.7)',
          color: '#ffffff',
          padding: '2px 6px',
          borderRadius: 4
        }
      }, `候选 ${candidates.length}`)
    ]),

    // 候选图切换栏 (若有)
    candidates.length > 0 && h('div', {
      key: 'candidates-bar',
      style: {
        padding: '6px 12px',
        display: 'flex',
        gap: 6,
        overflowX: 'auto',
        borderBottom: isDark ? '1px solid rgba(255,255,255,0.06)' : '1px solid rgba(0,0,0,0.06)',
        background: isDark ? '#141417' : '#fafafa'
      }
    }, candidates.map((c, cIdx) => {
      const cUrl = resolveAssetUrl(c, actions.canvasAssetsDriver);
      return h('img', {
        key: cIdx,
        src: cUrl,
        alt: `候选 ${cIdx + 1}`,
        onClick: () => actions.updateNodeData?.(id, { imageUrl: c, url: c }),
        style: {
          width: 32,
          height: 32,
          borderRadius: 4,
          objectFit: 'cover',
          cursor: 'pointer',
          border: imageUrl === cUrl ? '2px solid #3b82f6' : '1px solid rgba(255,255,255,0.1)'
        }
      });
    })),

    // 模型选择、参考序号带、错误提示、提示词与台词输入
    h('div', {
      key: 'inputs',
      style: { padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }
    }, [
      renderImageModelSelector({
        isDark,
        label: '分镜生图模型',
        chosenModel,
        modelOptions,
        onChange: (e) => {
          const nextModel = e.target.value;
          const nextObj = modelOptions.find(m => m && m.id === nextModel) || { id: nextModel };
          const nextCaps = getImageModelCapabilities(nextObj, nextModel);
          actions.updateNodeData?.(id, {
            params: {
              ...params,
              model: nextModel,
              aspectRatio: nextCaps.aspectRatios.includes(aspectRatio) ? aspectRatio : nextCaps.aspectRatios[0],
              quality: nextCaps.qualityOptions.includes(quality) ? quality : nextCaps.qualityOptions[0]
            }
          });
        }
      }),

      renderImageReferenceStrip({
        isDark,
        assetsDriver: actions.canvasAssetsDriver,
        rawRefs,
        totalRefs,
        effectiveCount,
        refCheck
      }),

      renderImageErrorBanner({ isDark, errorText }),

      h('div', { key: 'prompt-sec', style: { display: 'flex', flexDirection: 'column', gap: 4 } }, [
        h('label', { key: 'lbl', style: { fontSize: 10, color: isDark ? '#a1a1aa' : '#71717a' } }, '分镜画面提示词'),
        h('textarea', {
          key: 'txt',
          rows: 3,
          value: prompt,
          onChange: (e) => actions.updateNodeData?.(id, { prompt: e.target.value }),
          placeholder: '输入分镜画面光影构图与动作描述...',
          style: {
            width: '100%',
            padding: '6px 8px',
            borderRadius: 6,
            border: isDark ? '1px solid rgba(255,255,255,0.12)' : '1px solid rgba(0,0,0,0.12)',
            background: isDark ? '#1f1f23' : '#f3f4f6',
            color: isDark ? '#ffffff' : '#000000',
            fontSize: 11,
            lineHeight: 1.4,
            resize: 'none',
            outline: 'none',
            boxSizing: 'border-box'
          }
        })
      ]),

      h('div', { key: 'dialogue-sec', style: { display: 'flex', flexDirection: 'column', gap: 4 } }, [
        h('label', { key: 'lbl', style: { fontSize: 10, color: isDark ? '#a1a1aa' : '#71717a' } }, '对白台词'),
        h('input', {
          key: 'ipt',
          value: dialogue,
          onChange: (e) => actions.updateNodeData?.(id, { dialogue: e.target.value }),
          placeholder: '该镜头人物台词 (可选)',
          style: {
            width: '100%',
            padding: '4px 8px',
            borderRadius: 4,
            border: isDark ? '1px solid rgba(255,255,255,0.12)' : '1px solid rgba(0,0,0,0.12)',
            background: isDark ? '#1f1f23' : '#f3f4f6',
            color: isDark ? '#ffffff' : '#000000',
            fontSize: 11,
            outline: 'none',
            boxSizing: 'border-box'
          }
        })
      ]),

      // 生成操作按钮
      h('button', {
        key: 'gen-btn',
        disabled: isGenerating,
        onClick: (e) => { e.stopPropagation(); actions.generateNode?.(id); },
        style: {
          marginTop: 4,
          padding: '7px 12px',
          borderRadius: 6,
          background: isGenerating ? (isDark ? '#27272a' : '#e5e7eb') : '#3b82f6',
          color: isGenerating ? (isDark ? '#71717a' : '#9ca3af') : '#ffffff',
          border: 'none',
          fontWeight: 600,
          fontSize: 12,
          cursor: isGenerating ? 'not-allowed' : 'pointer',
          transition: 'background 0.2s'
        }
      }, isGenerating ? '正在生成...' : '生成分镜')
    ]),

    // 输出端口 (右侧)
    Handle && h(Handle, {
      key: 'handle-panel-out',
      type: 'source',
      position: Position.Right,
      id: 'panel-out',
      style: { ...HANDLE_STYLE, top: '50%' }
    })
  ]);
}

// 3. 自由图片节点 (ImageNode)
function ImageNode({ id, data, selected }) {
  const actions = React.useContext(NodeActionContext) || {};
  const theme = actions.theme || {};
  const isDark = theme.isDark !== false;
  const name = typeof data.name === 'string' ? data.name : '图片生成节点';
  const prompt = typeof data.prompt === 'string' ? data.prompt : '';
  const imageState = data.imageState || {};
  const url = resolveAssetUrl(data.url || imageState.url, actions.canvasAssetsDriver);
  const candidates = Array.isArray(data.candidates) ? data.candidates : [];
  const generating = Boolean(data.generating || imageState.status === 'generating');
  const errorText = (typeof data.error === 'string' && data.error)
    ? data.error
    : (typeof imageState.error === 'string' ? imageState.error : '');
  const params = data.params || {};
  const requestedAspectRatio = params.aspectRatio || '16:9';
  const requestedQuality = params.quality || '1K';
  const count = Number(params.count) || 1;
  const Handle = actions.Handle;
  const Position = actions.Position || { Left: 'left', Right: 'right' };

  const { chosenModel, modelOptions } = resolveImageNodeModelState(actions, params.model);
  const imageModel = modelOptions.find(m => m && m.id === chosenModel) || { id: chosenModel };
  const imageCaps = getImageModelCapabilities(imageModel, chosenModel);
  const aspectRatio = imageCaps.aspectRatios.includes(requestedAspectRatio) ? requestedAspectRatio : imageCaps.aspectRatios[0];
  const quality = imageCaps.qualityOptions.includes(requestedQuality) ? requestedQuality : imageCaps.qualityOptions[0];
  const { rawRefs, totalRefs, effectiveCount, refCheck, referenceBadge, refBadgeColor, refBadgeBg } = computeImageReferenceMeta(actions, id, chosenModel);

  const triggerLocalUpload = (e) => {
    if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
    if (typeof document === 'undefined' || typeof FileReader === 'undefined') return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp';
    input.onchange = () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        let dataUrl = String(reader.result || '');
        dataUrl = await downscaleReferenceImage(actions.CanvasVideoUtils || CanvasVideoUtils, dataUrl);
        let finalUrl = dataUrl;
        let assetKey = '';
        if (actions.canvasAssetsDriver && typeof actions.canvasAssetsDriver.saveDataUrl === 'function') {
          try {
            const saved = actions.canvasAssetsDriver.saveDataUrl(dataUrl);
            assetKey = saved.assetKey;
            finalUrl = `asset:${assetKey}`;
          } catch (_) {}
        }
        actions.updateNodeData?.(id, { url: finalUrl, assetKey, error: '' });
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };

  return h('div', {
    style: {
      width: 290,
      minHeight: 440,
      borderRadius: 10,
      background: isDark ? '#18181c' : '#ffffff',
      border: selected ? '2px solid #3b82f6' : (isDark ? '1px solid rgba(255,255,255,0.1)' : '1px solid rgba(0,0,0,0.1)'),
      boxShadow: selected ? '0 0 0 2px rgba(59,130,246,0.2), 0 8px 24px rgba(0,0,0,0.3)' : '0 4px 16px rgba(0,0,0,0.15)',
      overflow: 'hidden',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontSize: 12,
      color: isDark ? '#e4e4e7' : '#18181b',
      boxSizing: 'border-box'
    }
  }, [
    Handle && h(Handle, {
      key: 'handle-image-in',
      type: 'target',
      position: Position.Left,
      id: 'image-in',
      style: { ...HANDLE_STYLE, top: '50%' }
    }),

    // 头部
    h('div', {
      key: 'header',
      style: {
        padding: '8px 12px',
        borderBottom: isDark ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(0,0,0,0.08)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: isDark ? '#141417' : '#f9fafb'
      }
    }, [
      h('div', { key: 'badge', style: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 } }, [
        h('span', {
          key: 'tag',
          style: {
            fontSize: 10,
            padding: '2px 6px',
            borderRadius: 4,
            background: isDark ? 'rgba(59,130,246,0.15)' : 'rgba(59,130,246,0.1)',
            color: '#3b82f6',
            fontWeight: 600,
            flexShrink: 0
          }
        }, '图片'),
        h('span', { key: 'name', style: { fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, name),
        h('span', {
          key: 'ref',
          style: {
            fontSize: 10,
            padding: '2px 5px',
            borderRadius: 4,
            background: refBadgeBg,
            color: refBadgeColor,
            fontWeight: 600,
            whiteSpace: 'nowrap',
            flexShrink: 0
          }
        }, referenceBadge)
      ]),
      h('button', {
        key: 'del',
        onClick: (e) => { e.stopPropagation(); actions.deleteNode?.(id); },
        title: '删除节点',
        style: {
          background: 'transparent',
          border: 'none',
          color: isDark ? '#71717a' : '#a1a1aa',
          cursor: 'pointer',
          padding: '2px 4px',
          fontSize: 14,
          lineHeight: 1,
          flexShrink: 0
        }
      }, '×')
    ]),

    // 图片展台
    h('div', {
      key: 'stage',
      style: {
        width: '100%',
        height: 160,
        background: isDark ? '#0d0d0f' : '#f3f4f6',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        overflow: 'hidden'
      }
    }, [
      url ? h('img', {
        key: 'img-el',
        src: url,
        alt: name,
        style: { width: '100%', height: '100%', objectFit: 'contain' }
      }) : (
        generating ? h('div', {
          key: 'gen-state',
          style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, color: '#3b82f6', fontSize: 11 }
        }, [
          h('div', { key: 'spinner', style: { width: 16, height: 16, border: '2px solid #3b82f6', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' } }),
          h('span', { key: 'status-txt' }, '正在生成图片...')
        ]) : h('div', {
          key: 'placeholder',
          style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, color: errorText ? '#ef4444' : (isDark ? '#52525b' : '#9ca3af'), fontSize: 11, textAlign: 'center', padding: '0 10px' }
        }, [
          h('span', { key: 'txt', style: { lineHeight: 1.4 } }, errorText ? `失败: ${errorText}` : '待生图或上传参考'),
          h('button', {
            key: 'upload-btn',
            type: 'button',
            onClick: triggerLocalUpload,
            style: {
              background: 'transparent',
              border: isDark ? '1px solid rgba(255,255,255,0.16)' : '1px solid rgba(0,0,0,0.16)',
              borderRadius: 4,
              color: isDark ? '#a1a1aa' : '#52525b',
              fontSize: 10,
              padding: '2px 8px',
              cursor: 'pointer'
            }
          }, '上传参考图')
        ])
      ),
      url && !generating && h('button', {
        key: 'replace-btn',
        type: 'button',
        onClick: triggerLocalUpload,
        title: '上传本地图片替换当前画面',
        style: {
          position: 'absolute',
          top: 6,
          right: 6,
          fontSize: 10,
          background: 'rgba(0,0,0,0.65)',
          color: '#ffffff',
          border: '1px solid rgba(255,255,255,0.2)',
          padding: '2px 6px',
          borderRadius: 4,
          cursor: 'pointer'
        }
      }, '换图')
    ]),

    // 多候选图切换栏
    candidates.length > 1 && h('div', {
      key: 'candidates-bar',
      style: {
        padding: '6px 12px',
        display: 'flex',
        gap: 6,
        overflowX: 'auto',
        borderBottom: isDark ? '1px solid rgba(255,255,255,0.06)' : '1px solid rgba(0,0,0,0.06)',
        background: isDark ? '#141417' : '#fafafa'
      }
    }, candidates.map((c, cIdx) => {
      const cUrl = resolveAssetUrl(c, actions.canvasAssetsDriver);
      return h('img', {
        key: cIdx,
        src: cUrl,
        alt: `候选 ${cIdx + 1}`,
        onClick: () => actions.updateNodeData?.(id, { url: c }),
        style: {
          width: 32,
          height: 32,
          borderRadius: 4,
          objectFit: 'cover',
          cursor: 'pointer',
          border: url === cUrl ? '2px solid #3b82f6' : '1px solid rgba(255,255,255,0.1)'
        }
      });
    })),

    // 模型选择、参考序号带、错误提示、提示词与全量参数控制
    h('div', {
      key: 'body',
      style: { padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }
    }, [
      renderImageModelSelector({
        isDark,
        label: '图片模型',
        chosenModel,
        modelOptions,
        onChange: (e) => {
          const nextModel = e.target.value;
          const nextObj = modelOptions.find(m => m && m.id === nextModel) || { id: nextModel };
          const nextCaps = getImageModelCapabilities(nextObj, nextModel);
          actions.updateNodeData?.(id, {
            params: {
              ...params,
              model: nextModel,
              aspectRatio: nextCaps.aspectRatios.includes(aspectRatio) ? aspectRatio : nextCaps.aspectRatios[0],
              quality: nextCaps.qualityOptions.includes(quality) ? quality : nextCaps.qualityOptions[0]
            }
          });
        }
      }),

      renderImageReferenceStrip({
        isDark,
        assetsDriver: actions.canvasAssetsDriver,
        rawRefs,
        totalRefs,
        effectiveCount,
        refCheck
      }),

      renderImageErrorBanner({ isDark, errorText }),

      h('div', { key: 'prompt-sec', style: { display: 'flex', flexDirection: 'column', gap: 4 } }, [
        h('label', { key: 'lbl', style: { fontSize: 10, color: isDark ? '#a1a1aa' : '#71717a' } }, '提示词'),
        h('textarea', {
          key: 'txt',
          rows: 3,
          value: prompt,
          onChange: (e) => actions.updateNodeData?.(id, { prompt: e.target.value }),
          placeholder: '输入图片画面描述...',
          style: {
            width: '100%',
            padding: '6px 8px',
            borderRadius: 6,
            border: isDark ? '1px solid rgba(255,255,255,0.12)' : '1px solid rgba(0,0,0,0.12)',
            background: isDark ? '#1f1f23' : '#f3f4f6',
            color: isDark ? '#ffffff' : '#000000',
            fontSize: 11,
            lineHeight: 1.4,
            resize: 'none',
            outline: 'none',
            boxSizing: 'border-box'
          }
        })
      ]),

      // 全量图片参数控制：比例 1:1/16:9/9:16/4:3/3:4，画质 1K/2K/4K，张数 1/2/4
      h('div', {
        key: 'params-sec',
        style: {
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: 6,
          padding: '6px 8px',
          borderRadius: 6,
          background: isDark ? '#141417' : '#f9fafb'
        }
      }, [
        // 比例
        h('div', { key: 'ratio', style: { display: 'flex', flexDirection: 'column', gap: 2 } },
          h('label', { style: { fontSize: 10, color: isDark ? '#a1a1aa' : '#71717a' } }, '比例'),
          h('select', {
            value: aspectRatio,
            onChange: (e) => actions.updateNodeData?.(id, { params: { ...params, aspectRatio: e.target.value } }),
            style: {
              background: isDark ? '#1f1f23' : '#ffffff',
              color: isDark ? '#ffffff' : '#000000',
              border: isDark ? '1px solid rgba(255,255,255,0.12)' : '1px solid rgba(0,0,0,0.12)',
              borderRadius: 4,
              fontSize: 10,
              padding: '2px 4px',
              outline: 'none'
            }
          }, imageCaps.aspectRatios.map(r => h('option', { key: r, value: r }, r)))
        ),
        // 画质
        h('div', { key: 'quality', style: { display: 'flex', flexDirection: 'column', gap: 2 } },
          h('label', { style: { fontSize: 10, color: isDark ? '#a1a1aa' : '#71717a' } }, '画质'),
          h('select', {
            value: quality,
            onChange: (e) => actions.updateNodeData?.(id, { params: { ...params, quality: e.target.value } }),
            style: {
              background: isDark ? '#1f1f23' : '#ffffff',
              color: isDark ? '#ffffff' : '#000000',
              border: isDark ? '1px solid rgba(255,255,255,0.12)' : '1px solid rgba(0,0,0,0.12)',
              borderRadius: 4,
              fontSize: 10,
              padding: '2px 4px',
              outline: 'none'
            }
          }, imageCaps.qualityOptions.map(q => h('option', { key: q, value: q }, q)))
        ),
        // 张数
        h('div', { key: 'count', style: { display: 'flex', flexDirection: 'column', gap: 2 } },
          h('label', { style: { fontSize: 10, color: isDark ? '#a1a1aa' : '#71717a' } }, '张数'),
          h('select', {
            value: count,
            onChange: (e) => actions.updateNodeData?.(id, { params: { ...params, count: Number(e.target.value) } }),
            style: {
              background: isDark ? '#1f1f23' : '#ffffff',
              color: isDark ? '#ffffff' : '#000000',
              border: isDark ? '1px solid rgba(255,255,255,0.12)' : '1px solid rgba(0,0,0,0.12)',
              borderRadius: 4,
              fontSize: 10,
              padding: '2px 4px',
              outline: 'none'
            }
          }, [1, 2, 4].map(c => h('option', { key: c, value: c }, `${c}张`)))
        )
      ]),

      // 重新生成按钮
      h('button', {
        key: 'gen-btn',
        disabled: generating,
        onClick: (e) => { e.stopPropagation(); actions.generateNode?.(id); },
        style: {
          marginTop: 4,
          padding: '7px 12px',
          borderRadius: 6,
          background: generating ? (isDark ? '#27272a' : '#e5e7eb') : '#3b82f6',
          color: generating ? (isDark ? '#71717a' : '#9ca3af') : '#ffffff',
          border: 'none',
          fontWeight: 600,
          fontSize: 12,
          cursor: generating ? 'not-allowed' : 'pointer',
          transition: 'background 0.2s'
        }
      }, generating ? '正在生成...' : '生成图片')
    ]),

    Handle && h(Handle, {
      key: 'handle-image-out',
      type: 'source',
      position: Position.Right,
      id: 'image-out',
      style: { ...HANDLE_STYLE, top: '50%' }
    })
  ]);
}

// 4. 视频生成节点 (VideoNode)
function VideoNode({ id, data, selected }) {
  const actions = React.useContext(NodeActionContext) || {};
  const theme = actions.theme || {};
  const isDark = theme.isDark !== false;
  const name = typeof data.name === 'string' ? data.name : '视频生成节点';
  const prompt = typeof data.prompt === 'string' ? data.prompt : '';
  const videoState = data.videoState || {};
  const videoUtils = actions.CanvasVideoUtils !== undefined ? actions.CanvasVideoUtils : CanvasVideoUtils;
  const videoUrl = resolveAssetUrl(videoState.videoUrl || data.url, actions.canvasAssetsDriver);
  const isBusy = (videoUtils && typeof videoUtils.isBusy === 'function')
    ? videoUtils.isBusy(videoState)
    : (videoState.status === 'submitting' || videoState.status === 'polling');
  const params = data.params || {};
  const availableModels = (Array.isArray(actions.availableVideoModels) && actions.availableVideoModels.length > 0)
    ? actions.availableVideoModels
    : DEFAULT_VIDEO_MODELS_FALLBACK;
  const chosenModel = params.model || (availableModels[0] && availableModels[0].id) || 'MiniMax-H3';
  const modelOptions = availableModels.some((m) => m && m.id === chosenModel)
    ? availableModels
    : [{ id: chosenModel, name: chosenModel, tag: '' }, ...availableModels];
  const caps = resolveVideoNodeOptions(videoUtils, chosenModel);
  const durationOptions = caps.durations;
  const resolutionOptions = caps.resolutions;
  const aspectRatioOptions = caps.aspectRatios;
  const requestedDuration = Number(params.duration) || 5;
  const duration = durationOptions.includes(requestedDuration) ? requestedDuration : durationOptions[0];
  const requestedResolution = params.resolution || '720P';
  const resolution = resolutionOptions.includes(requestedResolution) ? requestedResolution : resolutionOptions[0];
  const requestedAspectRatio = params.aspectRatio || '16:9';
  const aspectRatio = aspectRatioOptions.includes(requestedAspectRatio) ? requestedAspectRatio : aspectRatioOptions[0];
  const generateAudio = Boolean(params.generateAudio);
  const Handle = actions.Handle;
  const Position = actions.Position || { Left: 'left', Right: 'right' };

  // 全能参考解析状态指示 (含模型上限校验与超限预警)
  const ctx = (actions.genContextMap && actions.genContextMap[id]) ? actions.genContextMap[id] : null;
  const rawRefs = (ctx && Array.isArray(ctx.referenceImages))
    ? ctx.referenceImages.filter((r) => typeof r === 'string' && r.trim())
    : [];
  const totalRefs = rawRefs.length;
  const effectiveCount = Math.min(totalRefs, caps.maxRefImages);
  let referenceBadge = '文生视频';
  let refBadgeColor = '#a855f7';
  let refBadgeBg = isDark ? 'rgba(168,85,247,0.15)' : 'rgba(168,85,247,0.1)';
  if (totalRefs === 1) {
    referenceBadge = '单图首帧';
  } else if (totalRefs > 1) {
    if (!caps.supportsMultiRef) {
      referenceBadge = `仅用首帧 (共${totalRefs}图/限1图)`;
      refBadgeColor = '#f59e0b';
      refBadgeBg = isDark ? 'rgba(245,158,11,0.16)' : 'rgba(245,158,11,0.12)';
    } else if (totalRefs > caps.maxRefImages) {
      referenceBadge = `全能参考 (仅前${caps.maxRefImages}/共${totalRefs}图)`;
      refBadgeColor = '#f59e0b';
      refBadgeBg = isDark ? 'rgba(245,158,11,0.16)' : 'rgba(245,158,11,0.12)';
    } else {
      referenceBadge = `全能参考 (${totalRefs}图)`;
      refBadgeColor = '#10b981';
      refBadgeBg = isDark ? 'rgba(16,185,129,0.16)' : 'rgba(16,185,129,0.12)';
    }
  }

  return h('div', {
    style: {
      width: 330,
      minHeight: 480,
      borderRadius: 10,
      background: isDark ? '#18181c' : '#ffffff',
      border: selected ? '2px solid #3b82f6' : (isDark ? '1px solid rgba(255,255,255,0.1)' : '1px solid rgba(0,0,0,0.1)'),
      boxShadow: selected ? '0 0 0 2px rgba(59,130,246,0.2), 0 8px 24px rgba(0,0,0,0.3)' : '0 4px 16px rgba(0,0,0,0.15)',
      overflow: 'hidden',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontSize: 12,
      color: isDark ? '#e4e4e7' : '#18181b',
      boxSizing: 'border-box'
    }
  }, [
    Handle && h(Handle, {
      key: 'handle-video-in',
      type: 'target',
      position: Position.Left,
      id: 'video-in',
      style: { ...HANDLE_STYLE, top: '50%' }
    }),

    // 头部
    h('div', {
      key: 'header',
      style: {
        padding: '8px 12px',
        borderBottom: isDark ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(0,0,0,0.08)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: isDark ? '#141417' : '#f9fafb'
      }
    }, [
      h('div', { key: 'badge', style: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 } }, [
        h('span', {
          key: 'tag',
          style: {
            fontSize: 10,
            padding: '2px 6px',
            borderRadius: 4,
            background: isDark ? 'rgba(59,130,246,0.15)' : 'rgba(59,130,246,0.1)',
            color: '#3b82f6',
            fontWeight: 600,
            flexShrink: 0
          }
        }, '视频'),
        h('span', { key: 'title', style: { fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, name),
        h('span', {
          key: 'ref',
          style: {
            fontSize: 10,
            padding: '2px 5px',
            borderRadius: 4,
            background: refBadgeBg,
            color: refBadgeColor,
            fontWeight: 600,
            whiteSpace: 'nowrap',
            flexShrink: 0
          }
        }, referenceBadge)
      ]),
      h('button', {
        key: 'del',
        onClick: (e) => { e.stopPropagation(); actions.deleteNode?.(id); },
        title: '删除节点',
        style: {
          background: 'transparent',
          border: 'none',
          color: isDark ? '#71717a' : '#a1a1aa',
          cursor: 'pointer',
          padding: '2px 4px',
          fontSize: 14,
          lineHeight: 1,
          flexShrink: 0
        }
      }, '×')
    ]),

    // 视频容器
    h('div', {
      key: 'player',
      style: {
        width: '100%',
        height: 170,
        background: isDark ? '#0d0d0f' : '#000000',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        overflow: 'hidden'
      }
    }, [
      videoUrl ? h('video', {
        key: 'video-el',
        src: videoUrl,
        controls: true,
        style: { width: '100%', height: '100%', objectFit: 'contain' }
      }) : (
        isBusy ? h('div', {
          key: 'busy-state',
          style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, color: '#3b82f6', fontSize: 11, padding: '0 12px', textAlign: 'center' }
        }, [
          h('div', { key: 'spinner', style: { width: 18, height: 18, border: '2px solid #3b82f6', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' } }),
          h('span', { key: 'status-txt' }, videoState.status === 'polling' ? `正在渲染视频 (第 ${videoState.attempt || 1} 次轮询)` : '提交生成任务...'),
          actions.cancelVideoNode && h('button', {
            key: 'cancel-btn',
            type: 'button',
            onClick: (e) => { e.stopPropagation(); actions.cancelVideoNode(id); },
            style: {
              background: 'transparent',
              border: isDark ? '1px solid rgba(255,255,255,0.2)' : '1px solid rgba(255,255,255,0.3)',
              borderRadius: 4,
              color: '#e4e4e7',
              fontSize: 10,
              padding: '2px 8px',
              cursor: 'pointer'
            }
          }, '取消轮询')
        ]) : h('div', {
          key: 'idle-placeholder',
          style: { color: videoState.error ? '#ef4444' : (isDark ? '#52525b' : '#9ca3af'), fontSize: 11, textAlign: 'center', padding: '0 12px', lineHeight: 1.4 }
        }, videoState.error ? `失败: ${videoState.error}` : '待生成视频 (接入上游图片可升级全能参考)')
      )
    ]),

    // 模型选择、参考序号带、提示词与全量参数控制
    h('div', {
      key: 'body',
      style: { padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }
    }, [
      // 模型选择器
      h('div', { key: 'model-sec', style: { display: 'flex', flexDirection: 'column', gap: 2 } }, [
        h('label', { key: 'lbl', style: { fontSize: 10, color: isDark ? '#a1a1aa' : '#71717a' } }, '视频模型'),
        h('select', {
          key: 'model-sel',
          value: chosenModel,
          onChange: (e) => {
            const nextModel = e.target.value;
            const nextCaps = resolveVideoNodeOptions(videoUtils, nextModel);
            const nextDur = nextCaps.durations.includes(duration) ? duration : nextCaps.durations[0];
            const nextRes = nextCaps.resolutions.includes(resolution) ? resolution : nextCaps.resolutions[0];
            const nextRatio = nextCaps.aspectRatios.includes(aspectRatio) ? aspectRatio : nextCaps.aspectRatios[0];
            actions.updateNodeData?.(id, {
              params: {
                ...params,
                model: nextModel,
                resolution: nextRes,
                duration: nextDur,
                aspectRatio: nextRatio,
                size: videoSizeForNode(nextRes, nextRatio),
                generateAudio: /^omni-1\.2-flash$/i.test(nextModel) ? Boolean(params.generateAudio) : false
              }
            });
          },
          style: {
            width: '100%',
            background: isDark ? '#1f1f23' : '#f3f4f6',
            color: isDark ? '#ffffff' : '#000000',
            border: isDark ? '1px solid rgba(255,255,255,0.12)' : '1px solid rgba(0,0,0,0.12)',
            borderRadius: 4,
            fontSize: 11,
            padding: '4px 6px',
            outline: 'none'
          }
        }, modelOptions.map((m) => h('option', { key: m.id, value: m.id }, m.name ? `${m.name}${m.tag ? ' [' + m.tag + ']' : ''}` : m.id)))
      ]),

      // 上游参考图序号缩略带 (图1/图2...)
      totalRefs > 0 && h('div', {
        key: 'refs-strip',
        style: {
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          padding: '6px 8px',
          borderRadius: 6,
          background: isDark ? '#141417' : '#f9fafb',
          border: isDark ? '1px solid rgba(255,255,255,0.06)' : '1px solid rgba(0,0,0,0.06)'
        }
      }, [
        h('div', {
          key: 'refs-hdr',
          style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 10, color: isDark ? '#a1a1aa' : '#71717a' }
        }, [
          h('span', { key: 't' }, `参考图序 (生效 ${effectiveCount}/${totalRefs} 张)`),
          totalRefs > caps.maxRefImages && h('span', { key: 'w', style: { color: '#f59e0b', fontWeight: 600 } }, `超出上限(${caps.maxRefImages})将忽略`)
        ]),
        h('div', {
          key: 'refs-list',
          style: { display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }
        }, rawRefs.map((refVal, idx) => {
          const resolved = resolveAssetUrl(refVal, actions.canvasAssetsDriver);
          const isDropped = idx >= caps.maxRefImages;
          return h('div', {
            key: `${idx}_${refVal.slice(0, 24)}`,
            title: isDropped ? `图${idx + 1}: 超出当前模型上限 (${caps.maxRefImages}张)，本次不提交` : `图${idx + 1} (按连线顺序传入)`,
            style: {
              position: 'relative',
              width: 36,
              height: 36,
              borderRadius: 4,
              overflow: 'hidden',
              flexShrink: 0,
              opacity: isDropped ? 0.42 : 1,
              border: isDropped ? '1px solid #f59e0b' : (isDark ? '1px solid rgba(255,255,255,0.16)' : '1px solid rgba(0,0,0,0.14)'),
              background: isDark ? '#27272a' : '#e5e7eb'
            }
          }, [
            resolved ? h('img', {
              key: 'img',
              src: resolved,
              alt: `图${idx + 1}`,
              style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' }
            }) : null,
            h('div', {
              key: 'idx',
              style: {
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                background: isDropped ? 'rgba(245,158,11,0.88)' : 'rgba(0,0,0,0.7)',
                color: '#ffffff',
                fontSize: 9,
                lineHeight: '12px',
                textAlign: 'center',
                fontWeight: 600
              }
            }, isDropped ? '忽略' : `图${idx + 1}`)
          ]);
        }))
      ]),

      h('div', { key: 'prompt-sec', style: { display: 'flex', flexDirection: 'column', gap: 4 } }, [
        h('label', { key: 'lbl', style: { fontSize: 10, color: isDark ? '#a1a1aa' : '#71717a' } }, '运镜与动态描述'),
        h('textarea', {
          key: 'txt',
          rows: 3,
          value: prompt,
          onChange: (e) => actions.updateNodeData?.(id, { prompt: e.target.value }),
          placeholder: '输入运镜推进、光影流动等动态描述...',
          style: {
            width: '100%',
            padding: '6px 8px',
            borderRadius: 6,
            border: isDark ? '1px solid rgba(255,255,255,0.12)' : '1px solid rgba(0,0,0,0.12)',
            background: isDark ? '#1f1f23' : '#f3f4f6',
            color: isDark ? '#ffffff' : '#000000',
            fontSize: 11,
            lineHeight: 1.4,
            resize: 'none',
            outline: 'none',
            boxSizing: 'border-box'
          }
        })
      ]),

      // 现行全量视频参数：时长 3/4/5/6/10/15 秒、720P/1080P/2K、比例、音频开关
      h('div', {
        key: 'params-sec',
        style: {
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 6,
          padding: '6px 8px',
          borderRadius: 6,
          background: isDark ? '#141417' : '#f9fafb'
        }
      }, [
        // 时长
        h('div', { key: 'duration', style: { display: 'flex', flexDirection: 'column', gap: 2 } },
          h('label', { style: { fontSize: 10, color: isDark ? '#a1a1aa' : '#71717a' } }, '时长'),
          h('select', {
            value: duration,
            onChange: (e) => actions.updateNodeData?.(id, { params: { ...params, duration: Number(e.target.value) } }),
            style: {
              background: isDark ? '#1f1f23' : '#ffffff',
              color: isDark ? '#ffffff' : '#000000',
              border: isDark ? '1px solid rgba(255,255,255,0.12)' : '1px solid rgba(0,0,0,0.12)',
              borderRadius: 4,
              fontSize: 10,
              padding: '2px 4px',
              outline: 'none'
            }
          }, durationOptions.map(d => h('option', { key: d, value: d }, `${d}秒`)))
        ),

        // 分辨率
        h('div', { key: 'resolution', style: { display: 'flex', flexDirection: 'column', gap: 2 } },
          h('label', { style: { fontSize: 10, color: isDark ? '#a1a1aa' : '#71717a' } }, '分辨率'),
          h('select', {
            value: resolution,
            onChange: (e) => actions.updateNodeData?.(id, { params: { ...params, resolution: e.target.value } }),
            style: {
              background: isDark ? '#1f1f23' : '#ffffff',
              color: isDark ? '#ffffff' : '#000000',
              border: isDark ? '1px solid rgba(255,255,255,0.12)' : '1px solid rgba(0,0,0,0.12)',
              borderRadius: 4,
              fontSize: 10,
              padding: '2px 4px',
              outline: 'none'
            }
          }, resolutionOptions.map(r => h('option', { key: r, value: r }, r)))
        ),

        // 比例
        h('div', { key: 'aspectRatio', style: { display: 'flex', flexDirection: 'column', gap: 2 } },
          h('label', { style: { fontSize: 10, color: isDark ? '#a1a1aa' : '#71717a' } }, '比例'),
          h('select', {
            value: aspectRatio,
            onChange: (e) => actions.updateNodeData?.(id, { params: { ...params, aspectRatio: e.target.value, size: videoSizeForNode(resolution, e.target.value) } }),
            style: {
              background: isDark ? '#1f1f23' : '#ffffff',
              color: isDark ? '#ffffff' : '#000000',
              border: isDark ? '1px solid rgba(255,255,255,0.12)' : '1px solid rgba(0,0,0,0.12)',
              borderRadius: 4,
              fontSize: 10,
              padding: '2px 4px',
              outline: 'none'
            }
          }, aspectRatioOptions.map(a => h('option', { key: a, value: a }, a)))
        ),

        // 音频开关
        h('div', { key: 'generateAudio', style: { display: 'flex', flexDirection: 'column', gap: 2 } },
          h('label', { style: { fontSize: 10, color: isDark ? '#a1a1aa' : '#71717a' } }, '原生音频'),
          h('select', {
            value: generateAudio ? 'true' : 'false',
            onChange: (e) => actions.updateNodeData?.(id, { params: { ...params, generateAudio: e.target.value === 'true' } }),
            style: {
              background: isDark ? '#1f1f23' : '#ffffff',
              color: isDark ? '#ffffff' : '#000000',
              border: isDark ? '1px solid rgba(255,255,255,0.12)' : '1px solid rgba(0,0,0,0.12)',
              borderRadius: 4,
              fontSize: 10,
              padding: '2px 4px',
              outline: 'none'
            }
          }, [
            h('option', { key: 'off', value: 'false' }, '关闭'),
            h('option', { key: 'on', value: 'true' }, '开启')
          ])
        )
      ]),

      // 生成操作按钮
      h('button', {
        key: 'gen-btn',
        disabled: isBusy,
        onClick: (e) => { e.stopPropagation(); actions.generateNode?.(id); },
        style: {
          marginTop: 4,
          padding: '7px 12px',
          borderRadius: 6,
          background: isBusy ? (isDark ? '#27272a' : '#e5e7eb') : '#3b82f6',
          color: isBusy ? (isDark ? '#71717a' : '#9ca3af') : '#ffffff',
          border: 'none',
          fontWeight: 600,
          fontSize: 12,
          cursor: isBusy ? 'not-allowed' : 'pointer',
          transition: 'background 0.2s'
        }
      }, isBusy ? '正在处理中...' : '生成视频')
    ]),

    Handle && h(Handle, {
      key: 'handle-video-out',
      type: 'source',
      position: Position.Right,
      id: 'video-out',
      style: { ...HANDLE_STYLE, top: '50%' }
    })
  ]);
}

// 5. 自由文本节点 (TextNode)
function TextNode({ id, data, selected }) {
  const actions = React.useContext(NodeActionContext) || {};
  const theme = actions.theme || {};
  const isDark = theme.isDark !== false;
  const name = typeof data.name === 'string' ? data.name : '文本便签';
  const text = typeof data.text === 'string' ? data.text : '';
  const Handle = actions.Handle;
  const Position = actions.Position || { Right: 'right' };

  return h('div', {
    style: {
      width: 240,
      minHeight: 150,
      borderRadius: 10,
      background: isDark ? '#18181c' : '#ffffff',
      border: selected ? '2px solid #3b82f6' : (isDark ? '1px solid rgba(255,255,255,0.1)' : '1px solid rgba(0,0,0,0.1)'),
      boxShadow: selected ? '0 0 0 2px rgba(59,130,246,0.2), 0 8px 24px rgba(0,0,0,0.3)' : '0 4px 16px rgba(0,0,0,0.15)',
      overflow: 'hidden',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontSize: 12,
      color: isDark ? '#e4e4e7' : '#18181b',
      boxSizing: 'border-box'
    }
  }, [
    // 头部
    h('div', {
      key: 'header',
      style: {
        padding: '8px 12px',
        borderBottom: isDark ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(0,0,0,0.08)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: isDark ? '#141417' : '#f9fafb'
      }
    }, [
      h('div', { key: 'badge', style: { display: 'flex', alignItems: 'center', gap: 6 } }, [
        h('span', {
          key: 'tag',
          style: {
            fontSize: 10,
            padding: '2px 6px',
            borderRadius: 4,
            background: isDark ? 'rgba(59,130,246,0.15)' : 'rgba(59,130,246,0.1)',
            color: '#3b82f6',
            fontWeight: 600
          }
        }, '文本'),
        h('span', { key: 'name', style: { fontWeight: 600 } }, name)
      ]),
      h('button', {
        key: 'del',
        onClick: (e) => { e.stopPropagation(); actions.deleteNode?.(id); },
        title: '删除节点',
        style: {
          background: 'transparent',
          border: 'none',
          color: isDark ? '#71717a' : '#a1a1aa',
          cursor: 'pointer',
          padding: '2px 4px',
          fontSize: 14,
          lineHeight: 1
        }
      }, '×')
    ]),

    // 内容输入
    h('div', {
      key: 'body',
      style: { padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }
    }, [
      h('textarea', {
        rows: 4,
        value: text,
        onChange: (e) => actions.updateNodeData?.(id, { text: e.target.value }),
        placeholder: '输入便签、剧本文段或通用提示词片段...',
        style: {
          width: '100%',
          padding: '6px 8px',
          borderRadius: 6,
          border: isDark ? '1px solid rgba(255,255,255,0.12)' : '1px solid rgba(0,0,0,0.12)',
          background: isDark ? '#1f1f23' : '#f3f4f6',
          color: isDark ? '#ffffff' : '#000000',
          fontSize: 11,
          lineHeight: 1.4,
          resize: 'none',
          outline: 'none',
          boxSizing: 'border-box'
        }
      })
    ]),

    Handle && h(Handle, {
      key: 'handle-text-out',
      type: 'source',
      position: Position.Right,
      id: 'text-out',
      style: { ...HANDLE_STYLE, top: '50%' }
    })
  ]);
}

// 6. 分组容器节点 (GroupNode)
function GroupNode({ id, data, selected }) {
  const actions = React.useContext(NodeActionContext) || {};
  const theme = actions.theme || {};
  const isDark = theme.isDark !== false;
  const name = typeof data.name === 'string' ? data.name : '未命名分组';

  return h('div', {
    style: {
      width: '100%',
      height: '100%',
      minWidth: 300,
      minHeight: 200,
      borderRadius: 12,
      border: selected ? '2px dashed #3b82f6' : (isDark ? '1px dashed rgba(255,255,255,0.2)' : '1px dashed rgba(0,0,0,0.2)'),
      background: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)',
      padding: '8px 12px',
      boxSizing: 'border-box',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    }
  }, [
    h('div', {
      key: 'title-bar',
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 8
      }
    }, [
      h('span', {
        style: {
          fontSize: 11,
          fontWeight: 600,
          color: isDark ? '#a1a1aa' : '#71717a'
        }
      }, `分组: ${name}`),
      h('button', {
        onClick: (e) => { e.stopPropagation(); actions.deleteNode?.(id); },
        title: '删除分组',
        style: {
          background: 'transparent',
          border: 'none',
          color: isDark ? '#71717a' : '#a1a1aa',
          cursor: 'pointer',
          fontSize: 14
        }
      }, '×')
    ])
  ]);
}

// 自定义节点类型注册映射 (双别名兼容)
const NODE_TYPES_MAPPING = {
  characterNode: CharacterNode,
  character: CharacterNode,
  panelNode: PanelNode,
  panel: PanelNode,
  imageNode: ImageNode,
  image: ImageNode,
  videoNode: VideoNode,
  video: VideoNode,
  textNode: TextNode,
  text: TextNode,
  groupNode: GroupNode,
  group: GroupNode
};

/**
 * 样式注入单例
 */
function injectXyFlowStyles(cssText) {
  if (typeof document === 'undefined' || !cssText) return;
  if (!document.getElementById('winetoken-xyflow-style')) {
    try {
      const styleEl = document.createElement('style');
      styleEl.id = 'winetoken-xyflow-style';
      styleEl.textContent = cssText;
      document.head.appendChild(styleEl);
    } catch (_) {}
  }
}

/**
 * 构建 React Flow 画布工作台组件 (createReactFlowWorkspace)
 */
function createReactFlowWorkspace(deps = {}) {
  // 提取运行时依赖
  const R = deps.React || React;
  const initXyFlow = deps.initXyFlow || initXyFlowFactory;
  const projectStore = deps.canvasProjectStore;
  const assetsDriver = deps.canvasAssetsDriver;
  const historyMgr = deps.canvasHistoryManager;
  const promptUtils = deps.CanvasPromptUtils || CanvasPromptUtils;
  const nodeUtils = deps.CanvasNodeUtils || CanvasNodeUtils;
  const pricingUtils = deps.CanvasPricingUtils || CanvasPricingUtils;
  const videoUtils = deps.CanvasVideoUtils !== undefined ? deps.CanvasVideoUtils : CanvasVideoUtils;
  const exportUtils = deps.CanvasExportUtils || CanvasExportUtils;
  const jobQueue = deps.CanvasJobQueueSingleton || deps.canvasJobQueue || null;
  const manifestMgr = deps.WineTokenManifestManager || deps.manifestManager || null;

  // 水合 React Flow 实例
  let xyFlow = null;
  if (typeof initXyFlow === 'function') {
    try {
      xyFlow = initXyFlow(R, deps.ReactDOM);
    } catch (_) {}
  }

  // 默认初始模板
  const defaultInitialProject = {
    version: '2.5.1',
    nodes: [
      {
        id: 'char_chuyun',
        type: 'characterNode',
        position: { x: 40, y: 60 },
        data: { name: '主角·楚云', dna: '少年剑客，黑袍高领，银白碎发，剑眉星目，冷峻英气，电影质感', avatar: '', tags: ['主角'] }
      },
      {
        id: 'shot_01',
        type: 'panelNode',
        position: { x: 360, y: 60 },
        width: 280,
        height: 420,
        data: {
          num: 1,
          prompt: '少年剑客面部特写，发丝微动，冷峻眼神，侧逆光，细致皮肤纹理，虚化背景，电影光影',
          dialogue: '“这一剑，我已等了三年。”',
          characterId: 'char_chuyun',
          shot: 'CU',
          shotLabel: '特写',
          aspectRatio: '2:3',
          imageUrl: '',
          candidates: [],
          status: 'idle',
          isGenerating: false,
          tags: ['开场']
        }
      },
      {
        id: 'shot_02',
        type: 'panelNode',
        position: { x: 690, y: 60 },
        width: 360,
        height: 240,
        data: {
          num: 2,
          prompt: '雨夜长街，黑袍剑客拔剑而立，剑锋泛起寒光，雨水飞溅，深邃冷色调，宽银幕构图',
          dialogue: '长街风雨骤急，杀气四伏。',
          characterId: 'char_chuyun',
          shot: 'MS',
          shotLabel: '中景',
          aspectRatio: '16:9',
          imageUrl: '',
          candidates: [],
          status: 'idle',
          isGenerating: false,
          tags: ['交锋']
        }
      }
    ],
    edges: [
      { id: 'e_char_shot1', source: 'char_chuyun', target: 'shot_01', type: 'default' },
      { id: 'e_shot1_shot2', source: 'shot_01', target: 'shot_02', type: 'default' }
    ],
    viewport: { x: 40, y: 30, zoom: 1 }
  };

  function ReactFlowWorkspaceComponent({ theme, isVip, isSvip, isSuper, availableImageModels: propImageModels, availableVideoModels: propVideoModels, onOpenTutorial }) {
    const isDark = theme ? Boolean(theme.isDark) : true;
    const containerRef = R.useRef(null);
    const videoPollAbortRef = R.useRef(new Map());
    const [, setManifestTick] = R.useState(0);
    R.useEffect(() => {
      if (manifestMgr && typeof manifestMgr.subscribe === 'function') {
        return manifestMgr.subscribe(() => setManifestTick((t) => t + 1));
      }
    }, [manifestMgr]);

    const rawImgModels = (Array.isArray(propImageModels) && propImageModels.length > 0)
      ? propImageModels
      : ((typeof deps.getImageModels === 'function' ? deps.getImageModels() : null)
        || (manifestMgr && typeof manifestMgr.getImageModels === 'function' ? manifestMgr.getImageModels() : null)
        || deps.availableImageModels);
    const liveImageModels = resolveImageModelList(rawImgModels);
    const defaultImageModel = pickDefaultImageModel(liveImageModels, manifestMgr);

    const liveVideoModels = (Array.isArray(propVideoModels) && propVideoModels.length > 0)
      ? propVideoModels
      : ((typeof deps.getVideoModels === 'function' ? deps.getVideoModels() : null)
        || (manifestMgr && typeof manifestMgr.getVideoModels === 'function' ? manifestMgr.getVideoModels() : null)
        || deps.availableVideoModels
        || DEFAULT_VIDEO_MODELS_FALLBACK);

    // 样式注入
    R.useEffect(() => {
      if (xyFlow && xyFlow.cssText) {
        injectXyFlowStyles(xyFlow.cssText);
      }
    }, []);

    // 三级水合恢复机制
    const initialProject = R.useMemo(() => {
      const mem = (typeof window !== 'undefined') ? window.__WINETOKEN_CANVAS_MEMORY_STORE__ : null;
      if (mem && Array.isArray(mem.nodes) && mem.nodes.length > 0) {
        return mem;
      }
      if (projectStore) {
        try {
          projectStore.ensureLegacyMigration?.();
          const activeId = projectStore.getActiveId?.();
          if (activeId) {
            const active = projectStore.loadProject?.(activeId);
            if (active && Array.isArray(active.nodes)) return active;
          }
        } catch (_) {}
      }
      try {
        if (typeof localStorage !== 'undefined') {
          const raw = localStorage.getItem('__winetoken_canvas_snapshot__');
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && Array.isArray(parsed.nodes)) return parsed;
          }
        }
      } catch (_) {}
      return defaultInitialProject;
    }, []);

    const [nodes, setNodes] = R.useState(() => initialProject.nodes || defaultInitialProject.nodes);
    const [edges, setEdges] = R.useState(() => {
      const eds = initialProject.edges || defaultInitialProject.edges;
      return eds.map(e => ({ ...e, type: 'default' }));
    });
    const [viewport, setViewport] = R.useState(() => initialProject.viewport || { x: 40, y: 30, zoom: 1 });
    const [addMenu, setAddMenu] = R.useState(null); // { screenX, screenY, flowX, flowY }

    // 视口变动同步
    const onMoveEnd = R.useCallback((event, newViewport) => {
      if (newViewport) {
        setViewport(newViewport);
      }
    }, []);

    // 节点与边变动钩子
    const onNodesChange = R.useCallback((changes) => {
      if (xyFlow && typeof xyFlow.applyNodeChanges === 'function') {
        setNodes((nds) => xyFlow.applyNodeChanges(changes, nds));
      }
    }, []);

    const onEdgesChange = R.useCallback((changes) => {
      if (xyFlow && typeof xyFlow.applyEdgeChanges === 'function') {
        setEdges((eds) => xyFlow.applyEdgeChanges(changes, eds));
      }
    }, []);

    const onConnect = R.useCallback((connection) => {
      // 必须使用 'default' 边类型，严禁出现 'bezier'
      const newEdge = {
        ...connection,
        id: `edge_${connection.source}_${connection.target}_${Date.now()}`,
        type: 'default'
      };
      if (xyFlow && typeof xyFlow.addEdge === 'function') {
        setEdges((eds) => xyFlow.addEdge(newEdge, eds));
      } else {
        setEdges((eds) => [...eds, newEdge]);
      }
    }, []);

    // 持久化同步
    R.useEffect(() => {
      const proj = {
        version: '2.5.1',
        nodes,
        edges,
        viewport,
        updatedAt: Date.now()
      };
      if (typeof window !== 'undefined') {
        window.__WINETOKEN_CANVAS_MEMORY_STORE__ = proj;
        try {
          localStorage.setItem('__winetoken_canvas_snapshot__', JSON.stringify(proj));
        } catch (_) {}
      }
      if (projectStore) {
        try {
          const activeId = projectStore.getActiveId?.();
          if (activeId) {
            projectStore.saveProject?.(activeId, proj);
          }
        } catch (_) {}
      }
    }, [nodes, edges, viewport]);

    // 节点数据更新动作
    const updateNodeData = R.useCallback((nodeId, partialData) => {
      setNodes((prev) => prev.map((n) => {
        if (n.id !== nodeId) return n;
        return {
          ...n,
          data: {
            ...n.data,
            ...partialData
          }
        };
      }));
    }, []);

    // 节点删除动作
    const deleteNode = R.useCallback((nodeId) => {
      setNodes((prev) => prev.filter((n) => n.id !== nodeId));
      setEdges((prev) => prev.filter((e) => e.source !== nodeId && e.target !== nodeId));
    }, []);

    // 全能参考解析映射：计算每个节点的上游汇聚上下文
    const genContextMap = R.useMemo(() => {
      const map = {};
      if (nodeUtils && typeof nodeUtils.buildGenerationContext === 'function') {
        const proj = { version: '2.5.1', nodes, edges };
        nodes.forEach((n) => {
          try {
            map[n.id] = nodeUtils.buildGenerationContext(proj, n.id);
          } catch (_) {}
        });
      }
      return map;
    }, [nodes, edges]);

    // 取消视频轮询
    const cancelVideoNode = R.useCallback((nodeId) => {
      const ctrl = videoPollAbortRef.current.get(nodeId);
      if (ctrl) {
        try { ctrl.abort(); } catch (_) {}
        videoPollAbortRef.current.delete(nodeId);
      }
      setNodes((prev) => prev.map((n) => {
        if (n.id !== nodeId) return n;
        const prevVs = (n.data && n.data.videoState) || {};
        return { ...n, data: { ...n.data, videoState: { ...prevVs, status: 'cancelled', error: '已由用户取消' } } };
      }));
    }, []);

    // 共享图片/分镜真实生图执行器 (同构于视频执行链路: 参考图校验 -> 5张上限裁剪 -> 轻量化压缩 -> sendImageRequest -> 本地落盘 -> 计费刷新)
    const runImageGeneration = R.useCallback(async (nodeId, node, ctx, isPanel) => {
      const curState = (node.data && node.data.imageState) || {};
      const isBusy = isPanel
        ? Boolean(node.data?.isGenerating || curState.status === 'generating')
        : Boolean(node.data?.generating || curState.status === 'generating');
      if (isBusy) return;

      const pushImageUpdate = (dataPatch, statePatch) => {
        setNodes((prev) => prev.map((n) => {
          if (n.id !== nodeId) return n;
          const prevData = n.data || {};
          const prevState = prevData.imageState || {};
          const nextState = statePatch ? { ...prevState, ...statePatch } : prevState;
          return {
            ...n,
            data: {
              ...prevData,
              ...dataPatch,
              imageState: nextState
            }
          };
        }));
      };

      const pushImageFailure = (errMsg) => {
        pushImageUpdate(
          isPanel
            ? { isGenerating: false, status: 'failed', error: errMsg }
            : { generating: false, error: errMsg },
          { status: 'failed', error: errMsg }
        );
      };

      const apiKey = typeof deps.getKey === 'function' ? deps.getKey() : '';
      if (!apiKey) {
        pushImageFailure('未检测到 API Key，请先配置密钥');
        return;
      }

      const sendImgReq = deps.sendImageRequest;
      if (typeof sendImgReq !== 'function') {
        pushImageFailure('生图请求模块未注入');
        return;
      }

      const chosenModel = (node.data?.params?.model)
        || node.data?.model
        || ctx.params?.model
        || defaultImageModel
        || 'sensenova-u1.5-lite';
      const modelObj = liveImageModels.find((m) => m && m.id === chosenModel) || { id: chosenModel };
      const imageCaps = getImageModelCapabilities(modelObj, chosenModel);

      const rawRefs = Array.isArray(ctx.referenceImages)
        ? ctx.referenceImages.filter((r) => typeof r === 'string' && r.trim())
        : [];
      const clippedRawRefs = rawRefs.slice(0, MAX_IMAGE_REF_IMAGES);
      const resolvedRefs = clippedRawRefs
        .map((r) => resolveAssetUrl(r, assetsDriver))
        .filter((r) => typeof r === 'string' && r.trim() && !r.startsWith('asset:'));
      if (clippedRawRefs.length > 0 && resolvedRefs.length === 0) {
        pushImageFailure('参考图本地资产读取失败，请重新上传或检查资产文件');
        return;
      }

      const refCheck = resolveImageModelValidation(
        deps.validateImageModelSupport,
        chosenModel,
        resolvedRefs.length > 0
      );
      if (!refCheck.supported) {
        pushImageFailure(refCheck.error || '当前模型不支持垫图改图，请切换 sensenova 或 gpt-image 模型，或清空参考图');
        return;
      }

      pushImageUpdate(
        isPanel
          ? { isGenerating: true, status: 'generating', error: '' }
          : { generating: true, error: '' },
        { status: 'generating', error: '', model: chosenModel, startedAt: Date.now() }
      );

      let walJob = null;
      try {
        const effectiveRefs = [];
        for (const refUrl of resolvedRefs) {
          effectiveRefs.push(await downscaleReferenceImage(videoUtils, refUrl));
        }
        const refSlots = effectiveRefs.map((url, idx) => ({
          index: idx + 1,
          name: `图${idx + 1}`,
          dataUrl: url
        }));

        let promptText = (ctx.prompt || node.data?.prompt || (isPanel ? '分镜画面，电影质感' : '电影质感画面，精致细节')).trim();
        if (isPanel && node.data?.characterId) {
          const charNode = nodes.find((n) => n.id === node.data.characterId && (n.type === 'characterNode' || n.type === 'character'));
          const dna = (charNode && charNode.data && typeof charNode.data.dna === 'string') ? charNode.data.dna.trim() : '';
          if (dna && !promptText.includes(dna)) {
            promptText = `${dna}，${promptText}`;
          }
        }
        if (videoUtils && typeof videoUtils.compileVideoPrompt === 'function') {
          promptText = videoUtils.compileVideoPrompt(promptText, refSlots) || promptText;
        }
        promptText = promptText.trim().slice(0, 4000);

        const requestedRatio = isPanel
          ? (node.data?.aspectRatio || node.data?.params?.aspectRatio || ctx.params?.aspectRatio || '2:3')
          : (node.data?.params?.aspectRatio || ctx.params?.aspectRatio || '16:9');
        const ratio = imageCaps.aspectRatios.includes(requestedRatio) ? requestedRatio : imageCaps.aspectRatios[0];
        const requestedQuality = node.data?.params?.quality || ctx.params?.quality || '1K';
        const quality = imageCaps.qualityOptions.includes(requestedQuality) ? requestedQuality : imageCaps.qualityOptions[0];
        let size = node.data?.params?.size || ctx.params?.size;
        if (!size || !/^\d{2,5}x\d{2,5}$/.test(size) || !imageCaps.aspectRatios.includes(inferImageRatio(size))) {
          size = IMAGE_RATIO_SIZE_MAP[ratio] || (isPanel ? '1024x1536' : '1792x1024');
        }
        const count = Math.max(1, Math.min(4, Number(node.data?.params?.count || ctx.params?.count) || 1));

        if (jobQueue && typeof jobQueue.createJob === 'function') {
          try {
            walJob = jobQueue.createJob({
              panelId: nodeId,
              prompt: promptText,
              model: chosenModel,
              size,
              characterId: node.data?.characterId || null
            });
          } catch (_) {}
        }

        const fetchFn = deps.fetchFn || (typeof fetch !== 'undefined' ? fetch : null);
        const baseUrl = deps.BASE_URL || 'https://www.winetoken.asia';
        const singleNOnly = modelObj.singleNOnly !== false;
        const responses = [];
        if (count > 1 && singleNOnly) {
          for (let i = 0; i < count; i += 2) {
            const batchSize = Math.min(2, count - i);
            const batchTasks = Array.from({ length: batchSize }, () => sendImgReq({
              baseUrl,
              apiKey,
              model: chosenModel,
              prompt: promptText,
              size,
              quality,
              n: 1,
              referenceSlots: refSlots,
              fetchFn
            }));
            const batchRes = await Promise.all(batchTasks);
            responses.push(...batchRes);
          }
        } else {
          const singleResp = await sendImgReq({
            baseUrl,
            apiKey,
            model: chosenModel,
            prompt: promptText,
            size,
            quality,
            n: count,
            referenceSlots: refSlots,
            fetchFn
          });
          responses.push(singleResp);
        }

        const rawUrls = [];
        for (const resp of responses) {
          if (resp && Array.isArray(resp.data)) {
            for (const item of resp.data) {
              if (!item) continue;
              const u = item.url || (item.b64_json ? `data:image/png;base64,${item.b64_json}` : '');
              if (typeof u === 'string' && u.trim()) rawUrls.push(u.trim());
            }
          } else if (resp && typeof resp.url === 'string' && resp.url.trim()) {
            rawUrls.push(resp.url.trim());
          } else if (resp && typeof resp.b64_json === 'string' && resp.b64_json.trim()) {
            rawUrls.push(`data:image/png;base64,${resp.b64_json.trim()}`);
          }
        }
        if (rawUrls.length === 0) {
          throw new Error('接口未返回有效图像');
        }

        let assetWarning = '';
        const savedEntries = rawUrls.map((u) => {
          if (u.startsWith('data:') && assetsDriver && typeof assetsDriver.saveDataUrl === 'function') {
            try {
              const saved = assetsDriver.saveDataUrl(u);
              return { url: `asset:${saved.assetKey}`, assetKey: saved.assetKey };
            } catch (assetErr) {
              assetWarning = `图片已生成但本地落盘失败: ${assetErr.message}`;
            }
          }
          return { url: u, assetKey: '' };
        });

        const finalUrl = savedEntries[0].url;
        const assetKey = savedEntries[0].assetKey;
        const savedUrls = savedEntries.map((e) => e.url);

        if (walJob && jobQueue && typeof jobQueue.completeJob === 'function') {
          try { jobQueue.completeJob(walJob.id, finalUrl); } catch (_) {}
        }

        if (isPanel) {
          setNodes((prev) => prev.map((n) => {
            if (n.id !== nodeId) return n;
            const prevData = n.data || {};
            const prevCandidates = Array.isArray(prevData.candidates) ? prevData.candidates : [];
            const mergedCandidates = [...savedUrls, ...prevCandidates.filter((c) => !savedUrls.includes(c))].slice(0, 4);
            return {
              ...n,
              data: {
                ...prevData,
                isGenerating: false,
                status: 'succeeded',
                imageUrl: finalUrl,
                url: finalUrl,
                assetKey,
                candidates: mergedCandidates,
                error: assetWarning,
                imageState: {
                  ...(prevData.imageState || {}),
                  status: 'succeeded',
                  url: finalUrl,
                  assetKey,
                  error: assetWarning,
                  model: chosenModel,
                  completedAt: Date.now()
                }
              }
            };
          }));
        } else {
          pushImageUpdate(
            {
              generating: false,
              url: finalUrl,
              assetKey,
              candidates: savedUrls,
              error: assetWarning
            },
            {
              status: 'succeeded',
              url: finalUrl,
              assetKey,
              error: assetWarning,
              model: chosenModel,
              completedAt: Date.now()
            }
          );
        }

        if (typeof deps.updateBilling === 'function') {
          try { deps.updateBilling(); } catch (_) {}
        }
      } catch (err) {
        const errMsg = (err && err.message) ? err.message : '图片生成失败';
        if (walJob && jobQueue && typeof jobQueue.failJob === 'function') {
          try { jobQueue.failJob(walJob.id, errMsg); } catch (_) {}
        }
        pushImageFailure(errMsg);
      }
    }, [nodes, assetsDriver, videoUtils, liveImageModels, defaultImageModel, jobQueue]);

    // 生成节点触发动作 (分镜/图片/视频)
    const generateNode = R.useCallback(async (nodeId) => {
      const node = nodes.find(n => n.id === nodeId);
      if (!node) return;
      const ctx = genContextMap[nodeId] || { prompt: '', referenceImages: [], params: {} };

      if (node.type === 'panelNode' || node.type === 'panel') {
        await runImageGeneration(nodeId, node, ctx, true);
      } else if (node.type === 'imageNode' || node.type === 'image') {
        await runImageGeneration(nodeId, node, ctx, false);
      } else if (node.type === 'videoNode' || node.type === 'video') {
        const curState = (node.data && node.data.videoState) || {};
        if (videoUtils && typeof videoUtils.isBusy === 'function' && videoUtils.isBusy(curState)) return;
        if (!videoUtils || typeof videoUtils.executeVideoNodeTask !== 'function') {
          if (typeof console !== 'undefined' && typeof console.error === 'function') {
            console.error('[WineToken Canvas] 视频组件不可用 (canvas-video.js):', canvasVideoLoadError || 'module missing or incomplete');
          }
          updateNodeData(nodeId, {
            videoState: { ...curState, status: 'failed', error: VIDEO_MODULE_LOAD_ERROR_MSG }
          });
          return;
        }
        const apiKey = typeof deps.getKey === 'function' ? deps.getKey() : '';
        if (!apiKey) {
          updateNodeData(nodeId, {
            videoState: { ...curState, status: 'failed', error: '未检测到 API Key，请先配置密钥' }
          });
          return;
        }

        const rawRefs = Array.isArray(ctx.referenceImages)
          ? ctx.referenceImages.filter((r) => typeof r === 'string' && r.trim())
          : [];
        const resolvedRefs = rawRefs.map((r) => resolveAssetUrl(r, assetsDriver)).filter(Boolean);
        const chosenModel = (node.data?.params?.model) || ctx.params?.model || (liveVideoModels[0] && liveVideoModels[0].id) || 'MiniMax-H3';
        const duration = Number(node.data?.params?.duration || ctx.params?.duration) || 5;
        const aspectRatio = node.data?.params?.aspectRatio || ctx.params?.aspectRatio || '16:9';
        const resVal = node.data?.params?.resolution || ctx.params?.resolution || (/minimax-h3-2k/i.test(chosenModel) ? '2K' : '720P');
        let size = node.data?.params?.size || ctx.params?.size;
        if (!size || !/^\d{2,5}x\d{2,5}$/.test(size)) {
          const isVert = aspectRatio === '9:16';
          if (resVal === '2K') size = isVert ? '1440x2560' : '2560x1440';
          else if (resVal === '1080P') size = isVert ? '1080x1920' : '1920x1080';
          else size = isVert ? '720x1280' : '1280x720';
        }
        const promptText = (ctx.prompt || node.data?.prompt || '电影感运镜，光线流动').trim().slice(0, 4000);
        const generateAudio = Boolean(node.data?.params?.generateAudio || ctx.params?.generateAudio);
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        if (controller) videoPollAbortRef.current.set(nodeId, controller);

        const pushVideoState = (patch) => {
          setNodes((prev) => prev.map((n) => {
            if (n.id !== nodeId) return n;
            const base = videoUtils.createVideoNodeState ? videoUtils.createVideoNodeState() : { status: 'idle' };
            const prevVs = (n.data && n.data.videoState) || {};
            const nextVs = { ...base, ...prevVs, ...patch };
            return {
              ...n,
              data: {
                ...(n.data || {}),
                url: nextVs.videoUrl || n.data?.url || '',
                assetKey: nextVs.assetKey || n.data?.assetKey || '',
                videoState: nextVs
              }
            };
          }));
        };

        try {
          const result = await videoUtils.executeVideoNodeTask({
            baseUrl: deps.BASE_URL || 'https://www.winetoken.asia',
            apiKey,
            model: chosenModel,
            prompt: promptText,
            duration,
            size,
            ratio: aspectRatio,
            generateAudio,
            referenceUrls: resolvedRefs,
            assetsDriver,
            fetchFn: deps.fetchFn || (typeof fetch !== 'undefined' ? fetch : null),
            signal: controller ? controller.signal : null,
            onStateChange: pushVideoState
          });
          if (result && result.assetWarning) {
            pushVideoState({ error: result.assetWarning });
          }
          if (typeof deps.updateBilling === 'function') {
            try { deps.updateBilling(); } catch (_) {}
          }
        } catch (err) {
          const cancelled = Boolean(controller && controller.signal && controller.signal.aborted);
          pushVideoState({
            status: cancelled ? 'cancelled' : 'failed',
            error: err && err.message ? err.message : '视频生成失败'
          });
        } finally {
          videoPollAbortRef.current.delete(nodeId);
        }
      }
    }, [nodes, genContextMap, updateNodeData, runImageGeneration, liveVideoModels, assetsDriver, videoUtils]);

    // 新建节点方法
    const addNodeAtPosition = R.useCallback((type, flowX, flowY) => {
      const id = `${type}_${Date.now()}`;
      let newNode = null;

      if (type === 'panel') {
        newNode = {
          id,
          type: 'panelNode',
          position: { x: flowX, y: flowY },
          width: 280,
          height: 420,
          data: {
            num: nodes.filter(n => n.type === 'panelNode' || n.type === 'panel').length + 1,
            prompt: '新分镜画面，电影质感光影',
            dialogue: '',
            shot: 'CU',
            shotLabel: '特写',
            aspectRatio: '2:3',
            imageUrl: '',
            candidates: [],
            status: 'idle',
            isGenerating: false,
            error: '',
            imageState: { status: 'idle' },
            params: { model: defaultImageModel },
            tags: []
          }
        };
      } else if (type === 'character') {
        newNode = {
          id,
          type: 'characterNode',
          position: { x: flowX, y: flowY },
          data: { name: '新角色', dna: '角色特征外貌描写...', avatar: '', tags: [] }
        };
      } else if (type === 'image') {
        newNode = {
          id,
          type: 'imageNode',
          position: { x: flowX, y: flowY },
          width: 290,
          height: 440,
          data: {
            name: '图片生成节点',
            prompt: '电影质感画面，精致细节',
            url: '',
            generating: false,
            error: '',
            imageState: { status: 'idle' },
            params: { model: defaultImageModel, aspectRatio: '16:9', quality: '1K', count: 1 }
          }
        };
      } else if (type === 'video') {
        newNode = {
          id,
          type: 'videoNode',
          position: { x: flowX, y: flowY },
          width: 330,
          height: 460,
          data: {
            name: '视频生成节点',
            prompt: '电影感镜头推进',
            url: '',
            videoState: { status: 'idle' },
            params: { model: (liveVideoModels[0] && liveVideoModels[0].id) || 'MiniMax-H3', duration: 5, resolution: '720P', aspectRatio: '16:9', generateAudio: false }
          }
        };
      } else if (type === 'text') {
        newNode = {
          id,
          type: 'textNode',
          position: { x: flowX, y: flowY },
          width: 240,
          height: 150,
          data: { name: '文本便签', text: '' }
        };
      }

      if (newNode) {
        setNodes((prev) => [...prev, newNode]);
      }
      setAddMenu(null);
    }, [nodes, liveVideoModels, defaultImageModel]);

    // 画布双击：注意不与双击节点/边编辑冲突
    const handleDoubleClick = R.useCallback((e) => {
      // 冲突阻断：双击发生在节点、连线、手柄或浮动面板内部时不弹出空白菜单
      if (
        e.target.closest('.react-flow__node') ||
        e.target.closest('.react-flow__edge') ||
        e.target.closest('.react-flow__handle') ||
        e.target.closest('.react-flow__panel')
      ) {
        return;
      }
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;
      const currentZoom = (viewport && viewport.zoom) || 1;
      const currentVx = (viewport && viewport.x) || 0;
      const currentVy = (viewport && viewport.y) || 0;
      const flowX = Math.round((screenX - currentVx) / currentZoom);
      const flowY = Math.round((screenY - currentVy) / currentZoom);

      setAddMenu({ screenX, screenY, flowX, flowY });
    }, [viewport]);

    // 单击空白处关闭添加菜单
    const handlePaneClick = R.useCallback(() => {
      if (addMenu) setAddMenu(null);
    }, [addMenu]);

    // Context 值注入
    const contextValue = R.useMemo(() => ({
      theme,
      isVip,
      isSvip,
      isSuper,
      canvasAssetsDriver: assetsDriver,
      canvasModel: defaultImageModel,
      CanvasPricingUtils: pricingUtils,
      CanvasVideoUtils: videoUtils,
      availableImageModels: liveImageModels,
      availableVideoModels: liveVideoModels,
      validateImageModelSupport: deps.validateImageModelSupport || null,
      Handle: xyFlow?.Handle,
      Position: xyFlow?.Position,
      updateNodeData,
      deleteNode,
      generateNode,
      cancelVideoNode,
      genContextMap
    }), [theme, isVip, isSvip, isSuper, assetsDriver, defaultImageModel, pricingUtils, videoUtils, liveImageModels, liveVideoModels, updateNodeData, deleteNode, generateNode, cancelVideoNode, genContextMap]);

    // 若 React Flow 未加载成功，降级保护提示
    if (!xyFlow || !xyFlow.ReactFlow) {
      return h('div', {
        style: {
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: isDark ? '#0d0d0f' : '#f9fafb',
          color: isDark ? '#ffffff' : '#000000',
          fontSize: 14
        }
      }, 'React Flow 渲染引擎加载中...');
    }

    const ReactFlow = xyFlow.ReactFlow;
    const MiniMap = xyFlow.MiniMap;
    const Controls = xyFlow.Controls;
    const Background = xyFlow.Background;
    const Panel = xyFlow.Panel;

    // MiniMap 节点着色
    const getMinimapNodeColor = (node) => {
      const t = node.type;
      if (t === 'characterNode' || t === 'character') return '#9ca3af';
      if (t === 'panelNode' || t === 'panel') return '#6b7280';
      if (t === 'imageNode' || t === 'image') return '#4b5563';
      if (t === 'videoNode' || t === 'video') return '#374151';
      if (t === 'textNode' || t === 'text') return '#d1d5db';
      return '#e5e7eb';
    };

    return h(NodeActionContext.Provider, { value: contextValue }, [
      h('div', {
        key: 'flow-container',
        ref: containerRef,
        onDoubleClick: handleDoubleClick,
        style: {
          position: 'relative',
          width: '100%',
          height: '100%',
          flex: 1,
          background: isDark ? '#0d0d0f' : '#f9fafb',
          overflow: 'hidden'
        }
      }, [
        h(ReactFlow, {
          key: 'rf',
          nodes,
          edges,
          nodeTypes: NODE_TYPES_MAPPING,
          onNodesChange,
          onEdgesChange,
          onConnect,
          onPaneClick: handlePaneClick,
          onMoveEnd,
          defaultEdgeOptions: { type: 'default' },
          proOptions: { hideAttribution: true },
          defaultViewport: viewport,
          minZoom: 0.1,
          maxZoom: 2.5,
          snapToGrid: true,
          snapGrid: [8, 8],
          deleteKeyCode: ['Backspace', 'Delete'],
          style: { width: '100%', height: '100%' }
        }, [
          // 原生背景网格点
          h(Background, {
            key: 'bg',
            variant: 'dots',
            gap: 16,
            size: 1,
            color: isDark ? '#27272a' : '#e5e7eb'
          }),

          // 控件
          h(Controls, {
            key: 'ctrl',
            position: 'top-right',
            style: {
              background: isDark ? '#18181c' : '#ffffff',
              border: isDark ? '1px solid rgba(255,255,255,0.1)' : '1px solid rgba(0,0,0,0.1)',
              borderRadius: 8
            }
          }),

          // 原生 MiniMap
          h(MiniMap, {
            key: 'minimap',
            position: 'bottom-right',
            nodeColor: getMinimapNodeColor,
            maskColor: isDark ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.6)',
            style: {
              background: isDark ? '#18181c' : '#ffffff',
              border: isDark ? '1px solid rgba(255,255,255,0.1)' : '1px solid rgba(0,0,0,0.1)',
              borderRadius: 8,
              width: 160,
              height: 100
            }
          }),

          // 底部工具栏改挂 React Flow Panel
          h(Panel, {
            key: 'bottom-toolbar-panel',
            position: 'bottom-center',
            style: { marginBottom: 16 }
          }, h('div', {
            key: 'toolbar-inner',
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 14px',
              borderRadius: 24,
              background: isDark ? 'rgba(24, 24, 27, 0.94)' : 'rgba(255, 255, 255, 0.94)',
              border: isDark ? '1px solid rgba(255, 255, 255, 0.12)' : '1px solid rgba(0, 0, 0, 0.12)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
              backdropFilter: 'blur(12px)'
            }
          }, [
            h('button', {
              key: 'add-shot',
              onClick: () => addNodeAtPosition('panel', 360, 60),
              style: {
                padding: '5px 10px',
                borderRadius: 16,
                border: 'none',
                background: '#3b82f6',
                color: '#ffffff',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer'
              }
            }, '+ 分镜'),
            h('button', {
              key: 'add-img',
              onClick: () => addNodeAtPosition('image', 700, 60),
              style: {
                padding: '5px 10px',
                borderRadius: 16,
                border: isDark ? '1px solid rgba(255,255,255,0.12)' : '1px solid rgba(0,0,0,0.12)',
                background: isDark ? '#27272a' : '#f4f4f5',
                color: isDark ? '#ffffff' : '#000000',
                fontSize: 12,
                cursor: 'pointer'
              }
            }, '+ 图片'),
            h('button', {
              key: 'add-vid',
              onClick: () => addNodeAtPosition('video', 700, 360),
              style: {
                padding: '5px 10px',
                borderRadius: 16,
                border: isDark ? '1px solid rgba(255,255,255,0.12)' : '1px solid rgba(0,0,0,0.12)',
                background: isDark ? '#27272a' : '#f4f4f5',
                color: isDark ? '#ffffff' : '#000000',
                fontSize: 12,
                cursor: 'pointer'
              }
            }, '+ 视频'),
            h('button', {
              key: 'add-txt',
              onClick: () => addNodeAtPosition('text', 700, 600),
              style: {
                padding: '5px 10px',
                borderRadius: 16,
                border: isDark ? '1px solid rgba(255,255,255,0.12)' : '1px solid rgba(0,0,0,0.12)',
                background: isDark ? '#27272a' : '#f4f4f5',
                color: isDark ? '#ffffff' : '#000000',
                fontSize: 12,
                cursor: 'pointer'
              }
            }, '+ 文本'),
            h('button', {
              key: 'add-char',
              onClick: () => addNodeAtPosition('character', 40, 60),
              style: {
                padding: '5px 10px',
                borderRadius: 16,
                border: isDark ? '1px solid rgba(255,255,255,0.12)' : '1px solid rgba(0,0,0,0.12)',
                background: isDark ? '#27272a' : '#f4f4f5',
                color: isDark ? '#ffffff' : '#000000',
                fontSize: 12,
                cursor: 'pointer'
              }
            }, '+ 角色')
          ]))
        ]),

        // 双击空白处添加节点浮层菜单
        addMenu && h('div', {
          key: 'dblclick-menu',
          style: {
            position: 'absolute',
            left: addMenu.screenX,
            top: addMenu.screenY,
            background: isDark ? '#18181c' : '#ffffff',
            border: isDark ? '1px solid rgba(255,255,255,0.12)' : '1px solid rgba(0,0,0,0.12)',
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
            padding: 4,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            zIndex: 100,
            minWidth: 110,
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
          }
        }, [
          [
            { type: 'image', label: '图片节点' },
            { type: 'video', label: '视频节点' },
            { type: 'text', label: '文本便签' },
            { type: 'panel', label: '分镜卡片' },
            { type: 'character', label: '角色卡片' }
          ].map(opt => h('button', {
            key: opt.type,
            onClick: () => addNodeAtPosition(opt.type, addMenu.flowX, addMenu.flowY),
            style: {
              background: 'transparent',
              border: 'none',
              borderRadius: 4,
              padding: '6px 10px',
              textAlign: 'left',
              fontSize: 12,
              color: isDark ? '#e4e4e7' : '#18181b',
              cursor: 'pointer',
              outline: 'none'
            },
            onMouseEnter: (e) => { e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)'; },
            onMouseLeave: (e) => { e.currentTarget.style.background = 'transparent'; }
          }, opt.label))
        ])
      ])
    ]);
  }

  return ReactFlowWorkspaceComponent;
}

// 统一对外导出
module.exports = {
  createReactFlowWorkspace,
  NodeActionContext,
  CharacterNode,
  PanelNode,
  ImageNode,
  VideoNode,
  getImageModelCapabilities,
  resolveVideoNodeOptions,
  TextNode,
  GroupNode,
  NODE_TYPES_MAPPING
};
module.exports.default = createReactFlowWorkspace;
