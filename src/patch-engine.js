// -*- coding: utf-8 -*-
/**
 * WineToken 原生补丁增量合并引擎 (Zero-Dependency Patch Merging Engine)
 * 解决 P0 根因：零依赖增量合并至用户层 cordis.patch.yml，100% 保护已有 provider (如 zhaizhu) 与用户注释
 */
const fs = require('fs');
const path = require('path');

const MANAGED_START_PREFIX = '# >>> winetoken-managed:start';
const MANAGED_END_LINE = '# <<< winetoken-managed:end <<<';
const LEGACY_HEADER_COMMENT = '# === 由 WineToken 插件自动注入模型提供商 ===';

const MANAGED_START_RE = /^[ \t]*#[ \t]*>>>[ \t]*winetoken-managed:start\b.*$/;
const MANAGED_END_RE = /^[ \t]*#[ \t]*<<<[ \t]*winetoken-managed:end\b.*$/;
const LEGACY_HEADER_RE = /^[ \t]*#[ \t]*===[ \t]*由[ \t]*WineToken[ \t]*插件自动注入模型提供商[ \t]*===[ \t]*$/;

const REMOVED = Symbol('REMOVED');

function isBlank(line) {
  return line.trim().length === 0;
}

function isComment(line) {
  return /^[ \t]*#/.test(line);
}

function isSemantic(line) {
  return !isBlank(line) && !isComment(line);
}

function indentOf(line) {
  const m = line.match(/^[ \t]*/);
  return m ? m[0].length : 0;
}

function isPluginOwnedCommentLine(line) {
  if (typeof line !== 'string') return false;
  return (
    MANAGED_START_RE.test(line) ||
    MANAGED_END_RE.test(line) ||
    LEGACY_HEADER_RE.test(line)
  );
}

function unquoteScalar(val) {
  return String(val || '').trim().replace(/^['"]|['"]$/g, '');
}

function isParentHeaderLine(line) {
  const stripped = line.replace(/[ \t]+#.*$/, '').trimEnd();
  return stripped.endsWith(':');
}

/**
 * 局部空白收拢：仅在存在 REMOVED 哨兵的缝隙处收拢多余空行，未修改条目之间的原始空行一字不改
 */
function collapseRemovedSeams(items) {
  const out = [];
  let i = 0;
  while (i < items.length) {
    const item = items[i];
    if (typeof item === 'string' && !isBlank(item)) {
      out.push(item);
      i++;
      continue;
    }

    let j = i;
    const blanks = [];
    let sawRemoved = false;
    while (j < items.length && (items[j] === REMOVED || (typeof items[j] === 'string' && isBlank(items[j])))) {
      if (items[j] === REMOVED) {
        sawRemoved = true;
      } else {
        blanks.push(items[j]);
      }
      j++;
    }

    if (!sawRemoved) {
      for (const b of blanks) out.push(b);
    } else {
      const prevLine = out.length > 0 ? out[out.length - 1] : null;
      const nextLine = j < items.length ? items[j] : null;
      if (prevLine !== null && nextLine !== null && blanks.length > 0) {
        const dropBetweenParentAndChild =
          isParentHeaderLine(prevLine) && indentOf(nextLine) > indentOf(prevLine);
        if (!dropBetweenParentAndChild) {
          out.push(blanks[0]);
        }
      }
    }
    i = j;
  }
  return out;
}

function isTopLevelEntryStart(line) {
  return /^-(?:[ \t]+|$)/.test(line);
}

/**
 * 严格仅按行首非注释 "- " 切分 preamble 与顶层条目，并将尾部空白/注释归入 trailingLines 防止跨块粘连
 */
function splitTopLevelEntries(lines) {
  const firstEntryIdx = lines.findIndex(isTopLevelEntryStart);
  if (firstEntryIdx === -1) {
    return { preambleLines: lines.slice(), entries: [] };
  }

  const preambleLines = lines.slice(0, firstEntryIdx);
  const entryStartIndices = [];
  for (let i = firstEntryIdx; i < lines.length; i++) {
    if (isTopLevelEntryStart(lines[i])) {
      entryStartIndices.push(i);
    }
  }

  const entries = [];
  for (let k = 0; k < entryStartIndices.length; k++) {
    const start = entryStartIndices[k];
    const end = k + 1 < entryStartIndices.length ? entryStartIndices[k + 1] : lines.length;
    const rawLines = lines.slice(start, end);
    let lastSemanticRelIdx = 0;
    for (let r = rawLines.length - 1; r >= 0; r--) {
      if (isSemantic(rawLines[r])) {
        lastSemanticRelIdx = r;
        break;
      }
    }
    entries.push({
      rawLines,
      bodyLines: rawLines.slice(0, lastSemanticRelIdx + 1),
      trailingLines: rawLines.slice(lastSemanticRelIdx + 1),
      semanticLines: rawLines.filter(isSemantic)
    });
  }

  return { preambleLines, entries };
}

function extractEntryTopLevelProps(semanticLines) {
  const props = {};
  if (!Array.isArray(semanticLines) || semanticLines.length === 0) return props;

  const firstMatch = semanticLines[0].match(/^-[ \t]+([a-zA-Z0-9_-]+):(.*)$/);
  if (firstMatch) {
    props[firstMatch[1]] = unquoteScalar(firstMatch[2]);
  }

  let propIndent = null;
  for (let i = 1; i < semanticLines.length; i++) {
    const line = semanticLines[i];
    const ind = indentOf(line);
    if (ind === 0) break;
    if (propIndent === null) propIndent = ind;
    if (ind === propIndent) {
      const m = line.match(/^[ \t]+([a-zA-Z0-9_-]+):(.*)$/);
      if (m) {
        props[m[1]] = unquoteScalar(m[2]);
      }
    }
  }
  return props;
}

function isStandaloneWineTokenPluginEntry(semanticLines) {
  if (!Array.isArray(semanticLines) || semanticLines.length === 0) return false;
  if (/^-[ \t]+insert:[ \t]*$/.test(semanticLines[0])) return false;
  const props = extractEntryTopLevelProps(semanticLines);
  return props.id === 'winetoken-plugin' || props.name === '@winetoken/dsh-plugin-winetoken';
}

function isInsertListEntry(semanticLines) {
  return Array.isArray(semanticLines) && semanticLines.length > 0 && /^-[ \t]+insert:[ \t]*$/.test(semanticLines[0]);
}

function isWineTokenInsertSubItem(semanticLines) {
  if (!Array.isArray(semanticLines) || semanticLines.length === 0) return false;
  const first = semanticLines[0];
  const scalarMatch = first.match(/^[ \t]+-[ \t]+(['"]?)(@winetoken\/dsh-plugin-winetoken|winetoken-plugin)\1[ \t]*$/);
  if (scalarMatch && semanticLines.length === 1) return true;

  const props = {};
  const firstKey = first.match(/^[ \t]+-[ \t]+([a-zA-Z0-9_-]+):(.*)$/);
  if (firstKey) props[firstKey[1]] = unquoteScalar(firstKey[2]);
  const baseIndent = indentOf(first);
  let childIndent = null;
  for (let i = 1; i < semanticLines.length; i++) {
    const line = semanticLines[i];
    const ind = indentOf(line);
    if (ind <= baseIndent) break;
    if (childIndent === null) childIndent = ind;
    if (ind === childIndent) {
      const m = line.match(/^[ \t]+([a-zA-Z0-9_-]+):(.*)$/);
      if (m) props[m[1]] = unquoteScalar(m[2]);
    }
  }
  return props.id === 'winetoken-plugin' || props.name === '@winetoken/dsh-plugin-winetoken';
}

function removeWineTokenFromInsertEntry(bodyLines) {
  const insertIdx = bodyLines.findIndex(line => isSemantic(line) && /^-[ \t]+insert:[ \t]*$/.test(line));
  if (insertIdx === -1) {
    return { nextItems: bodyLines.slice(), removedSubCount: 0, remainingItemCount: 0 };
  }

  let itemIndent = -1;
  for (let i = insertIdx + 1; i < bodyLines.length; i++) {
    if (isSemantic(bodyLines[i]) && /^[ \t]+-(?:[ \t]+|$)/.test(bodyLines[i])) {
      itemIndent = indentOf(bodyLines[i]);
      break;
    }
  }
  if (itemIndent === -1) {
    return { nextItems: bodyLines.slice(), removedSubCount: 0, remainingItemCount: 0 };
  }

  const subStarts = [];
  for (let i = insertIdx + 1; i < bodyLines.length; i++) {
    if (isSemantic(bodyLines[i]) && indentOf(bodyLines[i]) === itemIndent && /^[ \t]+-(?:[ \t]+|$)/.test(bodyLines[i])) {
      subStarts.push(i);
    }
  }

  const nextItems = bodyLines.slice(0, subStarts[0]);
  let removedSubCount = 0;
  let remainingItemCount = 0;

  for (let k = 0; k < subStarts.length; k++) {
    const start = subStarts[k];
    const end = k + 1 < subStarts.length ? subStarts[k + 1] : bodyLines.length;
    const rawSub = bodyLines.slice(start, end);
    let lastSemRel = 0;
    for (let r = rawSub.length - 1; r >= 0; r--) {
      if (isSemantic(rawSub[r])) {
        lastSemRel = r;
        break;
      }
    }
    const subBody = rawSub.slice(0, lastSemRel + 1);
    const subTrailing = rawSub.slice(lastSemRel + 1);
    const subSemantic = rawSub.filter(isSemantic);

    if (isWineTokenInsertSubItem(subSemantic)) {
      removedSubCount++;
      for (let t = 0; t < subBody.length; t++) nextItems.push(REMOVED);
      for (const tl of subTrailing) nextItems.push(tl);
    } else {
      remainingItemCount++;
      for (const rl of rawSub) nextItems.push(rl);
    }
  }

  return { nextItems, removedSubCount, remainingItemCount };
}

function isLlmPiAiEntry(semanticLines) {
  const props = extractEntryTopLevelProps(semanticLines);
  return props.id === 'llm-pi-ai';
}

function isEmptyLlmSkeletonSemanticLine(line) {
  if (/^-[ \t]+id:[ \t]*['"]?llm-pi-ai['"]?[ \t]*$/.test(line)) return true;
  if (/^[ \t]+id:[ \t]*['"]?llm-pi-ai['"]?[ \t]*$/.test(line)) return true;
  if (/^[ \t]+name:[ \t]*['"]?@deepseek-ai\/dsh-llm-pi-ai['"]?[ \t]*$/.test(line)) return true;
  if (/^[ \t]+config:[ \t]*(?:\{\s*\})?[ \t]*$/.test(line)) return true;
  if (/^[ \t]+providers:[ \t]*(?:\{\s*\})?[ \t]*$/.test(line)) return true;
  return false;
}

function removeWineTokenFromLlmPiAi(bodyLines) {
  const nextItems = bodyLines.slice();
  let configIdx = -1;
  let configIndent = -1;

  for (let i = 1; i < bodyLines.length; i++) {
    const line = bodyLines[i];
    if (!isSemantic(line)) continue;
    if (/^[ \t]+config:[ \t]*(?:\{\s*\})?[ \t]*$/.test(line)) {
      configIdx = i;
      configIndent = indentOf(line);
      break;
    }
  }

  let providersIdx = -1;
  let providersIndent = -1;
  if (configIdx !== -1) {
    for (let i = configIdx + 1; i < bodyLines.length; i++) {
      const line = bodyLines[i];
      if (!isSemantic(line)) continue;
      if (indentOf(line) <= configIndent) break;
      if (/^[ \t]+providers:[ \t]*(?:\{\s*\})?[ \t]*$/.test(line)) {
        providersIdx = i;
        providersIndent = indentOf(line);
        break;
      }
    }
  }

  let removedProviders = 0;
  let providersBlockEnd = bodyLines.length;

  if (providersIdx !== -1) {
    for (let i = providersIdx + 1; i < bodyLines.length; i++) {
      if (isSemantic(bodyLines[i]) && indentOf(bodyLines[i]) <= providersIndent) {
        providersBlockEnd = i;
        break;
      }
    }

    for (let i = providersIdx + 1; i < providersBlockEnd; i++) {
      const line = bodyLines[i];
      if (!isSemantic(line)) continue;
      if (/^([ \t]+)winetoken:[ \t]*(?:\{\s*\})?[ \t]*$/i.test(line)) {
        const wStart = i;
        const wIndent = indentOf(line);
        let lastOwned = i;
        let seenBlank = false;

        for (let j = i + 1; j < providersBlockEnd; j++) {
          const cur = bodyLines[j];
          if (isBlank(cur)) {
            seenBlank = true;
            continue;
          }
          if (isComment(cur)) {
            if (!seenBlank && indentOf(cur) > wIndent) {
              lastOwned = j;
            }
            continue;
          }
          if (indentOf(cur) <= wIndent) {
            break;
          }
          lastOwned = j;
          seenBlank = false;
        }

        for (let k = wStart; k <= lastOwned; k++) {
          nextItems[k] = REMOVED;
        }
        removedProviders++;
        i = lastOwned;
      }
    }
  }

  let remainingProvidersChildren = 0;
  if (providersIdx !== -1) {
    for (let i = providersIdx + 1; i < providersBlockEnd; i++) {
      if (typeof nextItems[i] === 'string' && isSemantic(nextItems[i])) {
        remainingProvidersChildren++;
      }
    }
  }

  let shouldDropWholeEntry = false;
  if (remainingProvidersChildren === 0) {
    const remainingSemantic = nextItems.filter(item => typeof item === 'string' && isSemantic(item));
    if (remainingSemantic.length > 0 && remainingSemantic.every(isEmptyLlmSkeletonSemanticLine)) {
      shouldDropWholeEntry = true;
    } else if (providersIdx !== -1 && removedProviders > 0) {
      // 保留其他 config 键时，移除已清空的 providers: 节点以免残余 null 覆盖宿主默认 providers
      nextItems[providersIdx] = REMOVED;
    }
  }

  return { nextItems, removedProviders, shouldDropWholeEntry };
}

function isStrictlyWineTokenManagedContent(semanticInner) {
  if (semanticInner.length === 0) return true;

  // Case A: mode=provider 子块 (仅包含缩进的 winetoken: 及其更深子属性)
  if (/^[ \t]+winetoken:[ \t]*(?:\{\s*\})?[ \t]*$/i.test(semanticInner[0])) {
    const wIndent = indentOf(semanticInner[0]);
    for (let i = 1; i < semanticInner.length; i++) {
      const line = semanticInner[i];
      const ind = indentOf(line);
      if (ind < wIndent) return false;
      if (ind === wIndent && !/^[ \t]+winetoken:[ \t]*(?:\{\s*\})?[ \t]*$/i.test(line)) {
        return false;
      }
    }
    return true;
  }

  // Case B: 顶层条目 (mode=full-entry / mode=plugin-entry)
  if (!isTopLevelEntryStart(semanticInner[0])) return false;
  const { preambleLines, entries } = splitTopLevelEntries(semanticInner);
  if (preambleLines.length > 0 || entries.length === 0) return false;

  for (const entry of entries) {
    if (isStandaloneWineTokenPluginEntry(entry.semanticLines)) continue;
    if (isInsertListEntry(entry.semanticLines)) {
      const res = removeWineTokenFromInsertEntry(entry.bodyLines);
      if (res.removedSubCount > 0 && res.remainingItemCount === 0) continue;
      return false;
    }
    if (isLlmPiAiEntry(entry.semanticLines)) {
      const res = removeWineTokenFromLlmPiAi(entry.bodyLines);
      if (res.shouldDropWholeEntry) continue;
      return false;
    }
    return false;
  }
  return true;
}

function stripVerifiedManagedBlocks(lines, stats) {
  const items = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (MANAGED_START_RE.test(line)) {
      let endIdx = -1;
      for (let j = i + 1; j < lines.length; j++) {
        if (MANAGED_START_RE.test(lines[j])) {
          // 遇到新的 start 标记前仍未闭合，当前 start 视为孤立标记，交由 Phase 1B 剥离
          break;
        }
        if (MANAGED_END_RE.test(lines[j])) {
          endIdx = j;
          break;
        }
      }

      if (endIdx !== -1) {
        const innerLines = lines.slice(i + 1, endIdx);
        const semanticInner = innerLines.filter(isSemantic);
        if (isStrictlyWineTokenManagedContent(semanticInner)) {
          stats.managedBlocksRemoved++;
          if (/^[ \t]+winetoken:[ \t]*(?:\{\s*\})?[ \t]*$/i.test(semanticInner[0] || '')) {
            stats.providersRemoved++;
          } else if (semanticInner.length > 0) {
            const { entries } = splitTopLevelEntries(semanticInner);
            for (const entry of entries) {
              if (isStandaloneWineTokenPluginEntry(entry.semanticLines) || isInsertListEntry(entry.semanticLines)) {
                stats.pluginEntriesRemoved++;
              } else if (isLlmPiAiEntry(entry.semanticLines)) {
                const res = removeWineTokenFromLlmPiAi(entry.bodyLines);
                stats.providersRemoved += res.removedProviders;
                stats.emptyLlmEntriesRemoved++;
              }
            }
          }
          for (let k = i; k <= endIdx; k++) items.push(REMOVED);
          i = endIdx + 1;
          continue;
        }

        // 区间内混入了无关条目，降级为只剥离起止标记注释，交由 Phase 2 结构化裁决
        items.push(REMOVED);
        stats.commentsRemoved++;
        for (const inner of innerLines) items.push(inner);
        items.push(REMOVED);
        stats.commentsRemoved++;
        i = endIdx + 1;
        continue;
      }
    }

    items.push(line);
    i++;
  }
  return collapseRemovedSeams(items);
}

/**
 * 两阶段零误伤清理器：从 cordis.patch.yml 文本中净除所有 WineToken 注入段与游离注释
 * 保留 ui-theme 等正常插件、zhaizhu 等共存 provider 及用户自定义注释，支持 CRLF 与绝对幂等
 */
function cleanWineTokenFromPatchContent(content, _options = {}) {
  const stats = {
    managedBlocksRemoved: 0,
    commentsRemoved: 0,
    pluginEntriesRemoved: 0,
    providersRemoved: 0,
    emptyLlmEntriesRemoved: 0
  };

  if (typeof content !== 'string' || content.length === 0) {
    return {
      content: typeof content === 'string' ? content : '',
      changed: false,
      status: 'already_clean',
      stats
    };
  }

  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const hadTrailingNewline = content.endsWith('\n');
  const rawLines = content.replace(/\r\n/g, '\n').split('\n');
  if (hadTrailingNewline && rawLines.length > 0 && rawLines[rawLines.length - 1] === '') {
    rawLines.pop();
  }

  // Phase 1A: 校验并移除配对的 managed 标记区间
  const afterManaged = stripVerifiedManagedBlocks(rawLines, stats);

  // Phase 1B: 剥离游离插件自有注释行（例如挂在 ui-theme 末尾的插件注释）
  const phase1Items = [];
  for (const line of afterManaged) {
    if (isPluginOwnedCommentLine(line)) {
      phase1Items.push(REMOVED);
      stats.commentsRemoved++;
    } else {
      phase1Items.push(line);
    }
  }
  const cleanCommentLines = collapseRemovedSeams(phase1Items);

  // Phase 2: 顶层块与非注释结构化裁决
  const { preambleLines, entries } = splitTopLevelEntries(cleanCommentLines);
  const phase2Items = [...preambleLines];

  for (const entry of entries) {
    if (isStandaloneWineTokenPluginEntry(entry.semanticLines)) {
      stats.pluginEntriesRemoved++;
      for (let k = 0; k < entry.bodyLines.length; k++) phase2Items.push(REMOVED);
      for (const tl of entry.trailingLines) phase2Items.push(tl);
      continue;
    }

    if (isInsertListEntry(entry.semanticLines)) {
      const { nextItems, removedSubCount, remainingItemCount } = removeWineTokenFromInsertEntry(entry.bodyLines);
      if (removedSubCount > 0) {
        stats.pluginEntriesRemoved += removedSubCount;
        if (remainingItemCount === 0) {
          for (let k = 0; k < entry.bodyLines.length; k++) phase2Items.push(REMOVED);
          for (const tl of entry.trailingLines) phase2Items.push(tl);
        } else {
          for (const ni of nextItems) phase2Items.push(ni);
          for (const tl of entry.trailingLines) phase2Items.push(tl);
        }
        continue;
      }
    }

    if (isLlmPiAiEntry(entry.semanticLines)) {
      const { nextItems, removedProviders, shouldDropWholeEntry } = removeWineTokenFromLlmPiAi(entry.bodyLines);
      stats.providersRemoved += removedProviders;
      if (shouldDropWholeEntry) {
        stats.emptyLlmEntriesRemoved++;
        for (let k = 0; k < entry.bodyLines.length; k++) phase2Items.push(REMOVED);
        for (const tl of entry.trailingLines) phase2Items.push(tl);
        continue;
      }
      if (removedProviders > 0) {
        for (const ni of nextItems) phase2Items.push(ni);
        for (const tl of entry.trailingLines) phase2Items.push(tl);
        continue;
      }
    }

    for (const rl of entry.rawLines) phase2Items.push(rl);
  }

  // Phase 3: 无损重建与严格幂等对比
  const finalLines = collapseRemovedSeams(phase2Items);
  const totalRemovals =
    stats.managedBlocksRemoved +
    stats.commentsRemoved +
    stats.pluginEntriesRemoved +
    stats.providersRemoved +
    stats.emptyLlmEntriesRemoved;

  if (totalRemovals === 0) {
    return {
      content,
      changed: false,
      status: 'already_clean',
      stats
    };
  }

  const rebuilt = finalLines.length === 0
    ? ''
    : finalLines.join(eol) + (hadTrailingNewline ? eol : '');

  if (rebuilt === content) {
    return {
      content,
      changed: false,
      status: 'already_clean',
      stats
    };
  }

  return {
    content: rebuilt,
    changed: true,
    status: 'cleaned',
    stats
  };
}

function cleanupPatchContent(content) {
  return cleanWineTokenFromPatchContent(content).content;
}

/**
 * 探测 cordis.patch.yml 中的 WineToken 结构完整性（供启动基线自愈判定使用，替代旧版松散正则）
 */
function inspectPatchState(content) {
  const result = {
    hasLegacyComments: false,
    hasUnpairedMarkers: false,
    hasManagedMarkers: false,
    winetokenPluginCount: 0,
    llmPiAiEntryCount: 0,
    winetokenProviderCount: 0,
    hasEmptyProvidersSkeleton: false,
    winetokenModelCount: 0,
    hasRequiredProviderFields: false,
    isCleanSingleWineToken: false
  };

  if (typeof content !== 'string' || !content.trim()) return result;

  const lines = content.replace(/\r\n/g, '\n').split('\n');
  let openStart = false;
  for (const line of lines) {
    if (LEGACY_HEADER_RE.test(line)) result.hasLegacyComments = true;
    if (MANAGED_START_RE.test(line)) {
      result.hasManagedMarkers = true;
      if (openStart) result.hasUnpairedMarkers = true;
      openStart = true;
    } else if (MANAGED_END_RE.test(line)) {
      result.hasManagedMarkers = true;
      if (!openStart) result.hasUnpairedMarkers = true;
      openStart = false;
    }
  }
  if (openStart) result.hasUnpairedMarkers = true;

  const { entries } = splitTopLevelEntries(lines);
  let lastWinetokenBlockLines = null;

  for (const entry of entries) {
    if (isStandaloneWineTokenPluginEntry(entry.semanticLines)) {
      result.winetokenPluginCount++;
      continue;
    }
    if (isInsertListEntry(entry.semanticLines)) {
      const res = removeWineTokenFromInsertEntry(entry.bodyLines);
      result.winetokenPluginCount += res.removedSubCount;
      continue;
    }
    if (isLlmPiAiEntry(entry.semanticLines)) {
      result.llmPiAiEntryCount++;
      const res = removeWineTokenFromLlmPiAi(entry.bodyLines);
      result.winetokenProviderCount += res.removedProviders;
      if (res.shouldDropWholeEntry && res.removedProviders === 0) {
        result.hasEmptyProvidersSkeleton = true;
      }

      if (res.removedProviders === 1) {
        // 提取该 winetoken 子块以核验模型数量与关键字段
        const body = entry.bodyLines;
        for (let i = 0; i < body.length; i++) {
          if (isSemantic(body[i]) && /^([ \t]+)winetoken:[ \t]*$/i.test(body[i])) {
            const wIndent = indentOf(body[i]);
            const block = [body[i]];
            for (let j = i + 1; j < body.length; j++) {
              if (isSemantic(body[j]) && indentOf(body[j]) <= wIndent) break;
              if (isSemantic(body[j])) block.push(body[j]);
            }
            lastWinetokenBlockLines = block;
            break;
          }
        }
      }
    }
  }

  if (lastWinetokenBlockLines && result.winetokenProviderCount === 1) {
    let hasBaseUrl = false;
    let hasApiKeyEnv = false;
    let inModels = false;
    let modelsIndent = -1;
    let count = 0;
    for (const line of lastWinetokenBlockLines) {
      if (/^[ \t]+baseURL:[ \t]*\S+/.test(line)) hasBaseUrl = true;
      if (/^[ \t]+apiKeyEnv:[ \t]*\S+/.test(line)) hasApiKeyEnv = true;
      if (/^[ \t]+models:[ \t]*$/.test(line)) {
        inModels = true;
        modelsIndent = indentOf(line);
        continue;
      }
      if (inModels) {
        if (indentOf(line) <= modelsIndent) {
          inModels = false;
        } else if (/^[ \t]+-[ \t]+id:[ \t]*\S+/.test(line)) {
          count++;
        }
      }
    }
    result.winetokenModelCount = count;
    result.hasRequiredProviderFields = hasBaseUrl && hasApiKeyEnv;
  }

  result.isCleanSingleWineToken =
    !result.hasLegacyComments &&
    !result.hasUnpairedMarkers &&
    result.winetokenPluginCount === 0 &&
    result.llmPiAiEntryCount === 1 &&
    result.winetokenProviderCount === 1 &&
    !result.hasEmptyProvidersSkeleton &&
    result.winetokenModelCount > 0 &&
    result.hasRequiredProviderFields;

  return result;
}

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

function buildFreshPatchContent(newProviderBlock, eol = '\n') {
  return [
    `${MANAGED_START_PREFIX} (mode=full-entry) >>>`,
    '- id: llm-pi-ai',
    '  name: "@deepseek-ai/dsh-llm-pi-ai"',
    '  config:',
    '    providers:',
    newProviderBlock.replace(/\n/g, eol),
    MANAGED_END_LINE,
    ''
  ].join(eol);
}

function buildManagedProviderBlock(newProviderBlock, indent = '      ', eol = '\n') {
  return [
    `${indent}${MANAGED_START_PREFIX} (mode=provider) >>>`,
    newProviderBlock.replace(/\n/g, eol),
    `${indent}${MANAGED_END_LINE}`
  ].join(eol);
}

/**
 * 将 winetoken provider 增量合并进已有 YAML 字符串（先清后写 + 幂等快路径）
 * 严格保留现有用户的其他 provider (如 zhaizhu) 以及所有原始注释
 */
function mergeProviderIntoPatchContent(content, providerConfig) {
  const pId = providerConfig.id || 'winetoken';
  const newProviderBlock = serializeProviderYaml(providerConfig, '      ');
  const rawContent = typeof content === 'string' ? content : '';
  const eol = rawContent.includes('\r\n') ? '\r\n' : '\n';

  // 幂等快路径：对默认 winetoken 先核验是否已处于干净单一且含 managed 标记的同配置状态
  if (pId.toLowerCase() === 'winetoken' && rawContent.length > 0) {
    const state = inspectPatchState(rawContent);
    const expectedModelCount = Array.isArray(providerConfig.models) ? providerConfig.models.length : 0;
    if (
      state.isCleanSingleWineToken &&
      state.hasManagedMarkers &&
      state.winetokenModelCount === expectedModelCount
    ) {
      const normalizedRaw = rawContent.replace(/\r\n/g, '\n');
      const normalizedBlock = newProviderBlock.replace(/\r\n/g, '\n');
      if (normalizedRaw.includes(normalizedBlock)) {
        return content;
      }
    }
  }

  // 先清后写：仅对默认 winetoken 清理历史残留/重复段/游离插件注释；自定义 pId 保留原有增量行为
  const cleanedContent = pId.toLowerCase() === 'winetoken'
    ? cleanWineTokenFromPatchContent(rawContent).content
    : rawContent;

  const lines = cleanedContent.replace(/\r\n/g, '\n').split('\n');
  const meaningfulLines = lines.filter(line => line.trim().length > 0 && !/^[ \t]*#/.test(line));

  // 若无有效内容，或唯一有效内容为空流式列表 ([] / [ ]，允许行尾内联注释)，按空文档处理
  let result;
  if (
    meaningfulLines.length === 0 ||
    (meaningfulLines.length === 1 && /^[ \t]*\[[ \t]*\](?:[ \t]*#.*)?[ \t]*$/.test(meaningfulLines[0]))
  ) {
    result = buildFreshPatchContent(newProviderBlock, eol);
    return result === rawContent ? content : result;
  }

  // 1. 寻找 llm-pi-ai 补丁项范围
  let llmPatchStartIndex = -1;
  let llmPatchEndIndex = lines.length;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^-[ \t]+id:\s*['"]?llm-pi-ai['"]?/.test(line)) {
      llmPatchStartIndex = i;
      break;
    }
  }

  // 如果根本没有 llm-pi-ai 补丁项，仅当根结构为块级列表 (- ) 时追加带起止标记的整块到文末
  if (llmPatchStartIndex === -1) {
    if (!meaningfulLines[0].startsWith('- ')) {
      console.warn(
        '[WineToken PatchEngine] Unsupported cordis.patch.yml root shape (expected block sequence starting with "- "); patch file was left untouched.'
      );
      return content;
    }

    const appendBlock = [
      '',
      `${MANAGED_START_PREFIX} (mode=full-entry) >>>`,
      '- id: llm-pi-ai',
      '  name: "@deepseek-ai/dsh-llm-pi-ai"',
      '  config:',
      '    providers:',
      newProviderBlock.replace(/\n/g, eol),
      MANAGED_END_LINE,
      ''
    ].join(eol);
    result = cleanedContent.trimEnd() + eol + appendBlock;
    return result === rawContent ? content : result;
  }

  // 计算 llm-pi-ai 的结束边界 (下一个顶层列表项 - )
  for (let i = llmPatchStartIndex + 1; i < lines.length; i++) {
    if (isTopLevelEntryStart(lines[i])) {
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

  const managedProviderBlock = pId.toLowerCase() === 'winetoken'
    ? buildManagedProviderBlock(newProviderBlock, '      ', eol)
    : newProviderBlock.replace(/\n/g, eol);

  // 如果没有 config: 节点
  if (configLineIndex === -1 && providersLineIndex === -1) {
    lines.splice(llmPatchStartIndex + 1, 0, '  config:', '    providers:', managedProviderBlock);
    result = lines.join(eol);
    return result === rawContent ? content : result;
  }

  // 如果有 config: 但没有 providers: 节点
  if (providersLineIndex === -1) {
    lines.splice(configLineIndex + 1, 0, '    providers:', managedProviderBlock);
    result = lines.join(eol);
    return result === rawContent ? content : result;
  }

  // 3. 在 providers: 内部寻找是否存在目标 provider
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
    const existingBlock = lines.slice(targetProviderStart, targetProviderEnd).join('\n');
    if (existingBlock.trim() === newProviderBlock.trim()) {
      return content;
    }
    lines.splice(targetProviderStart, targetProviderEnd - targetProviderStart, managedProviderBlock);
    result = lines.join(eol);
    return result === rawContent ? content : result;
  }

  // 不存在目标 provider，直接在 providers: 下插入带起止标记的子块
  lines.splice(providersLineIndex + 1, 0, managedProviderBlock);
  result = lines.join(eol);
  return result === rawContent ? content : result;
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
    { id: 'glm-5.4', name: 'GLM-5.4', contextWindow: 1048576, maxTokens: 131072, input: ['text'], reasoningEfforts: { low: 'low', medium: 'medium', high: 'high' } },
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
  MANAGED_START_PREFIX,
  MANAGED_END_LINE,
  LEGACY_HEADER_COMMENT,
  isPluginOwnedCommentLine,
  cleanWineTokenFromPatchContent,
  cleanupPatchContent,
  inspectPatchState,
  sanitizeModelDisplayName,
  serializeProviderYaml,
  mergeProviderIntoPatchContent,
  getBaselineModels
};
