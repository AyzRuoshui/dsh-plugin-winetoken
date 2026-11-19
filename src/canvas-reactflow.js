// -*- coding: utf-8 -*-
/**
 * WineToken 漫剧 AI 画布 React Flow 工作台组件 (v2.5.0)
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
try { CanvasVideoUtils = require('./canvas-video.js'); } catch (_) {}
let CanvasExportUtils = null;
try { CanvasExportUtils = require('./canvas-export.js'); } catch (_) {}
let initXyFlowFactory = null;
try { initXyFlowFactory = require('./vendor/xyflow.factory.cjs'); } catch (_) {}

// 全局节点操作调度 Context
const NodeActionContext = React.createContext(null);

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
  const aspectRatio = data.aspectRatio || '2:3';
  const prompt = typeof data.prompt === 'string' ? data.prompt : '';
  const dialogue = typeof data.dialogue === 'string' ? data.dialogue : '';
  const imageUrl = resolveAssetUrl(data.imageUrl, actions.canvasAssetsDriver);
  const candidates = Array.isArray(data.candidates) ? data.candidates : [];
  const isGenerating = Boolean(data.isGenerating);
  const Handle = actions.Handle;
  const Position = actions.Position || { Left: 'left', Right: 'right' };

  // 价格徽章计算
  let priceText = '限免';
  if (actions.CanvasPricingUtils && typeof actions.CanvasPricingUtils.formatPriceBadge === 'function') {
    try {
      priceText = actions.CanvasPricingUtils.formatPriceBadge({
        type: 'image',
        model: actions.canvasModel || 'sensenova-u1.5-lite',
        isVip: actions.isVip,
        isSvip: actions.isSvip
      });
    } catch (_) {}
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
        background: isDark ? '#141417' : '#f9fafb'
      }
    }, [
      h('div', { key: 'meta', style: { display: 'flex', alignItems: 'center', gap: 6 } }, [
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
        h('span', {
          key: 'price-badge',
          style: {
            fontSize: 10,
            padding: '2px 5px',
            borderRadius: 4,
            background: isDark ? 'rgba(16,185,129,0.15)' : 'rgba(16,185,129,0.1)',
            color: '#10b981',
            fontWeight: 600
          }
        }, priceText)
      ]),
      h('div', { key: 'opts', style: { display: 'flex', alignItems: 'center', gap: 6 } }, [
        h('select', {
          key: 'aspect-sel',
          value: aspectRatio,
          onChange: (e) => actions.updateNodeData?.(id, { aspectRatio: e.target.value }),
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
          style: { color: isDark ? '#52525b' : '#9ca3af', fontSize: 11, textAlign: 'center' }
        }, '待生成画面')
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
        onClick: () => actions.updateNodeData?.(id, { imageUrl: c }),
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

    // 提示词与台词输入
    h('div', {
      key: 'inputs',
      style: { padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }
    }, [
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
  const url = resolveAssetUrl(data.url, actions.canvasAssetsDriver);
  const generating = Boolean(data.generating);
  const params = data.params || {};
  const aspectRatio = params.aspectRatio || '16:9';
  const quality = params.quality || '1K';
  const count = Number(params.count) || 1;
  const Handle = actions.Handle;
  const Position = actions.Position || { Left: 'left', Right: 'right' };

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
        }, '图片'),
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
          style: { color: isDark ? '#52525b' : '#9ca3af', fontSize: 11, textAlign: 'center' }
        }, '待生图或上传参考')
      )
    ]),

    // 提示词输入
    h('div', {
      key: 'body',
      style: { padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }
    }, [
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
          }, ['1:1', '16:9', '9:16', '4:3', '3:4'].map(r => h('option', { key: r, value: r }, r)))
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
          }, ['1K', '2K', '4K'].map(q => h('option', { key: q, value: q }, q)))
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
  const videoUrl = resolveAssetUrl(videoState.videoUrl || data.url, actions.canvasAssetsDriver);
  const isBusy = (actions.CanvasVideoUtils && typeof actions.CanvasVideoUtils.isBusy === 'function')
    ? actions.CanvasVideoUtils.isBusy(videoState)
    : (videoState.status === 'submitting' || videoState.status === 'polling');
  const params = data.params || {};
  const duration = Number(params.duration) || 5;
  const resolution = params.resolution || '720P';
  const aspectRatio = params.aspectRatio || '16:9';
  const generateAudio = Boolean(params.generateAudio);
  const Handle = actions.Handle;
  const Position = actions.Position || { Left: 'left', Right: 'right' };

  // 全能参考解析状态指示
  let referenceBadge = '文生视频';
  if (actions.genContextMap && actions.genContextMap[id]) {
    const ctx = actions.genContextMap[id];
    if (ctx.mode === 'multi_reference') {
      referenceBadge = `全能参考 (${ctx.multiReferenceCount}图)`;
    } else if (ctx.mode === 'single_reference') {
      referenceBadge = '单图首帧';
    }
  }

  return h('div', {
    style: {
      width: 330,
      minHeight: 460,
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
        }, '视频'),
        h('span', { key: 'title', style: { fontWeight: 600 } }, name),
        h('span', {
          key: 'ref',
          style: {
            fontSize: 10,
            padding: '2px 5px',
            borderRadius: 4,
            background: isDark ? 'rgba(168,85,247,0.15)' : 'rgba(168,85,247,0.1)',
            color: '#a855f7',
            fontWeight: 600
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
          lineHeight: 1
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
          style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, color: '#3b82f6', fontSize: 11 }
        }, [
          h('div', { key: 'spinner', style: { width: 18, height: 18, border: '2px solid #3b82f6', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' } }),
          h('span', { key: 'status-txt' }, videoState.status === 'polling' ? `正在渲染视频 (${videoState.progress || 0}%)` : '提交生成任务...')
        ]) : h('div', {
          key: 'idle-placeholder',
          style: { color: isDark ? '#52525b' : '#9ca3af', fontSize: 11, textAlign: 'center' }
        }, '待生成视频 (接入上游图片可升级全能参考)')
      )
    ]),

    // 提示词与全量参数控制
    h('div', {
      key: 'body',
      style: { padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }
    }, [
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

      // 现行全量视频参数：时长 4/5/6/10/15 秒、720P/1080P、比例、音频开关
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
          }, [4, 5, 6, 10, 15].map(d => h('option', { key: d, value: d }, `${d}秒`)))
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
          }, ['720P', '1080P'].map(r => h('option', { key: r, value: r }, r)))
        ),

        // 比例
        h('div', { key: 'aspectRatio', style: { display: 'flex', flexDirection: 'column', gap: 2 } },
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
          }, ['16:9', '9:16', '1:1', '4:3', '3:4'].map(a => h('option', { key: a, value: a }, a)))
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
  const videoUtils = deps.CanvasVideoUtils || CanvasVideoUtils;
  const exportUtils = deps.CanvasExportUtils || CanvasExportUtils;

  // 水合 React Flow 实例
  let xyFlow = null;
  if (typeof initXyFlow === 'function') {
    try {
      xyFlow = initXyFlow(R, deps.ReactDOM);
    } catch (_) {}
  }

  // 默认初始模板
  const defaultInitialProject = {
    version: '2.5.0',
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

  function ReactFlowWorkspaceComponent({ theme, isVip, isSvip, isSuper, onOpenTutorial }) {
    const isDark = theme ? Boolean(theme.isDark) : true;
    const containerRef = R.useRef(null);

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
        version: '2.5.0',
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
        const proj = { version: '2.5.0', nodes, edges };
        nodes.forEach((n) => {
          try {
            map[n.id] = nodeUtils.buildGenerationContext(proj, n.id);
          } catch (_) {}
        });
      }
      return map;
    }, [nodes, edges]);

    // 生成节点触发动作 (分镜/图片/视频)
    const generateNode = R.useCallback(async (nodeId) => {
      const node = nodes.find(n => n.id === nodeId);
      if (!node) return;
      const ctx = genContextMap[nodeId] || { prompt: '', referenceImages: [], params: {} };

      if (node.type === 'panelNode' || node.type === 'panel') {
        updateNodeData(nodeId, { isGenerating: true });
        // 模拟/派发生图请求
        setTimeout(() => {
          updateNodeData(nodeId, {
            isGenerating: false,
            imageUrl: node.data.imageUrl || 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=600'
          });
        }, 800);
      } else if (node.type === 'imageNode' || node.type === 'image') {
        updateNodeData(nodeId, { generating: true });
        setTimeout(() => {
          updateNodeData(nodeId, {
            generating: false,
            url: node.data.url || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=600'
          });
        }, 800);
      } else if (node.type === 'videoNode' || node.type === 'video') {
        updateNodeData(nodeId, {
          videoState: { status: 'polling', progress: 50, videoUrl: '' }
        });
        setTimeout(() => {
          updateNodeData(nodeId, {
            videoState: { status: 'completed', progress: 100, videoUrl: node.data.url || 'https://sample-videos.com/video123/mp4/720/big_buck_bunny_720p_1mb.mp4' }
          });
        }, 1200);
      }
    }, [nodes, genContextMap, updateNodeData]);

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
            params: { aspectRatio: '16:9', quality: '1K', count: 1 }
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
            params: { duration: 5, resolution: '720P', aspectRatio: '16:9', generateAudio: false }
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
    }, [nodes]);

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
      canvasModel: 'sensenova-u1.5-lite',
      CanvasPricingUtils: pricingUtils,
      CanvasVideoUtils: videoUtils,
      Handle: xyFlow?.Handle,
      Position: xyFlow?.Position,
      updateNodeData,
      deleteNode,
      generateNode,
      genContextMap
    }), [theme, isVip, isSvip, isSuper, assetsDriver, pricingUtils, videoUtils, updateNodeData, deleteNode, generateNode, genContextMap]);

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
  CharacterNode,
  PanelNode,
  ImageNode,
  VideoNode,
  TextNode,
  GroupNode,
  NODE_TYPES_MAPPING
};
module.exports.default = createReactFlowWorkspace;
