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

// 已知模型的精确规格库（100% 对齐 WineToken 线上生产数据库与离线基线）
const EXACT_MODEL_SPECS = {
  // Anthropic Claude
  'claude-fable-5-2': {
    name: 'Claude 5.2 Fable',
    contextWindow: 1048576, // 1M 上下文 (Anthropic 官方规格，Fable 5.2)
    maxTokens: 131072,     // 128K 最大输出 (官方)
    input: ['text', 'image'],
    isReasoning: true,
    reasoningEfforts: {
      low: 'low',
      medium: 'medium',
      high: 'high'
    }
  },
  'claude-opus-5-5': {
    name: 'Claude 5.5 Opus',
    contextWindow: 1048576, // 1M 上下文 (Anthropic 官方规格，Opus 5.5)
    maxTokens: 131072,     // 128K 最大输出 (官方)
    input: ['text', 'image'],
    isReasoning: true,
    reasoningEfforts: {
      low: 'low',
      medium: 'medium',
      high: 'high'
    }
  },

  // DeepSeek 深度思考与多模态推理
  'deepseek-v4-pro': {
    name: 'DeepSeek V4 Pro',
    contextWindow: 1048576, // 1M 上下文 (DeepSeek V4 官方规格)
    maxTokens: 393216,      // 384K 最大输出 (官方)
    input: ['text'],
    isReasoning: true,
    reasoningEfforts: {
      low: 'low',
      medium: 'medium',
      high: 'high',
      max: 'max'
    }
  },
  'deepseek-v4.1-flash': {
    name: 'DeepSeek V4.1 Flash',
    contextWindow: 1048576, // 1M 上下文 (上游变体规格，站长确认，不套公开版 DeepSeek 家族规格)
    maxTokens: 393216,      // 384K 最大输出 (站长确认)
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
  'glm-5.2': {
    name: 'GLM-5.2',
    contextWindow: 1048576, // 1M 上下文 (智谱官方 GLM-5.2/5.3 规格，最大输出 128K)
    maxTokens: 131072,
    input: ['text'],        // 纯文本
    isReasoning: true,
    reasoningEfforts: {
      low: 'low',
      medium: 'medium',
      high: 'high'
    }
  },
  'glm-5.3': {
    name: 'GLM-5.3',
    contextWindow: 1048576, // 1M 上下文 (智谱官方 GLM-5.2/5.3 规格，最大输出 128K)
    maxTokens: 131072,
    input: ['text'],        // 纯文本
    isReasoning: true,
    reasoningEfforts: {
      low: 'low',
      medium: 'medium',
      high: 'high'
    }
  },
  'glm-5.3-flash': {
    name: 'GLM-5.3 Flash',
    contextWindow: 1048576, // 1M 上下文 (智谱官方 GLM-5.2/5.3 规格，最大输出 128K)
    maxTokens: 131072,
    input: ['text', 'image'],
    isReasoning: true,
    reasoningEfforts: {
      low: 'low',
      medium: 'medium',
      high: 'high'
    }
  },

  // OpenAI GPT 系列
  'gpt-5.6-luna': {
    name: 'GPT-5.6 Luna',
    contextWindow: 272000,
    maxTokens: 131072,
    input: ['text', 'image'],
    isReasoning: true,
    reasoningEfforts: {
      low: 'low',
      medium: 'medium',
      high: 'high',
      xhigh: 'xhigh',
      max: 'max'
    }
  },
  'gpt-5.6-terra': {
    name: 'GPT-5.6 Terra',
    contextWindow: 272000,
    maxTokens: 131072,
    input: ['text', 'image'],
    isReasoning: true,
    reasoningEfforts: {
      low: 'low',
      medium: 'medium',
      high: 'high',
      xhigh: 'xhigh',
      max: 'max',
      ultra: 'ultra'
    }
  },
  'gpt-6-luna': {
    name: 'GPT-6 Luna',
    contextWindow: 272000,
    maxTokens: 131072,
    input: ['text', 'image'],
    isReasoning: true,
    reasoningEfforts: {
      low: 'low',
      medium: 'medium',
      high: 'high',
      xhigh: 'xhigh',
      max: 'max'
    }
  },
  'gpt-6.2-astra': {
    name: 'GPT-6.2 Astra',
    contextWindow: 1048576, // 1M 上下文 (按 GPT-5.5 世代官方规格，6 代不低于此)
    maxTokens: 131072,     // 128K 最大输出 (GPT-5 世代官方统一规格)
    input: ['text', 'image'],
    isReasoning: true,
    reasoningEfforts: {
      low: 'low',
      medium: 'medium',
      high: 'high'
    }
  },
  'gpt-6.2-sol': {
    name: 'GPT-6.2 Sol',
    contextWindow: 1048576, // 1M 上下文 (按 GPT-5.5 世代官方规格，6 代不低于此)
    maxTokens: 131072,     // 128K 最大输出 (GPT-5 世代官方统一规格)
    input: ['text', 'image'],
    isReasoning: true,
    reasoningEfforts: {
      low: 'low',
      medium: 'medium',
      high: 'high'
    }
  },

  // xAI Grok 系列
  'grok-4.7': {
    name: 'Grok 4.7',
    contextWindow: 500000, // 500K 上下文 (xAI 官方规格；官方未单列输出上限，maxTokens 暂保留)
    maxTokens: 16384,
    input: ['text', 'image'],
    isReasoning: true,
    reasoningEfforts: {
      low: 'low',
      medium: 'medium',
      high: 'high'
    }
  },

  // 腾讯混元 Hy 系列
  'hy4': {
    name: '腾讯混元 Hy4',
    contextWindow: 1048576, // 1M 上下文
    maxTokens: 65536,       // 64K 最大输出
    input: ['text', 'image'],
    isReasoning: true,
    reasoningEfforts: {
      low: 'low',
      medium: 'medium',
      high: 'high'
    }
  },
  'hy4-flash': {
    name: '腾讯混元 Hy4 Flash',
    contextWindow: 1048576, // 1M 上下文
    maxTokens: 65536,       // 64K 最大输出
    input: ['text', 'image'],
    isReasoning: true,
    reasoningEfforts: {
      low: 'low',
      medium: 'medium',
      high: 'high'
    }
  },

  // 月之暗面 Kimi
  'kimi-k3.1-pro': {
    name: 'Kimi K3.1 Pro',
    contextWindow: 1048576, // 1M 上下文
    maxTokens: 32768,
    input: ['text', 'image'],
    isReasoning: true,
    reasoningEfforts: {
      low: 'low',
      medium: 'medium',
      high: 'high'
    }
  },

  // 小米 MiMo 系列
  'mimo-v2.6-flash': {
    name: 'MiMo V2.6 Flash',
    contextWindow: 200000,
    maxTokens: 32768,
    input: ['text'],
    isReasoning: true,
    reasoningEfforts: {
      low: 'low',
      medium: 'medium',
      high: 'high'
    }
  },
  'mimo-v2.6-pro': {
    name: 'MiMo V2.6 Pro',
    contextWindow: 1048576, // 1M 上下文
    maxTokens: 131072,      // 128K 最大输出
    input: ['text', 'image'],
    isReasoning: true,
    reasoningEfforts: {
      low: 'low',
      medium: 'medium',
      high: 'high'
    }
  },

  // MiniMax
  'minimax-m3.1-flash': {
    name: 'MiniMax M3.1 Flash',
    contextWindow: 1048576, // 1M 上下文
    maxTokens: 32768,
    input: ['text', 'image'],
    isReasoning: true,
    reasoningEfforts: {
      low: 'low',
      medium: 'medium',
      high: 'high'
    }
  },

  // 商汤日日新 SenseNova
  'sensenova-6.8-flash': {
    name: 'SenseNova 6.8 Flash',
    contextWindow: 262144, // 262K 上下文
    maxTokens: 65536,      // 64K 最大输出
    input: ['text', 'image'],
    isReasoning: true,
    reasoningEfforts: {
      low: 'low',
      medium: 'medium',
      high: 'high'
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
  if (lower.includes('claude') || lower.includes('fable') || lower.includes('opus')) {
    contextWindow = 1048576; // Claude 当前世代官方 1M
    maxTokens = 65536;
  } else if (lower.includes('1m') || lower.includes('mimo') || lower.includes('step') || lower.includes('gemini') || lower.includes('hy4')) {
    contextWindow = 1048576;
    maxTokens = 65536;
  } else if (lower.includes('kimi')) {
    contextWindow = 1048576; // 站内 Kimi 统一 1M (站长定)
    maxTokens = 16384;
  } else if (lower.includes('256k') || lower.includes('262k') || lower.includes('sensenova') || lower.includes('hy')) {
    contextWindow = 262144;
    maxTokens = 32768;
  } else if (lower.includes('deepseek')) {
    contextWindow = 1048576; // DeepSeek V4 世代官方 1M
    maxTokens = 65536;
  } else if (lower.includes('glm')) {
    contextWindow = 1048576; // 智谱 GLM-5.2 起官方 1M (GLM-5 基础版才是 200K)
    maxTokens = 65536;
  } else if (lower.includes('grok')) {
    contextWindow = 500000; // xAI 官方 500K
    maxTokens = 16384;
  } else if (lower.includes('gpt')) {
    contextWindow = 1048576; // GPT-5.5 世代官方 1M
    maxTokens = 131072;
  } else if (lower.includes('128k')) {
    contextWindow = 131072;
    maxTokens = 16384;
  }

  // 视觉多模态判断
  const isVision = lower.includes('vl') || lower.includes('vision') || lower.includes('flash') || lower.includes('pro') || lower.includes('omni') || lower.includes('claude') || lower.includes('gemini') || lower.includes('gpt');

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
      // 档位以规格表为准 (deepseek 家族含 max 档)；规格表缺失时兜底三档
      modelObj.reasoningEfforts = spec.reasoningEfforts
        ? { ...spec.reasoningEfforts }
        : { low: 'low', medium: 'medium', high: 'high' };
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
