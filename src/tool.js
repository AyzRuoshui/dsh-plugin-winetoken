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

const DEFAULT_BASE_URL = 'https://www.winetoken.asia/v1';

/**
 * 获取系统配置的 API Key
 */
function getApiKey() {
  if (process.env.WINETOKEN_API_KEY && process.env.WINETOKEN_API_KEY.trim()) {
    return process.env.WINETOKEN_API_KEY.trim();
  }
  const credentialsPath = path.join(homedir(), '.dsh', '.credentials.yaml');
  if (fs.existsSync(credentialsPath)) {
    try {
      const content = fs.readFileSync(credentialsPath, 'utf8');
      const m = content.match(/WINETOKEN_API_KEY:\s*([^\r\n#]+)/);
      if (m && m[1]) return m[1].trim();
    } catch (_) {}
  }
  return '';
}

/**
 * 获取 Base URL
 */
function getBaseUrl() {
  const patchPath = path.join(homedir(), '.dsh', 'profiles', 'desktop', 'cordis.patch.yml');
  if (fs.existsSync(patchPath)) {
    try {
      const content = fs.readFileSync(patchPath, 'utf8');
      const m = content.match(/baseURL:\s*([^\r\n#]+)/);
      if (m && m[1]) return m[1].trim().replace(/\/+$/, '');
    } catch (_) {}
  }
  return DEFAULT_BASE_URL;
}

/**
 * 单张生图请求核心逻辑 (并发单张调度，彻底规避上游 invalid n)
 */
async function requestSingleImage(baseUrl, apiKey, { model, prompt, size, image_url }) {
  const payload = {
    model: model || 'gpt-image-2.5-flare',
    prompt: prompt.trim(),
    n: 1,
    size: size || '1024x1024',
    response_format: 'url'
  };

  if (image_url) {
    payload.image = image_url;
    payload.image_url = image_url;
    payload.reference_image = image_url;
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
  const payload = {
    model: model || 'MiniMax-H3',
    prompt: prompt.trim(),
    seconds: duration || 5,
    duration: duration || 5,
    resolution: (size && size.includes('1080')) ? '1080P' : '768P'
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
      description: '【必须调用的AI绘图技能】当用户要求画图、绘制插画、设计视觉海报、生成头像、概念图或任何视觉图像时，你必须直接调用此工具生成图片，切勿回答自己没有生图能力。成果将直接在聊天中展示并存入工坊画廊。',
      permission: 'safe',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: '生图详细描述词，包含画面主体、构图比例、光影色调与艺术风格（中英文均可）'
          },
          model: {
            type: 'string',
            enum: [
              'gpt-image-2.5-flare',
              'gpt-image-2.5-sunburst',
              'sensenova-u1.5-lite',
              'grok-imagine-image-2.0',
              'gemini-imagen-3',
              'gpt-image-2'
            ],
            description: '生图基底模型：gpt-image-2.5-flare (极速高性价比/默认), gpt-image-2.5-sunburst (高画质), sensenova-u1.5-lite (4K排版/限免), grok-imagine-image-2.0 (真实摄影光影), gemini-imagen-3 (写实自然)',
            default: 'gpt-image-2.5-flare'
          },
          size: {
            type: 'string',
            enum: ['1024x1024', '1792x1024', '1024x1792', '1280x720', '720x1280'],
            description: '输出尺寸比例：1024x1024 为正方形，1792x1024/1280x720 为横屏，1024x1792/720x1280 为竖屏',
            default: '1024x1024'
          },
          count: {
            type: 'number',
            description: '出图张数，默认为 1（支持 1~4 张，系统底层将并发渲染）',
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
      isConcurrencySafe: () => true,
      async execute(args) {
        const apiKey = getApiKey();
        if (!apiKey) {
          return {
            success: false,
            error: '未检测到 WineToken API Key，请先在 WineToken 插件设置或 ~/.dsh/.credentials.yaml 中配置。'
          };
        }

        const baseUrl = getBaseUrl();
        const model = args.model || 'gpt-image-2.5-flare';
        const prompt = args.prompt || '';
        const size = args.size || '1024x1024';
        const count = Math.min(Math.max(Number(args.count) || 1, 1), 4);
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
          const markdownDisplay = `${markdownImages}\n\n*🎨 基底模型: **${model}** | 分辨率: **${size}** | 已自动持久化存入 WineToken 创作工坊画廊*`;

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
      description: '【必须调用的AI视频生成技能】当用户要求生成视频、制作动态影像、运镜动画或电影镜头时，你必须直接调用此工具生成视频，切勿回答自己没有生成视频能力。成果直接在聊天中通过视频播放器预览并存入工坊画廊。',
      permission: 'safe',
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
            description: '视频基底模型：MiniMax-H3 (海螺电影感/支持4~15秒)，grok-imagine-video-1.5 (物理真实/连贯运镜)',
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
      isConcurrencySafe: () => true,
      async execute(args) {
        const apiKey = getApiKey();
        if (!apiKey) {
          return {
            success: false,
            error: '未检测到 WineToken API Key，请先在 WineToken 插件设置或 ~/.dsh/.credentials.yaml 中配置。'
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
          const markdownDisplay = `<video src="${videoUrl}" controls width="100%" style="max-height:480px;border-radius:8px;outline:none;background:#000;"></video>\n\n*🎬 基底模型: **${model}** (${duration}秒) | 已自动持久化存入 WineToken 创作工坊画廊*`;

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
          console.error('[WineToken Tool] 视频生成失败:', err.message);
          return {
            success: false,
            error: err.message
          };
        }
      }
    });

    // 3. 向会话注入动态 System Prompt 指令
    if (ctx.systemPrompt && typeof ctx.systemPrompt.section === 'function') {
      try {
        ctx.systemPrompt.section({
          name: 'tool:winetoken_creative',
          order: 850,
          text: () => 'You have full capability to generate images and videos via the WineToken Studio tools (winetoken_generate_image and winetoken_generate_video). When a user asks for drawing, pictures, illustrations, logos, or videos, immediately invoke the corresponding tool. Do NOT refuse or claim that you lack image generation features.'
        });
      } catch (err) {
        console.warn('[WineToken Plugin] 注入 systemPrompt 失败:', err.message);
      }
    }

    console.log('[WineToken Plugin] ✅ 成功向 DeepSeek Harness 注入 AI 绘图与视频生成 2 大原生 Tools/Skill。');
  };

  // 支持直接注入与延迟注入
  if (ctx.tools) {
    registerHandler(ctx.tools);
  } else if (typeof ctx.inject === 'function') {
    ctx.inject(['tools'], (injectedCtx) => {
      registerHandler(injectedCtx.tools);
    });
  }
}

module.exports = {
  registerWineTokenTools
};
