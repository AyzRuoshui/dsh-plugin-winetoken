// -*- coding: utf-8 -*-
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  LIBTV_PRESETS,
  DERIVED_ACTION_PRESETS,
  CANVAS_TAGS,
  getLibtvPresets,
  getLibtvPreset,
  applyPreset,
  getDerivedActionPresets,
  getDerivedAction,
  buildDerivedPrompt
} = require('../src/canvas-prompts.js');

const {
  calculateImagePrice,
  calculateVideoPrice,
  formatPriceBadge
} = require('../src/canvas-pricing.js');

const {
  listNodes,
  buildGenerationContext
} = require('../src/canvas-nodes.js');

const {
  AssetLibraryStore,
  ASSET_CATEGORIES
} = require('../src/canvas-assets.js');

function makeTmpDir(tag) {
  const dir = path.join(__dirname, '..', '.tmp', `test_libtv_${tag}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanupDir(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}

test('LibTV Presets - 16 个专业预设全量覆盖且四分类完整 (无 Emoji)', () => {
  assert.equal(LIBTV_PRESETS.length, 16, '必须恰好包含 16 个预设');
  const categories = new Set(LIBTV_PRESETS.map(p => p.category));
  assert.deepEqual(Array.from(categories).sort(), ['分镜叙事', '空间与机位', '设定图', '质感调节'].sort());

  // 逐项验证 16 个预设的 id、名称与非空 prompt
  const expectedIds = [
    'dispatch_board', 'storyboard', 'grid_25', 'grid_4_drama', 'prequel_3s', 'prequel_5s',
    'panorama_720', 'grid_9_angles',
    'character_dna', 'turnaround_3view', 'face_3view', 'character_sheet', 'scene_sheet', 'product_sheet',
    'portrait_texture', 'cinematic_grade'
  ];
  const actualIds = LIBTV_PRESETS.map(p => p.id);
  assert.deepEqual(actualIds, expectedIds);

  LIBTV_PRESETS.forEach(p => {
    assert.ok(p.name && typeof p.name === 'string');
    assert.ok(p.prompt && typeof p.prompt === 'string');
    // 零 Emoji 契约
    assert.doesNotMatch(p.name, /[\uD83C-\uDBFF\uDC00-\uDFFF]/, '预设名称不得包含 Emoji');
    assert.doesNotMatch(p.prompt, /[\uD83C-\uDBFF\uDC00-\uDFFF]/, '预设内容不得包含 Emoji');
  });

  // 测试 getLibtvPreset
  assert.equal(getLibtvPreset('grid_25').name, '25宫格连贯分镜');
  assert.equal(getLibtvPreset('non_existent'), null);
});

test('LibTV Presets - applyPreset 提示词与比例联动套用', () => {
  const applied = applyPreset('主角站在雨中', 'grid_25');
  assert.equal(applied.applied, true);
  assert.equal(applied.aspectRatio, '16:9');
  assert.match(applied.prompt, /^主角站在雨中，25宫格连贯电影分镜/);

  const appliedEmpty = applyPreset('', 'grid_4_drama');
  assert.equal(appliedEmpty.applied, true);
  assert.equal(appliedEmpty.aspectRatio, '1:1');
  assert.match(appliedEmpty.prompt, /^四宫格剧情推演/);

  const fallback = applyPreset('原有词', 'unknown_id');
  assert.equal(fallback.applied, false);
  assert.equal(fallback.prompt, '原有词');
  assert.equal(fallback.aspectRatio, null);
});

test('LibTV Post-processing - S4 派生后处理预设与提示词合成', () => {
  assert.equal(DERIVED_ACTION_PRESETS.length, 6);
  const ids = DERIVED_ACTION_PRESETS.map(a => a.id);
  assert.deepEqual(ids, ['hd', 'repaint', 'panorama', 'multi_angle', 'relight', 'layer_split']);

  const hdPrompt = buildDerivedPrompt('赛博朋克雨夜长街', 'hd');
  assert.match(hdPrompt, /赛博朋克雨夜长街，8K超清重制/);
  assert.equal(buildDerivedPrompt('基础词', 'missing_action'), '基础词');
});

test('LibTV Tags - S3 画布彩色标签规格 (七色标签无 Emoji)', () => {
  assert.equal(CANVAS_TAGS.length, 7);
  const labels = CANVAS_TAGS.map(t => t.label);
  assert.deepEqual(labels, ['道具', '音色', '场景', '服装', '人物', '最终版', '待定版']);
  CANVAS_TAGS.forEach(t => {
    assert.match(t.color, /^#[0-9a-fA-F]{6}$/);
    assert.doesNotMatch(t.label, /[\uD83C-\uDBFF\uDC00-\uDFFF]/);
  });
});

test('CanvasPricing - 生图明码标价：限免、原价、VIP 折扣、多张计价', () => {
  const freeModel = { id: 'sensenova-u1.5-lite', price: 0, tag: '限免4K' };
  const paidModel = { id: 'gpt-image-2.6-flare', price: 0.30, vipPrice: 0.24, tag: '超快极速' };
  const noVipFieldModel = { id: 'custom-model', price: 1.00 };

  // 限免模型
  const rFree = calculateImagePrice(freeModel);
  assert.equal(rFree.isFree, true);
  assert.equal(rFree.totalPrice, 0);
  assert.equal(rFree.priceText, '限免 ¥0.00');
  assert.equal(formatPriceBadge(rFree.priceText), '[限免 ¥0.00]');

  // 普通用户原价
  const rPaid = calculateImagePrice(paidModel, { count: 2 });
  assert.equal(rPaid.isFree, false);
  assert.equal(rPaid.unitPrice, 0.30);
  assert.equal(rPaid.totalPrice, 0.60);
  assert.equal(rPaid.priceText, '¥0.60');
  assert.equal(formatPriceBadge(rPaid.priceText), '[¥0.60]');

  // SVIP / SUPER 用户享受 vipPrice (0.24)
  const rSvip = calculateImagePrice(paidModel, { count: 1, isSvip: true });
  assert.equal(rSvip.unitPrice, 0.24);
  assert.equal(rSvip.totalPrice, 0.24);

  // VIP 用户无 vipPrice 时享受 9 折 (1.00 * 0.9 = 0.90)
  const rVip = calculateImagePrice(noVipFieldModel, { count: 1, isVip: true });
  assert.equal(rVip.unitPrice, 0.90);
  assert.equal(rVip.totalPrice, 0.90);

  // VIP 用户有 vipPrice（8 折价）时仍按 9 折算，不能拿 8 折价显示 (0.30 * 0.9 = 0.27)
  const rVipWithField = calculateImagePrice(paidModel, { count: 1, isVip: true });
  assert.equal(rVipWithField.unitPrice, 0.27);
  assert.equal(rVipWithField.totalPrice, 0.27);

  // 脏输入/无价格模型：返回空，绝不臆造数字
  const rMissing = calculateImagePrice({ id: 'unknown-model' });
  assert.equal(rMissing.priceText, '');
  assert.equal(rMissing.totalPrice, null);
  assert.equal(calculateImagePrice(null).available, false);
});

test('CanvasPricing - 视频明码标价：时长联动、单秒单价、VIP 费率', () => {
  const videoModel = {
    id: 'MiniMax-H3',
    pricePerSecond: 0.15,
    vipPricePerSecond: 0.12,
    tag: '电影感'
  };

  // 普通用户 5 秒基准: 5 * 0.15 = 0.75
  const rNormal = calculateVideoPrice(videoModel, { duration: 5 });
  assert.equal(rNormal.isFree, false);
  assert.equal(rNormal.totalPrice, 0.75);
  assert.equal(rNormal.priceText, '¥0.75');
  assert.equal(formatPriceBadge(rNormal.priceText), '[¥0.75]');

  // VIP 10 秒: 9 折 10 * (0.15 * 0.9) = 1.35（vipPricePerSecond 0.12 是 8 折价，VIP 不能用）
  const rVip = calculateVideoPrice(videoModel, { duration: 10, isVip: true });
  assert.equal(rVip.totalPrice, 1.35);
  assert.equal(rVip.priceText, '¥1.35');

  // SVIP 10 秒: 8 折 10 * 0.12 = 1.20
  const rSvip = calculateVideoPrice(videoModel, { duration: 10, isSvip: true });
  assert.equal(rSvip.totalPrice, 1.20);
  assert.equal(rSvip.priceText, '¥1.20');

  // 脏模型返回空
  assert.equal(calculateVideoPrice(null).available, false);
  assert.equal(calculateVideoPrice({}).priceText, '');
});

test('CanvasNodes - 连线驱动生成输入：视频节点汇入多图自动成为「全能参考」', () => {
  const project = {
    canvasItems: [
      { id: 'img1', type: 'image', data: { url: 'http://assets/1.png', prompt: '主角正面' } },
      { id: 'img2', type: 'image', data: { url: 'http://assets/2.png', prompt: '背景长街' } },
      { id: 'txt1', type: 'text', data: { text: '夜色渐浓，雨丝飘落' } },
      { id: 'vid1', type: 'video', data: { prompt: '运镜推进' } }
    ],
    edges: [
      { id: 'e1', from: { type: 'item', id: 'img1' }, to: { type: 'item', id: 'vid1' } },
      { id: 'e2', from: { type: 'item', id: 'img2' }, to: { type: 'item', id: 'vid1' } },
      { id: 'e3', from: { type: 'item', id: 'txt1' }, to: { type: 'item', id: 'vid1' } }
    ]
  };

  const ctx = buildGenerationContext(project, 'vid1');
  assert.equal(ctx.mode, 'multi_reference', '多图汇入视频节点必须自动标记为全能参考 multi_reference');
  assert.equal(ctx.multiReferenceCount, 2);
  assert.equal(ctx.firstFrameUrl, 'http://assets/1.png');
  assert.equal(ctx.lastFrameUrl, 'http://assets/2.png');
  assert.deepEqual(ctx.allReferenceImages, ['http://assets/1.png', 'http://assets/2.png']);
  assert.match(ctx.prompt, /运镜推进/);
  assert.match(ctx.prompt, /夜色渐浓，雨丝飘落/);
});

test('AssetLibraryStore - S1/S2 资产库生命周期、分类搜索与物理回读强校验', () => {
  const dir = makeTmpDir('asset_lib');
  try {
    const store = new AssetLibraryStore(dir);
    assert.deepEqual(ASSET_CATEGORIES, ['全部', '角色', '场景', '道具', '自定义']);

    // 初始空库
    assert.deepEqual(store.loadLibrary().items, []);

    // 添加资产
    const item1 = store.addItem({
      assetKey: 'hero_pose.png',
      name: '主角正面立绘',
      category: '角色',
      description: '主角高清设定',
      tags: ['主角', '立绘']
    });
    assert.equal(item1.name, '主角正面立绘');
    assert.equal(item1.category, '角色');
    assert.equal(item1.usageCount, 0);

    const item2 = store.addItem({
      assetKey: 'street_night.png',
      name: '雨夜长街背景',
      category: '场景',
      description: '赛博朋克长街',
      tags: ['场景', '夜景']
    });

    // 物理回读强校验验证：落盘文件存在且内容一致
    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'winetoken_asset_library.json'), 'utf8'));
    assert.equal(onDisk.items.length, 2);

    // 调入画布时使用计数递增 (S1)
    const count = store.incrementUsage(item1.id);
    assert.equal(count, 1);
    const count2 = store.incrementUsage(item1.id);
    assert.equal(count2, 2);

    // 搜索与分类筛选
    const roleItems = store.searchItems({ category: '角色' });
    assert.equal(roleItems.length, 1);
    assert.equal(roleItems[0].name, '主角正面立绘');

    const sceneItems = store.searchItems({ category: '场景' });
    assert.equal(sceneItems.length, 1);
    assert.equal(sceneItems[0].name, '雨夜长街背景');

    const queryResults = store.searchItems({ query: '赛博朋克' });
    assert.equal(queryResults.length, 1);
    assert.equal(queryResults[0].id, item2.id);

    // 重命名与分类修改 (S2)
    const updated = store.updateItem(item1.id, { name: 'C_P01_主角改版.png', category: '角色' });
    assert.equal(updated.name, 'C_P01_主角改版.png');

    // 删除资产
    assert.equal(store.removeItem(item2.id), true);
    assert.equal(store.loadLibrary().items.length, 1);

    // 破坏性契约测试：物理回读篡改必须真实抛错
    const originalRead = fs.readFileSync;
    fs.readFileSync = function (filePath, ...args) {
      if (typeof filePath === 'string' && filePath.endsWith('winetoken_asset_library.json')) {
        return '{"version":1,"items":["TAMPERED"]}';
      }
      return originalRead.call(fs, filePath, ...args);
    };
    try {
      assert.throws(() => store.addItem({ assetKey: 'tamper.png' }), /回读内容与写入不一致/);
    } finally {
      fs.readFileSync = originalRead;
    }
  } finally {
    cleanupDir(dir);
  }
});
