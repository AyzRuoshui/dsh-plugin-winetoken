// -*- coding: utf-8 -*-
/**
 * 阶段三联动契约测试: 宿主工具桥 / 视频状态机 / 提示词库 三者在脏环境下的端到端数据流。
 * 全部本地临时目录，不访问网络、不写源码目录、不启动真实宿主。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { CanvasStateBridge } = require('../src/canvas-state.js');
const Video = require('../src/canvas-video.js');
const Prompts = require('../src/canvas-prompts.js');
const { CanvasAssets } = require('../src/canvas-assets.js');

function makeDir(tag) {
  const dir = path.join(__dirname, '..', '.tmp', 'test_stage3_' + tag + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}

function seed(dir) {
  const projectsDir = path.join(dir, 'winetoken_projects');
  fs.mkdirSync(projectsDir, { recursive: true });
  fs.writeFileSync(path.join(projectsDir, 'index.json'), JSON.stringify({
    version: 1, activeId: 'proj_1', projects: [{ id: 'proj_1', name: '工程一', createdAt: 1, updatedAt: 1 }], deleted: []
  }, null, 2), 'utf8');
  fs.writeFileSync(path.join(projectsDir, 'proj_1.json'), JSON.stringify({
    version: '2.3.0',
    characters: [{ id: 'c1', name: '楚云' }],
    panels: [{ id: 'p1', num: 1, x: 360, y: 60, prompt: '雨夜长街', characterId: 'c1' }],
    canvasItems: [
      { id: 'im1', type: 'image', x: 700, y: 60, data: { url: 'asset:frame.png' } },
      { id: 'v1', type: 'video', x: 700, y: 400, data: { prompt: '推镜', videoState: Video.createVideoNodeState() } }
    ],
    edges: [{ id: 'e1', from: { type: 'item', id: 'im1' }, to: { type: 'item', id: 'v1' } }],
    groups: [], viewport: { x: 40, y: 30, zoom: 1 }, activeModel: 'model-a'
  }, null, 2), 'utf8');
  return projectsDir;
}

test('Stage3 - 工具追加分镜后故事板可再读，提示词可收藏复用', () => {
  const dir = makeDir('flow');
  try {
    seed(dir);
    const bridge = new CanvasStateBridge(dir);
    const before = bridge.getStoryboard();
    assert.equal(before.totalPanels, 1);

    const added = bridge.addPanel({ prompt: '追加的反转镜头', dialogue: '原来是你', shot: 'FS' });
    assert.equal(added.panel.num, 2);
    assert.equal(added.panel.prompt, '追加的反转镜头');

    const after = bridge.getStoryboard();
    assert.equal(after.totalPanels, 2);
    assert.equal(after.panels[1].prompt, '追加的反转镜头');
    assert.equal(after.panels[1].shot, 'FS');

    // 把追加分镜的提示词收藏进提示词库，再搜索复用
    let lib = Prompts.normalizeLibrary({});
    const collected = Prompts.addPrompt(lib, { text: after.panels[1].prompt, tags: ['分镜'] });
    assert.equal(collected.added, true);
    lib = collected.library;
    assert.equal(Prompts.searchPrompts(lib, '反转').length, 1);
    assert.equal(Prompts.addPrompt(lib, { text: after.panels[1].prompt }).added, false, '重复收藏应拒绝');
  } finally { cleanup(dir); }
});

test('Stage3 - 视频节点首帧来自上游 asset 引用，生成 payload 与轮询状态机闭环', () => {
  const dir = makeDir('video');
  try {
    const projectsDir = seed(dir);
    const assetsDir = path.join(dir, 'assets');
    const assets = new CanvasAssets(assetsDir);
    // 落一张合法 PNG 资产，模拟上游图片节点
    const png = 'data:image/png;base64,' + Buffer.from('frame-payload').toString('base64');
    const saved = assets.saveDataUrl(png);

    const project = JSON.parse(fs.readFileSync(path.join(projectsDir, 'proj_1.json'), 'utf8'));
    const imageItem = project.canvasItems.find(i => i.id === 'im1');
    imageItem.data.assetKey = saved.assetKey;
    imageItem.data.url = `asset:${saved.assetKey}`;
    fs.writeFileSync(path.join(projectsDir, 'proj_1.json'), JSON.stringify(project, null, 2), 'utf8');

    const { buildGenerationContext } = require('../src/canvas-nodes.js');
    const ctx = buildGenerationContext(project, 'v1');
    assert.deepEqual(ctx.referenceImages, [`asset:${saved.assetKey}`]);
    const firstFrame = assets.readAsDataUrl(saved.assetKey);
    assert.ok(firstFrame.startsWith('data:image/png;base64,'));

    const payload = Video.buildVideoPayload({
      model: 'MiniMax-H3', prompt: '推镜', duration: 5, size: '1280x720', firstFrameUrl: firstFrame
    });
    assert.equal(payload.image, firstFrame);
    assert.equal(payload.metadata.first_frame_image, firstFrame);
    assert.equal(payload.seconds, 5);

    // 状态机: 提交 -> 轮询 -> 成功
    const submit = Video.parseSubmitResponse({ task_id: 'task_9' });
    assert.equal(submit.taskId, 'task_9');
    let state = Video.createVideoNodeState();
    state = Video.applyVideoState(state, { status: 'polling', taskId: submit.taskId });
    assert.equal(Video.isBusy(state), true);
    const reduced = Video.reducePollResponse({ status: 'succeeded', url: 'https://v/out.mp4' }, 3);
    assert.equal(reduced.done, true);
    assert.equal(reduced.videoUrl, 'https://v/out.mp4');
    state = Video.applyVideoState(state, { status: reduced.status, videoUrl: reduced.videoUrl });
    assert.equal(Video.isTerminal(state), true);
    assert.equal(state.videoUrl, 'https://v/out.mp4');
  } finally { cleanup(dir); }
});

test('Stage3 - 工具排队生成不发包，WAL 存根可被渲染进程任务队列读取', () => {
  const dir = makeDir('wal');
  try {
    seed(dir);
    const bridge = new CanvasStateBridge(dir);
    const originalFetch = global.fetch;
    let calls = 0;
    global.fetch = () => { calls++; return Promise.reject(new Error('宿主工具不应发包')); };
    let queued;
    try {
      queued = bridge.enqueueGeneration({ panelId: 'p1', prompt: '雨夜长街', kind: 'image' });
    } finally { global.fetch = originalFetch; }
    assert.equal(calls, 0);
    assert.equal(queued.status, 'queued');

    // CanvasJobQueue 读取的是同一份 winetoken_canvas_tasks.json 结构
    const { CanvasJobQueue } = require('../src/canvas-job-queue.js');
    const queue = new CanvasJobQueue(dir);
    const pending = queue.getPendingJobs();
    assert.ok(pending.some(j => j.id === queued.taskId), 'WAL 存根必须能被渲染进程队列发现');
    const job = queue.getJob(queued.taskId);
    assert.equal(job.status, 'pending');
    assert.equal(job.prompt, '雨夜长街');
  } finally { cleanup(dir); }
});

test('Stage3 - 提示词库导出/导入与工程导出清单互不混淆 (不同 app 标识)', () => {
  const lib = Prompts.normalizeLibrary([{ id: 'a', text: '电影感光影' }]);
  const promptExport = Prompts.buildExport(lib);
  const { buildExportManifest } = require('../src/canvas-export.js');
  const projectExport = buildExportManifest({ panels: [{ id: 'p1', prompt: '电影感光影' }] }, 1);
  assert.notEqual(promptExport.app, projectExport.app);
  // 工程清单误喂给提示词库导入必须被拒绝
  const wrong = Prompts.parseImport(projectExport, {});
  assert.equal(wrong.ok, false);
  assert.match(wrong.error, /来源标识/);
  // 提示词清单误喂给工程导入同样被拒绝
  const { parseImportManifest } = require('../src/canvas-export.js');
  assert.equal(parseImportManifest(JSON.stringify(promptExport)).ok, false);
});
