// -*- coding: utf-8 -*-
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  LIBRARY_VERSION,
  MAX_ITEMS,
  MAX_TEXT,
  normalizeLibrary,
  addPrompt,
  removePrompt,
  searchPrompts,
  buildExport,
  parseImport
} = require('../src/canvas-prompts.js');

test('CanvasPrompts - 归一化: 去重 / 限量 / 剔除脏条目 / 字段补默认', () => {
  const lib = normalizeLibrary([
    { id: 'a', text: '雨夜长街', title: '雨夜', tags: ['氛围', '氛围'] },
    { id: 'b', text: '雨夜长街', title: '重复' },
    null, 'junk', {}, 42,
    { text: '无标题条目' }
  ]);
  assert.equal(lib.version, LIBRARY_VERSION);
  assert.equal(lib.items.length, 2);
  assert.equal(lib.items[0].text, '雨夜长街');
  assert.deepEqual(lib.items[0].tags, ['氛围']);
  assert.equal(lib.items[1].title, '无标题条目');
  assert.deepEqual(normalizeLibrary(null).items, []);
  assert.deepEqual(normalizeLibrary({ items: [{ text: '嵌套' }] }).items[0].text, '嵌套');
});

test('CanvasPrompts - addPrompt 新增 / 重复拒绝 / 空文本拒绝 / 上限拒绝', () => {
  let r = addPrompt({}, { text: '  雨夜长街  ', title: '雨夜', tags: ['氛围'] });
  assert.equal(r.added, true);
  assert.equal(r.item.text, '雨夜长街');
  const dup = addPrompt(r.library, { text: '雨夜长街' });
  assert.equal(dup.added, false);
  assert.match(dup.reason, /已在库/);
  assert.equal(dup.library.items.length, 1);
  assert.equal(addPrompt({}, { text: '  ' }).added, false);
  assert.equal(addPrompt({}, { text: 123 }).added, false);

  const full = { items: Array.from({ length: MAX_ITEMS }, (_, i) => ({ id: 'p' + i, text: '提示' + i })) };
  const capped = addPrompt(full, { text: '再来一条' });
  assert.equal(capped.added, false);
  assert.match(capped.reason, /上限/);
});

test('CanvasPrompts - removePrompt 按 id 删除且不误删其他条目', () => {
  const lib = normalizeLibrary([{ id: 'a', text: '甲' }, { id: 'b', text: '乙' }]);
  const r = removePrompt(lib, 'a');
  assert.equal(r.removed, true);
  assert.deepEqual(r.library.items.map(i => i.text), ['乙']);
  assert.equal(removePrompt(lib, 'ghost').removed, false);
});

test('CanvasPrompts - searchPrompts 匹配 text/title/tags 且大小写不敏感', () => {
  const lib = normalizeLibrary([
    { id: 'a', text: 'RAINY street', title: '雨夜', tags: ['氛围'] },
    { id: 'b', text: '赛博都市', title: '霓虹', tags: ['科幻'] }
  ]);
  assert.equal(searchPrompts(lib, 'rain').length, 1);
  assert.equal(searchPrompts(lib, '雨夜').length, 1);
  assert.equal(searchPrompts(lib, '科幻').length, 1);
  assert.equal(searchPrompts(lib, '不存在').length, 0);
  assert.equal(searchPrompts(lib, '').length, 2, '空查询返回全量');
});

test('CanvasPrompts - 导出/导入往返一致且去重合并', () => {
  const lib = normalizeLibrary([{ id: 'a', text: '甲' }, { id: 'b', text: '乙' }]);
  const exp = buildExport(lib);
  assert.equal(exp.app, 'winetoken-canvas-prompts');
  assert.equal(exp.version, LIBRARY_VERSION);
  assert.equal(exp.items.length, 2);
  const obj = parseImport(exp, { items: [{ id: 'x', text: '甲' }] });
  assert.equal(obj.ok, true);
  assert.equal(obj.added, 1, '已有文本应去重');
  assert.equal(obj.library.items.length, 2);
  const json = parseImport(JSON.stringify(exp), {});
  assert.equal(json.ok, true);
  assert.equal(json.added, 2);
});

test('CanvasPrompts - 破坏性契约: 错误 app / 版本 / 结构 / 非法 JSON 全部拒绝', () => {
  const cases = [
    [{ app: 'evil', version: 1, items: [] }, /来源标识/],
    [{ app: 'winetoken-canvas-prompts', version: 999, items: [] }, /版本不兼容/],
    [{ app: 'winetoken-canvas-prompts', version: 1, items: null }, /缺少 items/],
    ['{broken', /不是合法 JSON/],
    [null, /根节点必须是对象/],
    [[1, 2], /根节点必须是对象/]
  ];
  for (const [input, pattern] of cases) {
    const r = parseImport(input, {});
    assert.equal(r.ok, false);
    assert.match(r.error, pattern);
  }
});

test('CanvasPrompts - 破坏性契约: 原型污染载荷被拦截且超长文本被截断', () => {
  const payload = JSON.parse('{"app":"winetoken-canvas-prompts","version":1,"items":[{"text":"正常","__proto__":{"polluted":true}},{"text":"' + '长'.repeat(5000) + '"},{"text":""},null]}');
  const r = parseImport(payload, {});
  assert.equal(r.ok, true);
  assert.equal(({}).polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(r.library.items.length, 2, '空白条目被剔除');
  assert.ok(r.library.items.every(it => it.text.length <= MAX_TEXT));
  assert.ok(r.warnings.some(w => w.includes('剔除')));
});
