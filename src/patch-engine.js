// -*- coding: utf-8 -*-
/**
 * WineToken 原生补丁增量合并引擎 (Zero-Dependency Patch Merging Engine)
 * 解决 P0 根因：零依赖增量合并至用户层 cordis.patch.yml，100% 保护已有 provider (如 zhaizhu) 与用户注释
 */
const fs = require('fs');
const path = require('path');

/**
 * 剥离模型显示名称末尾的括号修饰词 (ASCII (...) 与全角 （...），支持连续/空白分隔多个)；
 * 若剥离后为空串则保留原名。
 */
function sanitizeModelDisplayName(name, fallback = '') {
  const raw = typeof name === 'string' && name.length > 0 ? name : (typeof fallback === 'string' ? fallback : '');
  if (!raw) return '';
  let stripped = raw.trim();
  while (stripped) {
    const next = stripped
      .replace(/(?:\((?:[^()]|\([^()]*\))*\)|（(?:[^（）]|（[^（）]*）)*）)$/, '')
      .trim();
    if (next === stripped) break;
    stripped = next;
  }
  return stripped || raw;
}

/**
 * 将 Provider 配置对象序列化为标准 YAML 文本块 (纯原生，无外部依赖)
 */
function serializeProviderYaml(providerConfig, indent = '      ') {
  const pId = providerConfig.id || 'winetoken';
  const lines = [
    `${indent}${pId}:`,
    `${indent}  displayName: "${(providerConfig.displayName || 'WineToken (全平台推理模型)').replace(/"/g, '\\"')}"`,
    `${indent}  api: ${providerConfig.api || 'openai-completions'}`,
    `${indent}  baseURL: ${providerConfig.baseURL || 'https://www.winetoken.asia/v1'}`,
    `${indent}  apiKeyEnv: ${providerConfig.apiKeyEnv || 'WINETOKEN_API_KEY'}`,
    `${indent}  defaultContextWindow: ${providerConfig.defaultContextWindow || 1000000}`,
    `${indent}  defaultMaxTokens: ${providerConfig.defaultMaxTokens || 128000}`,
    `${indent}  models:`
  ];

  const mIndent = `${indent}    `;
  const models = Array.isArray(providerConfig.models) ? providerConfig.models : [];

  for (const m of models) {
    const safeName = sanitizeModelDisplayName(m.name, m.id).replace(/"/g, '\\"');
    lines.push(`${mIndent}- id: ${m.id}`);
    lines.push(`${mIndent}  name: "${safeName}"`);
    if (m.contextWindow) lines.push(`${mIndent}  contextWindow: ${m.contextWindow}`);
    if (m.maxTokens) lines.push(`${mIndent}  maxTokens: ${m.maxTokens}`);

    if (Array.isArray(m.input) && m.input.length > 0) {
      lines.push(`${mIndent}  input:`);
      for (const inp of m.input) {
        lines.push(`${mIndent}    - ${inp}`);
      }
    }

    if (m.reasoningEfforts && typeof m.reasoningEfforts === 'object') {
      lines.push(`${mIndent}  reasoningEfforts:`);
      for (const [k, v] of Object.entries(m.reasoningEfforts)) {
        lines.push(`${mIndent}    ${k}: ${v}`);
      }
    }
  }

  return lines.join('\n');
}

function buildFreshPatchContent(newProviderBlock) {
  return [
    '- id: llm-pi-ai',
    '  name: "@deepseek-ai/dsh-llm-pi-ai"',
    '  config:',
    '    providers:',
    newProviderBlock,
    ''
  ].join('\n');
}

/**
 * 将 winetoken provider 增量合并进已有 YAML 字符串
 * 严格保留现有用户的其他 provider (如 zhaizhu) 以及所有原始注释
 */
function mergeProviderIntoPatchContent(content, providerConfig) {
  const pId = providerConfig.id || 'winetoken';
  const newProviderBlock = serializeProviderYaml(providerConfig, '      ');

  const rawContent = typeof content === 'string' ? content : '';
  const lines = rawContent.split(/\r?\n/);
  const meaningfulLines = lines.filter(line => line.trim().length > 0 && !/^[ \t]*#/.test(line));

  // 若无有效内容，或唯一有效内容为空流式列表 ([] / [ ]，允许行尾内联注释)，按空文档处理
  if (
    meaningfulLines.length === 0 ||
    (meaningfulLines.length === 1 && /^[ \t]*\[[ \t]*\](?:[ \t]*#.*)?[ \t]*$/.test(meaningfulLines[0]))
  ) {
    return buildFreshPatchContent(newProviderBlock);
  }

  // 1. 寻找 llm-pi-ai 补丁项范围
  let llmPatchStartIndex = -1;
  let llmPatchEndIndex = lines.length;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 匹配顶层列表项 - id: llm-pi-ai (必须在行首，杜绝内部 models 列表误伤)
    if (/^-[ \t]+id:\s*['"]?llm-pi-ai['"]?/.test(line)) {
      llmPatchStartIndex = i;
      break;
    }
  }

  // 如果根本没有 llm-pi-ai 补丁项，仅当根结构为块级列表 (- ) 时追加到文末
  if (llmPatchStartIndex === -1) {
    if (!meaningfulLines[0].startsWith('- ')) {
      console.warn(
        '[WineToken PatchEngine] Unsupported cordis.patch.yml root shape (expected block sequence starting with "- "); patch file was left untouched.'
      );
      return content;
    }

    const appendBlock = [
      '',
      '# === 由 WineToken 插件自动注入模型提供商 ===',
      '- id: llm-pi-ai',
      '  name: "@deepseek-ai/dsh-llm-pi-ai"',
      '  config:',
      '    providers:',
      newProviderBlock,
      ''
    ].join('\n');
    return content.trimEnd() + '\n' + appendBlock;
  }

  // 计算 llm-pi-ai 的结束边界 (下一个顶层列表项 - id: 或 - insert:，必须在行首)
  for (let i = llmPatchStartIndex + 1; i < lines.length; i++) {
    if (/^-[ \t]+(id|insert):/.test(lines[i])) {
      llmPatchEndIndex = i;
      break;
    }
  }

  // 2. 在 llm-pi-ai 范围内寻找 providers: 节点
  let providersLineIndex = -1;
  let configLineIndex = -1;

  for (let i = llmPatchStartIndex; i < llmPatchEndIndex; i++) {
    if (/^[ \t]+config:\s*$/.test(lines[i])) {
      configLineIndex = i;
    }
    if (/^[ \t]+providers:\s*$/.test(lines[i])) {
      providersLineIndex = i;
      break;
    }
  }

  // 如果没有 config: 节点
  if (configLineIndex === -1 && providersLineIndex === -1) {
    lines.splice(llmPatchStartIndex + 1, 0, '  config:', '    providers:', newProviderBlock);
    return lines.join('\n');
  }

  // 如果有 config: 但没有 providers: 节点
  if (providersLineIndex === -1) {
    lines.splice(configLineIndex + 1, 0, '    providers:', newProviderBlock);
    return lines.join('\n');
  }

  // 3. 在 providers: 内部寻找是否存在目标 provider (如 winetoken)
  let targetProviderStart = -1;
  let targetProviderEnd = -1;
  let targetProviderIndent = 6;
  const targetRegex = new RegExp(`^([ \\t]+)${pId}:\\s*$`, 'i');

  const providersIndentMatch = lines[providersLineIndex].match(/^([ \t]*)/);
  const providersIndentLen = providersIndentMatch ? providersIndentMatch[1].length : 4;

  for (let i = providersLineIndex + 1; i < llmPatchEndIndex; i++) {
    const line = lines[i];
    if (line.trim().length === 0 || /^[ \t]*#/.test(line)) {
      continue;
    }

    const indentMatch = line.match(/^([ \t]*)/);
    const indentLen = indentMatch ? indentMatch[1].length : 0;

    // 若缩进小于等于 providers: 自身，说明已经跳出 providers 块
    if (indentLen <= providersIndentLen) {
      if (targetProviderStart !== -1) {
        targetProviderEnd = i;
      }
      break;
    }

    if (targetProviderStart === -1) {
      const match = line.match(targetRegex);
      if (match) {
        targetProviderStart = i;
        targetProviderIndent = match[1].length;
      }
    } else {
      // 已找到 targetProvider，正在寻找其结束行
      // 只有缩进与 targetProviderIndent 严格相等、且为键声明时，才是下一个同级 provider
      if (indentLen === targetProviderIndent && /^[ \t]+[a-zA-Z0-9_\-]+:\s*$/.test(line)) {
        targetProviderEnd = i;
        break;
      }
    }
  }

  if (targetProviderStart !== -1 && targetProviderEnd === -1) {
    targetProviderEnd = llmPatchEndIndex;
  }

  if (targetProviderStart !== -1) {
    // 已存在 winetoken 块，对比是否完全相同以保持绝对幂等
    const existingBlock = lines.slice(targetProviderStart, targetProviderEnd).join('\n');
    // 如果已有配置与新配置一致，直接返回原内容，保证 100% 幂等
    if (existingBlock.trim() === newProviderBlock.trim()) {
      return content;
    }
    // 否则仅替换 winetoken 这个局部块，周围所有其他 provider 与注释毫发无损
    lines.splice(targetProviderStart, targetProviderEnd - targetProviderStart, newProviderBlock);
    return lines.join('\n');
  }

  // 如果不存在 winetoken，直接在 providers: 下插入
  lines.splice(providersLineIndex + 1, 0, newProviderBlock);
  return lines.join('\n');
}

/**
 * 从当前插件自带的 cordis.patch.yml 中提取 21 个静态基线模型
 */
function getBaselineModels() {
  const bundlePatchPath = path.join(__dirname, '..', 'cordis.patch.yml');
  if (fs.existsSync(bundlePatchPath)) {
    try {
      const content = fs.readFileSync(bundlePatchPath, 'utf8');
      const lines = content.split(/\r?\n/);
      let inModels = false;
      let currentModel = null;
      const models = [];
      const finalizeModel = (m) => {
        if (!m) return;
        m.name = sanitizeModelDisplayName(m.name, m.id);
        if (m.reasoningEfforts && Object.keys(m.reasoningEfforts).length === 0) {
          m.reasoningEfforts = { low: 'low', medium: 'medium', high: 'high' };
        }
        models.push(m);
      };

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^[ \t]+models:\s*$/.test(line)) {
          inModels = true;
          continue;
        }
        if (inModels) {
          const matchId = line.match(/^[ \t]+-[ \t]+id:\s*([^\r\n#]+)/);
          if (matchId) {
            finalizeModel(currentModel);
            currentModel = {
              id: matchId[1].trim(),
              name: matchId[1].trim(),
              contextWindow: 131072,
              maxTokens: 16384,
              input: ['text']
            };
            continue;
          }

          if (currentModel) {
            const matchName = line.match(/^[ \t]+name:\s*([^\r\n#]+)/);
            if (matchName) currentModel.name = matchName[1].trim().replace(/^['"]|['"]$/g, '');

            const matchCtx = line.match(/^[ \t]+contextWindow:\s*(\d+)/);
            if (matchCtx) currentModel.contextWindow = parseInt(matchCtx[1], 10);

            const matchMax = line.match(/^[ \t]+maxTokens:\s*(\d+)/);
            if (matchMax) currentModel.maxTokens = parseInt(matchMax[1], 10);

            if (/^[ \t]+-[ \t]+image/.test(line)) {
              if (!currentModel.input.includes('image')) currentModel.input.push('image');
            }

            if (/^[ \t]+reasoningEfforts:\s*$/.test(line)) {
              currentModel.reasoningEfforts = {};
              continue;
            }

            const matchEffort = line.match(/^[ \t]+(low|medium|high|xhigh|max|ultra|minimal):\s*([^\r\n#]+)/);
            if (matchEffort && currentModel.reasoningEfforts) {
              currentModel.reasoningEfforts[matchEffort[1]] = matchEffort[2].trim();
            }
          }
        }
      }
      finalizeModel(currentModel);

      if (models.length > 0) {
        return models;
      }
    } catch (_) {}
  }

  // 内存硬编码终极兜底
  return [
    { id: 'claude-fable-5-2', name: 'Claude 5.2 Fable', contextWindow: 1048576, maxTokens: 131072, input: ['text', 'image'], reasoningEfforts: { low: 'low', medium: 'medium', high: 'high' } },
    { id: 'claude-opus-5-5', name: 'Claude 5.5 Opus', contextWindow: 1048576, maxTokens: 131072, input: ['text', 'image'], reasoningEfforts: { low: 'low', medium: 'medium', high: 'high' } },
    { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', contextWindow: 1048576, maxTokens: 393216, input: ['text'], reasoningEfforts: { low: 'low', medium: 'medium', high: 'high', max: 'max' } },
    { id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', contextWindow: 1048576, maxTokens: 393216, input: ['text', 'image'], reasoningEfforts: { low: 'low', medium: 'medium', high: 'high', max: 'max' } },
    { id: 'glm-5.2', name: 'GLM-5.2', contextWindow: 1048576, maxTokens: 131072, input: ['text'], reasoningEfforts: { low: 'low', medium: 'medium', high: 'high' } },
    { id: 'glm-5.3', name: 'GLM-5.3', contextWindow: 1048576, maxTokens: 131072, input: ['text'], reasoningEfforts: { low: 'low', medium: 'medium', high: 'high' } },
    { id: 'glm-5.3-flash', name: 'GLM-5.3 Flash', contextWindow: 1048576, maxTokens: 131072, input: ['text', 'image'], reasoningEfforts: { low: 'low', medium: 'medium', high: 'high' } },
    { id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna', contextWindow: 272000, maxTokens: 131072, input: ['text', 'image'], reasoningEfforts: { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' } },
    { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra', contextWindow: 272000, maxTokens: 131072, input: ['text', 'image'], reasoningEfforts: { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max', ultra: 'ultra' } },
    { id: 'gpt-6-luna', name: 'GPT-6 Luna', contextWindow: 272000, maxTokens: 131072, input: ['text', 'image'], reasoningEfforts: { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' } },
    { id: 'gpt-6.2-astra', name: 'GPT-6.2 Astra', contextWindow: 1048576, maxTokens: 131072, input: ['text', 'image'], reasoningEfforts: { low: 'low', medium: 'medium', high: 'high' } },
    { id: 'gpt-6.2-sol', name: 'GPT-6.2 Sol', contextWindow: 1048576, maxTokens: 131072, input: ['text', 'image'], reasoningEfforts: { low: 'low', medium: 'medium', high: 'high' } },
    { id: 'grok-4.7', name: 'Grok 4.7', contextWindow: 500000, maxTokens: 16384, input: ['text', 'image'], reasoningEfforts: { low: 'low', medium: 'medium', high: 'high' } },
    { id: 'hy4', name: '腾讯混元 Hy4', contextWindow: 1048576, maxTokens: 65536, input: ['text', 'image'], reasoningEfforts: { low: 'low', medium: 'medium', high: 'high' } },
    { id: 'hy4-flash', name: '腾讯混元 Hy4 Flash', contextWindow: 1048576, maxTokens: 65536, input: ['text', 'image'], reasoningEfforts: { low: 'low', medium: 'medium', high: 'high' } },
    { id: 'kimi-k3.1-pro', name: 'Kimi K3.1 Pro', contextWindow: 1048576, maxTokens: 32768, input: ['text', 'image'], reasoningEfforts: { low: 'low', medium: 'medium', high: 'high' } },
    { id: 'mimo-v2.6-flash', name: 'MiMo V2.6 Flash', contextWindow: 200000, maxTokens: 32768, input: ['text'], reasoningEfforts: { low: 'low', medium: 'medium', high: 'high' } },
    { id: 'mimo-v2.6-pro', name: 'MiMo V2.6 Pro', contextWindow: 1048576, maxTokens: 131072, input: ['text', 'image'], reasoningEfforts: { low: 'low', medium: 'medium', high: 'high' } },
    { id: 'minimax-m3.1-flash', name: 'MiniMax M3.1 Flash', contextWindow: 1048576, maxTokens: 32768, input: ['text', 'image'], reasoningEfforts: { low: 'low', medium: 'medium', high: 'high' } },
    { id: 'sensenova-6.8-flash', name: 'SenseNova 6.8 Flash', contextWindow: 262144, maxTokens: 65536, input: ['text', 'image'], reasoningEfforts: { low: 'low', medium: 'medium', high: 'high' } }
  ];
}

module.exports = {
  sanitizeModelDisplayName,
  serializeProviderYaml,
  mergeProviderIntoPatchContent,
  getBaselineModels
};
