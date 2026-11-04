// -*- coding: utf-8 -*-
/**
 * WineToken 模型元数据智能解析引擎
 * 自动计算上下文 (contextWindow)、最大输出 (maxTokens)、多模态 (input)、推理思考链 (reasoningEfforts)
 */

// 纯生图/生视频/语音非对话模型黑名单（在桌面端对话框中过滤掉）
const NON_CHAT_PATTERNS = [
  /imagine-image/i,
  /imagine-video/i,
  /gpt-image/i,
  /gemini-imagen/i,
  /imagen-3/i,
  /gemini-veo/i,
  /-tts$/i,
  /sensenova-u1.5-lite/i,
  /minimax-h3/i,       // MiniMax H3 视频生成模型
  /-h3$/i,             // 视频模型变体
  /video/i             // 任何显式包含 video 的视频模型
];

// 已知模型的精确规格库（100% 对齐 WineToken 线上生产数据库 models 与 channels 表）
const EXACT_MODEL_SPECS = {
  // DeepSeek 深度思考与多模态推理
  'deepseek-v4.1-flash': {
    name: 'DeepSeek V4.1 Flash (多模态推理)',
    contextWindow: 1048576, // 1M 上下文
    maxTokens: 393216,      // 384K 最大输出
    input: ['text', 'image'],
    isReasoning: true,
    reasoningEfforts: {
      low: 'low',
      medium: 'medium',
      high: 'high',
      max: 'max'
    }
  },
  'deepseek-v4-pro': {
    name: 'DeepSeek V4 Pro (旗舰推理)',
    contextWindow: 1048576, // 1M 上下文
    maxTokens: 65536,       // 64K 最大输出
    input: ['text'],
    isReasoning: true,
    reasoningEfforts: {
      low: 'low',
      medium: 'medium',
      high: 'high',
      max: 'max'
    }
  },

  // 商汤日日新 SenseNova
  'sensenova-6.8-flash': {
    name: '商汤日日新 6.8 Flash (多模态推理)',
    contextWindow: 262144, // 262K 上下文
    maxTokens: 65536,      // 64K 最大输出
    input: ['text', 'image'],
    isReasoning: true,
    reasoningEfforts: {
      low: 'low',
      medium: 'medium',
      high: 'high',
      max: 'max'
    }
  },

  // 王者荣耀灵宝
  '王者荣耀灵宝': {
    name: '王者荣耀灵宝 (推理官渠)',
    contextWindow: 262144, // 256K 上下文
    maxTokens: 16384,      // 16K 最大输出
    input: ['text'],
    isReasoning: true,
    reasoningEfforts: {
      low: 'low',
      medium: 'medium',
      high: 'high',
      max: 'max'
    }
  },

  // 小米 MiMo 系列
  'mimo-v2.6-pro': {
    name: '小米 MiMo 2.6 Pro (全模态推理)',
    contextWindow: 1048576, // 1M 上下文
    maxTokens: 131072,      // 128K 最大输出
    input: ['text', 'image'],
    isReasoning: true,
    reasoningEfforts: {
      low: 'low',
      medium: 'medium',
      high: 'high',
      max: 'max'
    }
  },
  'mimo-v2.6-flash': {
    name: '小米 MiMo 2.6 Flash (限免/推理)',
    contextWindow: 1048576,
    maxTokens: 131072,
    input: ['text', 'image'],
    isReasoning: true,
    reasoningEfforts: {
      low: 'low',
      medium: 'medium',
      high: 'high',
      max: 'max'
    }
  },
  'mimo-v2.6-pro-ultraspeed': {
    name: '小米 MiMo 2.6 Pro UltraSpeed (极速/推理)',
    contextWindow: 1048576,
    maxTokens: 131072,
    input: ['text', 'image'],
    isReasoning: true,
    reasoningEfforts: {
      low: 'low',
      medium: 'medium',
      high: 'high',
      max: 'max'
    }
  },

  // Anthropic Claude
  'claude-opus-4-6-thinking': {
    name: 'Claude 4.6 Opus Thinking (深度思考)',
    contextWindow: 1048576, // 1M 上下文
    maxTokens: 65536,
    input: ['text', 'image'],
    isReasoning: true,
    reasoningEfforts: {
      low: 'low',
      medium: 'medium',
      high: 'high',
      max: 'max'
    }
  },
  'claude-sonnet-4-6': {
    name: 'Claude 4.6 Sonnet (编程主力)',
    contextWindow: 1048576, // 1M 上下文
    maxTokens: 65536,
    input: ['text', 'image'],
    isReasoning: false
  },
  'claude-opus-5-5': {
    name: 'Claude 5.5 Opus (旗舰长文本)',
    contextWindow: 200000,  // 200K 上下文，严禁虚标为 1M 避免超额崩溃
    maxTokens: 65536,
    input: ['text', 'image'],
    isReasoning: true,
    reasoningEfforts: {
      low: 'low',
      medium: 'medium',
      high: 'high',
      max: 'max'
    }
  },

  // 阶跃星辰 Step
  'step-5-preview': {
    name: '阶跃星辰 Step-5 Preview (全模态基模)',
    contextWindow: 1048576, // 1M 上下文
    maxTokens: 65536,
    input: ['text', 'image'],
    isReasoning: true,
    reasoningEfforts: {
      low: 'low',
      medium: 'medium',
      high: 'high',
      max: 'max'
    }
  },

  // MiniMax
  'minimax-m3.1-flash': {
    name: 'MiniMax M3.1 Flash (高速多模态)',
    contextWindow: 1048576, // 1M 上下文
    maxTokens: 32768,
    input: ['text', 'image'],
    isReasoning: true,
    reasoningEfforts: {
      low: 'low',
      medium: 'medium',
      high: 'high',
      max: 'max'
    }
  },

  // 月之暗面 Kimi
  'kimi-k3.1-pro': {
    name: '月之暗面 Kimi K3.1 Pro (多模态推理)',
    contextWindow: 1048576, // 1M 上下文
    maxTokens: 32768,
    input: ['text', 'image'],
    isReasoning: true,
    reasoningEfforts: {
      low: 'low',
      medium: 'medium',
      high: 'high',
      max: 'max'
    }
  },
  'kimi-k2.8-preview': {
    name: '月之暗面 Kimi K2.8 Preview (多模态)',
    contextWindow: 262144, // 256K 上下文
    maxTokens: 16384,
    input: ['text', 'image'],
    isReasoning: true,
    reasoningEfforts: {
      low: 'low',
      medium: 'medium',
      high: 'high',
      max: 'max'
    }
  },

  // 智谱 GLM 系列
  'glm-5.3-flash': {
    name: '智谱 GLM-5.3 Flash (多模态推理)',
    contextWindow: 1048576, // 1M 上下文
    maxTokens: 16384,
    input: ['text', 'image'],
    isReasoning: true,
    reasoningEfforts: {
      low: 'low',
      medium: 'medium',
      high: 'high',
      max: 'max'
    }
  },
  'glm-5.3': {
    name: '智谱 GLM-5.3 (旗舰推理)',
    contextWindow: 1048576, // 1M 上下文
    maxTokens: 16384,
    input: ['text'],        // 纯文本
    isReasoning: true,
    reasoningEfforts: {
      low: 'low',
      medium: 'medium',
      high: 'high',
      max: 'max'
    }
  },
  'glm-5.2': {
    name: '智谱 GLM-5.2 (夜间免费/推理)',
    contextWindow: 1048576, // 1M 上下文
    maxTokens: 16384,
    input: ['text'],        // 纯文本
    isReasoning: true,
    reasoningEfforts: {
      low: 'low',
      medium: 'medium',
      high: 'high',
      max: 'max'
    }
  },

  // OpenAI GPT 系列
  'gpt-6-astra': {
    name: 'GPT-6 Astra (全模态推理)',
    contextWindow: 1048576, // 1.05M 上下文
    maxTokens: 131072,      // 128K 最大输出
    input: ['text', 'image'],
    isReasoning: true,
    reasoningEfforts: {
      low: 'low',
      medium: 'medium',
      high: 'high',
      max: 'max'
    }
  },
  'gpt-6.1-sol': {
    name: 'GPT-6.1 Sol (严谨逻辑推理)',
    contextWindow: 131072,  // 128K 上下文
    maxTokens: 16384,
    input: ['text'],
    isReasoning: true,
    reasoningEfforts: {
      low: 'low',
      medium: 'medium',
      high: 'high',
      max: 'max'
    }
  },
  'gpt-oss-120b-medium': {
    name: 'GPT-OSS 120B Medium (开源推理)',
    contextWindow: 1048576, // 1M 上下文
    maxTokens: 16384,
    input: ['text'],
    isReasoning: true,
    reasoningEfforts: {
      low: 'low',
      medium: 'medium',
      high: 'high',
      max: 'max'
    }
  },

  // xAI Grok 系列
  'grok-4.7': {
    name: 'xAI Grok 4.7 (全模态推理)',
    contextWindow: 131072, // 128K 上下文
    maxTokens: 16384,
    input: ['text', 'image'],
    isReasoning: true,
    reasoningEfforts: {
      low: 'low',
      medium: 'medium',
      high: 'high',
      max: 'max'
    }
  }
};

/**
 * 判断是否是非对话模型
 */
function isNonChatModel(modelId) {
  return NON_CHAT_PATTERNS.some(pat => pat.test(modelId));
}

/**
 * 启发式推断未知模型规格
 */
function heuristicInfer(modelId) {
  const lower = modelId.toLowerCase();
  
  // 上下文判断
  let contextWindow = 65536;
  let maxTokens = 8192;
  if (lower.includes('1m') || lower.includes('mimo') || lower.includes('claude') || lower.includes('kimi') || lower.includes('step')) {
    contextWindow = 1048576;
    maxTokens = 65536;
  } else if (lower.includes('256k') || lower.includes('262k') || lower.includes('sensenova') || lower.includes('hy')) {
    contextWindow = 262144;
    maxTokens = 32768;
  } else if (lower.includes('128k') || lower.includes('deepseek') || lower.includes('glm') || lower.includes('grok')) {
    contextWindow = 131072;
    maxTokens = 16384;
  }

  // 视觉多模态判断
  const isVision = lower.includes('vl') || lower.includes('vision') || lower.includes('flash') || lower.includes('pro') || lower.includes('omni') || lower.includes('claude');

  // 推理模型判断
  const isReasoning = lower.includes('reason') || lower.includes('thinking') || lower.includes('r1') || lower.includes('o1') || lower.includes('pro') || lower.includes('flash');

  return {
    name: modelId,
    contextWindow,
    maxTokens,
    input: isVision ? ['text', 'image'] : ['text'],
    isReasoning
  };
}

/**
 * 将原始 API 返回的模型列表解析为 DeepSeek Harness llm-pi-ai 标准格式
 */
function parseModelList(rawModels, filterNonChat = true) {
  const result = [];

  for (const item of rawModels) {
    const id = item.id || item;
    if (!id || typeof id !== 'string') continue;

    if (filterNonChat && isNonChatModel(id)) {
      continue;
    }

    const spec = EXACT_MODEL_SPECS[id] || heuristicInfer(id);

    const modelObj = {
      id: id,
      name: spec.name || id,
      contextWindow: spec.contextWindow || 65536,
      maxTokens: spec.maxTokens || 8192,
      input: spec.input || ['text']
    };

    if (spec.isReasoning) {
      // 只要是推理模型，全量注入完整的 low, medium, high, max 档位
      modelObj.reasoningEfforts = {
        low: 'low',
        medium: 'medium',
        high: 'high',
        max: 'max',
        ...(spec.reasoningEfforts || {})
      };
    }

    result.push(modelObj);
  }

  return result;
}

module.exports = {
  isNonChatModel,
  parseModelList,
  parseModels: parseModelList
};
