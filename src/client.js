/**
 * WineToken DSH Client Module (v2.2.0)
 * 1. 消除鼠标悬停余额按钮上的原生提示浮层 (Zero-Distraction Tooltip Removal)
 *    - 移除底部状态栏与工坊顶栏余额按钮原生 title 提示，呈现极简纯净的交互体验
 * 2. 订阅限时额度与钱包永久余额双账轨分离 (Dual-Track Balance Engine)
 *    - 底层接入 Tokyo VPS 高精度只读接口 (/api/subscription/status)
 *    - 严格将「套餐周期内限时额度」与「钱包永久资产」彻底解耦，永不混淆
 *    - 消除自然月历史流水硬算导致的 77% 错误，真实呈现套餐当前已用量 (0%)
 * 3. 彻底去 Emoji 纯矢量极简工程美学 (Zero-Emoji Minimalist Aesthetics)
 *    - 界面 100% 废除任何彩色 Emoji 表情符号，对齐 Linear / Raycast 沉浸式质感
 *    - 全量采用 16px/18px 纯单色极细线条 SVG 矢量图标 (crown, wallet, clock, barChart, refresh, keyIcon 等)
 * 4. 方案 C 全链路黑白自适应 (Light / Dark Mode Native Alignment)
 *    - 顶栏、模式切换、参数控制台、成果展台、艺术画框、历史展台、账户中心全链路自适应
 * 5. 原生账户中心与防闪烁持久化 (WineTokenAccountPopover & Cache V3)
 *    - 底部状态栏胶囊与工坊顶栏一键弹出原生自适应账户卡片
 *    - Key 安全脱敏、一键复制、内嵌输入框换 Key、即时校验保存与一键重置
 *    - 冷启动 0 秒恢复历史真实余额，告别初始 "--" 白屏闪烁
 */

(function () {
  const DEFAULT_KEY = "";
  const BASE_URL = "https://www.winetoken.asia";
  const CACHE_KEY = "WINETOKEN_BILLING_CACHE_V3";

  // 顶层全局内存单例保活 (CANVAS-01, CANVAS-02 跨卸载水合保活)
  if (typeof window !== 'undefined') {
    window.__WINETOKEN_CANVAS_MEMORY_STORE__ = window.__WINETOKEN_CANVAS_MEMORY_STORE__ || {
      characters: null,
      panels: null,
      viewport: null,
      activeModel: null
    };
  }

  // 引入并挂载独立持久化存储驱动、WAL任务队列、几何计算与命令模式历史栈
  // 对标 infinite-canvas: 多工程注册表 / 小地图几何 / 统一节点视图 / 工程导入导出 / 本地资产库
  let CanvasProjectStorageClass = null;
  let CanvasJobQueueSingleton = null;
  let CanvasMathUtils = null;
  let CanvasHistoryManagerClass = null;
  let CanvasProjectStoreClass = null;
  let CanvasMiniMapUtils = null;
  let CanvasNodeUtils = null;
  let CanvasExportUtils = null;
  let CanvasAssetsClass = null;
  let CanvasVideoUtils = null;
  let CanvasPromptUtils = null;
  try {
    const storageMod = require('./canvas-storage.js');
    CanvasProjectStorageClass = storageMod.CanvasProjectStorage;
  } catch (_) {}
  try {
    const queueMod = require('./canvas-job-queue.js');
    CanvasJobQueueSingleton = queueMod.canvasJobQueue;
  } catch (_) {}
  try {
    CanvasMathUtils = require('./canvas-math.js');
  } catch (_) {}
  try {
    const histMod = require('./canvas-history.js');
    CanvasHistoryManagerClass = histMod.CanvasHistoryManager;
  } catch (_) {}
  try {
    CanvasProjectStoreClass = require('./canvas-project-store.js').CanvasProjectStore;
  } catch (_) {}
  try {
    CanvasMiniMapUtils = require('./canvas-minimap.js');
  } catch (_) {}
  try {
    CanvasNodeUtils = require('./canvas-nodes.js');
  } catch (_) {}
  try {
    CanvasExportUtils = require('./canvas-export.js');
  } catch (_) {}
  try {
    CanvasAssetsClass = require('./canvas-assets.js').CanvasAssets;
  } catch (_) {}
  try {
    CanvasVideoUtils = require('./canvas-video.js');
  } catch (_) {}
  try {
    CanvasPromptUtils = require('./canvas-prompts.js');
  } catch (_) {}
  let CanvasPricingUtils = null;
  let AssetLibraryStoreClass = null;
  try {
    CanvasPricingUtils = require('./canvas-pricing.js');
  } catch (_) {}
  try {
    AssetLibraryStoreClass = require('./canvas-assets.js').AssetLibraryStore;
  } catch (_) {}

  const canvasStorageDriver = CanvasProjectStorageClass ? new CanvasProjectStorageClass() : null;
  const canvasHistoryManager = CanvasHistoryManagerClass ? new CanvasHistoryManagerClass(30) : null;
  const canvasProjectStore = CanvasProjectStoreClass ? new CanvasProjectStoreClass() : null;
  const canvasAssetsDriver = CanvasAssetsClass ? new CanvasAssetsClass() : null;
  const assetLibraryStore = AssetLibraryStoreClass ? new AssetLibraryStoreClass() : null;

  /**
   * WineToken 跨进程凭据同步中枢 (WineTokenCredentialBridge)
   * 双向打通渲染进程 localStorage 与 DSH 宿主微内核 ~/.dsh/.credentials.yaml
   * 实现一处填写，官方对话模型与工坊生图全链路即时自动生效 (100ms 热重载)
   */
  const WineTokenCredentialBridge = {
    getCredentialsPath() {
      try {
        const nodeRequire = typeof require === 'function' ? require
          : (typeof window !== 'undefined' && window && typeof window.require === 'function' ? window.require : null);
        if (!nodeRequire) return '';
        const path = nodeRequire('path');
        const os = nodeRequire('os');
        return path.join(os.homedir(), '.dsh', '.credentials.yaml');
      } catch (_) {
        return '';
      }
    },

    // 双轨读取：优先 localStorage，兜底 .credentials.yaml 与 process.env (多别名兼容 WINETOKEN_API_KEY / ZHAIZHU_API_KEY)
    readKey() {
      let key = '';
      // 1. 优先读取渲染进程 localStorage
      try {
        if (typeof localStorage !== 'undefined') {
          const local = localStorage.getItem('WINETOKEN_API_KEY') || localStorage.getItem('ZHAIZHU_API_KEY');
          if (local && local.trim()) key = local.trim();
        }
      } catch (_) {}

      // 2. 若 localStorage 为空，回退读取宿主 ~/.dsh/.credentials.yaml (按优先级探测别名)
      if (!key) {
        try {
          const fs = require('fs');
          const credPath = this.getCredentialsPath();
          if (credPath && fs.existsSync(credPath)) {
            const content = fs.readFileSync(credPath, 'utf8');
            const m = content.match(/(?:^|\n)\s*(WINETOKEN_API_KEY|ZHAIZHU_API_KEY):\s*([^\r\n#]+)/);
            if (m && m[2]) {
              const fileKey = m[2].trim().replace(/^['"]|['"]$/g, '');
              if (fileKey) {
                key = fileKey;
                // 自动反向同步至 localStorage，保障工坊生图即时可用
                try {
                  localStorage.setItem('WINETOKEN_API_KEY', key);
                } catch (_) {}
              }
            }
          }
        } catch (_) {}
      }

      // 3. 环境变量兜底
      if (!key && typeof process !== 'undefined' && process.env) {
        const envKey = process.env.WINETOKEN_API_KEY || process.env.ZHAIZHU_API_KEY;
        if (envKey && envKey.trim()) {
          key = envKey.trim();
        }
      }
      return key;
    },

    // 全链路即时同步写入 (双向别名同步、严格回读验证与基线模型自愈注入)
    // 写入通道优先级：① DSH 官方 credentials Remote 服务 (沙箱版唯一正解) ② 直写磁盘 (旧版 Node 集成)
    // ③ 仅 localStorage 降级 —— 绝不让保存整体失败
    async saveKey(key) {
      const trimmed = (key || '').trim();
      if (!trimmed) return { success: false, error: 'Key 不能为空' };

      // 1. 写入渲染进程 localStorage (创作工坊与漫剧画布 0 秒生效)
      let localSaved = false;
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('WINETOKEN_API_KEY', trimmed);
          localSaved = true;
        }
      } catch (_) {}

      // 2. 写入当前进程环境变量 (非沙箱 Electron 渲染进程可用)
      if (typeof process !== 'undefined' && process.env) {
        try { process.env.WINETOKEN_API_KEY = trimmed; } catch (_) {}
      }

      // 3a. DSH 官方 credentials Remote 通道 (ctx.remote.credentials.set，宿主 local provider 落盘)
      let remoteSaved = false;
      let remoteError = '';
      try {
        const credFace = (typeof window !== 'undefined' && window) ? window.__winetoken_remote_credentials : null;
        if (credFace && typeof credFace.set === 'function') {
          await credFace.set('WINETOKEN_API_KEY', trimmed);
          remoteSaved = true;
        }
      } catch (e) {
        remoteError = (e && e.message) ? e.message : String(e);
        console.warn('[WineToken] 官方凭据通道写入失败:', remoteError);
      }

      // 3b. 直写磁盘 ~/.dsh/.credentials.yaml (旧版桌面端 / Node 集成可用时)
      const nodeRequire = typeof require === 'function' ? require
        : (typeof window !== 'undefined' && window && typeof window.require === 'function' ? window.require : null);
      let fsWriteSuccess = false;
      let fsErrorMessage = '';
      if (!remoteSaved && nodeRequire) {
        try {
          const fs = nodeRequire('fs');
          const path = nodeRequire('path');
          const credPath = this.getCredentialsPath();
          if (credPath) {
            const dir = path.dirname(credPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

            let content = fs.existsSync(credPath) ? fs.readFileSync(credPath, 'utf8') : '';
            const hasZhaizhu = /(?:^|\n)[ \t]*ZHAIZHU_API_KEY:\s*/.test(content);

            const writeOneKey = (rawContent, keyName, val) => {
              const keyRegex = new RegExp(`(^|\\n)([ \\t]*${keyName}:\\s*)([^\\r\\n#]*)`, 'm');
              const emptyRefsRegex = /(^|\n)([ \t]*refs:\s*\{\s*\})/m;
              const refsBlockRegex = /(^|\n)([ \t]*refs:\s*(?:\r?\n|$))/m;
              if (keyRegex.test(rawContent)) {
                return rawContent.replace(keyRegex, `$1  ${keyName}: ${val}`);
              } else if (emptyRefsRegex.test(rawContent)) {
                return rawContent.replace(emptyRefsRegex, `$1refs:\n  ${keyName}: ${val}`);
              } else if (refsBlockRegex.test(rawContent)) {
                return rawContent.replace(refsBlockRegex, `$1refs:\n  ${keyName}: ${val}\n`);
              } else {
                return rawContent.trimEnd() + `\nrefs:\n  ${keyName}: ${val}\n`;
              }
            };

            if (!content || !content.trim()) {
              content = `version: 1\nrecords: {}\nrefs:\n  WINETOKEN_API_KEY: ${trimmed}\n`;
            } else {
              content = writeOneKey(content, 'WINETOKEN_API_KEY', trimmed);
              if (hasZhaizhu) {
                content = writeOneKey(content, 'ZHAIZHU_API_KEY', trimmed);
              }
            }
            fs.writeFileSync(credPath, content, { encoding: 'utf8', mode: 0o600 });

            // 回读校验物理落盘状态
            const verifyContent = fs.readFileSync(credPath, 'utf8');
            if (verifyContent.includes(trimmed)) {
              fsWriteSuccess = true;
            } else {
              fsErrorMessage = '写入凭据文件后回读未找到有效密钥';
            }
          }
        } catch (e) {
          fsErrorMessage = e.message;
          console.warn('[WineToken] 写入 .credentials.yaml 失败:', e.message);
        }
      }

      // 4. 触发基线模型自愈注入用户层 cordis.patch.yml (彻底消除 P0 覆盖问题)
      if (nodeRequire) {
        try {
          const { ensureBaselineProviderInPatch } = nodeRequire('./sync.js');
          if (typeof ensureBaselineProviderInPatch === 'function') {
            ensureBaselineProviderInPatch();
          }
        } catch (_) {}
      }

      if (remoteSaved || fsWriteSuccess) {
        return { success: true, channel: remoteSaved ? 'remote' : 'fs' };
      }
      if (localSaved) {
        // 双通道皆不可达：客户端全链路 (工坊/画布/账单/模型清单) 仍已生效
        const reason = remoteError ? ('凭据服务响应: ' + remoteError) : '当前桌面端未暴露凭据写入通道';
        return { success: true, partial: true, warning: reason };
      }
      return { success: false, error: fsErrorMessage || remoteError || '写入失败' };
    },

    // 清除凭据
    async clearKey() {
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.removeItem('WINETOKEN_API_KEY');
        }
      } catch (_) {}
      if (typeof process !== 'undefined' && process.env) {
        try { delete process.env.WINETOKEN_API_KEY; } catch (_) {}
      }
      // 优先走 DSH 官方凭据 Remote 通道 (沙箱可用)，失败再尝试直写
      try {
        const credFace = (typeof window !== 'undefined' && window) ? window.__winetoken_remote_credentials : null;
        if (credFace && typeof credFace.unset === 'function') {
          await credFace.unset('WINETOKEN_API_KEY');
          return;
        }
      } catch (_) {}
      try {
        const nodeRequire = typeof require === 'function' ? require
          : (typeof window !== 'undefined' && window && typeof window.require === 'function' ? window.require : null);
        if (!nodeRequire) return;
        const fs = nodeRequire('fs');
        const credPath = this.getCredentialsPath();
        if (credPath && fs.existsSync(credPath)) {
          let content = fs.readFileSync(credPath, 'utf8');
          content = content.replace(/(^|\n)[ \t]*WINETOKEN_API_KEY:[^\r\n]*/g, '');
          fs.writeFileSync(credPath, content, { encoding: 'utf8', mode: 0o600 });
        }
      } catch (_) {}
    }
  };

  function getKey() {
    return WineTokenCredentialBridge.readKey();
  }

  function formatCNY(val) {
    const n = Number(val);
    if (isNaN(n)) return '0.00';
    return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function loadBillingCache() {
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(CACHE_KEY);
        if (raw) return JSON.parse(raw);
      }
    } catch (_) {}
    return null;
  }

  function saveBillingCache(state) {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(CACHE_KEY, JSON.stringify({
          balanceText: state.balanceText,
          usedText: state.usedText,
          pillText: state.pillText,
          hasSubscription: state.hasSubscription,
          isSuper: Boolean(state.isSuper),
          userGroup: state.userGroup || '',
          walletBalanceCNY: state.walletBalanceCNY,
          totalUsedCNY: state.totalUsedCNY,
          subRemainAmountCNY: state.subRemainAmountCNY,
          subAmountTotalCNY: state.subAmountTotalCNY,
          subAmountUsedCNY: state.subAmountUsedCNY,
          subUsedPercent: state.subUsedPercent,
          remainDays: state.remainDays || 0,
          subPlanTitle: state.subPlanTitle || '',
          subGroup: state.subGroup || '',
          subEndTime: state.subEndTime || 0,
          tooltip: state.tooltip,
          cachedAt: Date.now()
        }));
      }
    } catch (_) {}
  }

  // =========================================================================
  // 动态模型清单管理器 (WineTokenManifestManager)
  // 三级防御机制: Level 1 静态内存基底 -> Level 2 本地持久化缓存 -> Level 3 SWR 线上动态热同步
  // =========================================================================
  const MANIFEST_CACHE_KEY = "WINETOKEN_MANIFEST_CACHE_V1";

  // 断网兜底：与服务端 subscription.py 的 BASE_IMAGE_MODELS 保持一致
  // (2026-11-06 New-API 下架 3 个 2.5/经典、上架 2 个 2.6)。
  // 线上 manifest 可达时一律以线上为准，此表仅用于完全离线。
  const IMAGE_RESOLUTIONS_5 = [
    { label: '1:1 正方', icon: 'ratio1_1', val: '1024x1024' },
    { label: '3:4 竖屏', icon: 'ratio9_16', val: '768x1344' },
    { label: '4:3 横屏', icon: 'ratio16_9', val: '1344x768' },
    { label: '9:16 竖屏', icon: 'ratio9_16', val: '1024x1792' },
    { label: '16:9 横屏', icon: 'ratio16_9', val: '1792x1024' }
  ];
  const BASE_IMAGE_MODELS_FALLBACK = [
    {
      id: 'gpt-image-2.6-flare',
      name: 'GPT-Image 2.6 Flare',
      tag: '超快极速',
      price: 0.20,
      vipPrice: 0.16,
      enabled: true,
      singleNOnly: true,
      unit: '张',
      desc: '极速出图引擎，细节与色彩较 2.5 系列进一步升级',
      resolutions: IMAGE_RESOLUTIONS_5
    },
    {
      id: 'gpt-image-2.6-sunburst',
      name: 'GPT-Image 2.6 Sunburst',
      tag: '细腻逼真',
      price: 0.30,
      vipPrice: 0.24,
      enabled: true,
      singleNOnly: true,
      unit: '张',
      desc: '高画质光影渲染，画质与指令遵循较 2.5 系列进一步升级',
      resolutions: IMAGE_RESOLUTIONS_5
    },
    {
      id: 'grok-imagine-image-2.0',
      name: 'Grok Imagine 2.0 旗舰',
      tag: '创意先锋',
      price: 0.50,
      vipPrice: 0.40,
      enabled: true,
      singleNOnly: true,
      unit: '张',
      desc: '具备顶级发散想象力与自然构图，色彩浓郁张力十足',
      resolutions: IMAGE_RESOLUTIONS_5
    },
    {
      id: 'gemini-imagen-3',
      name: 'Google Imagen 3',
      tag: '精准细节',
      price: 0.15,
      vipPrice: 0.12,
      enabled: true,
      singleNOnly: true,
      unit: '张',
      desc: '谷歌下一代生图旗舰，超高文字渲染能力与真实细节重现',
      resolutions: IMAGE_RESOLUTIONS_5
    },
    {
      id: 'sensenova-u1.5-lite',
      name: '商汤 SenseNova U1.5 Lite',
      tag: '限免4K',
      price: 0.00,
      vipPrice: 0.00,
      enabled: true,
      singleNOnly: true,
      unit: '张',
      desc: '4K超清直出，中英文字排版与概念艺术',
      resolutions: IMAGE_RESOLUTIONS_5
    },
    {
      id: 'muse-image',
      name: 'Muse Image',
      tag: '超值',
      price: 0.05,
      vipPrice: 0.04,
      enabled: true,
      singleNOnly: true,
      unit: '张',
      desc: 'Muse 网页端生图引擎，支持文生图与参考图编辑，超高性价比',
      resolutions: IMAGE_RESOLUTIONS_5
    }
  ];

  const BASE_VIDEO_MODELS_FALLBACK = [
    {
      id: 'MiniMax-H3',
      name: 'MiniMax H3',
      tag: '电影感',
      pricePerSecond: 0.12,
      vipPricePerSecond: 0.096,
      priceText: '原¥0.12/秒 (5秒基准 ¥0.60)',
      vipPriceText: '会员 ¥0.096/秒 (5秒基准 ¥0.48)',
      unit: '秒',
      durations: [
        { val: 4, label: '4 秒', tag: '轻量' },
        { val: 5, label: '5 秒', tag: '标配' },
        { val: 6, label: '6 秒', tag: '延展' },
        { val: 10, label: '10 秒', tag: '长片' },
        { val: 15, label: '15 秒', tag: '旗舰' }
      ],
      desc: '768P 电影级光影，原生支持 4~15 秒超长生成时长，支持首帧 / 尾帧参考图精准驱动动态',
      resolutions: [
        { label: '720P 横屏', icon: 'ratio16_9', val: '1280x720' },
        { label: '720P 竖屏', icon: 'ratio9_16', val: '720x1280' }
      ]
    },
    {
      id: 'MiniMax-H3-2K',
      name: 'MiniMax H3 2K',
      tag: '2K超清',
      pricePerSecond: 0.20,
      vipPricePerSecond: 0.16,
      priceText: '原¥0.20/秒 (5秒基准 ¥1.00)',
      vipPriceText: '会员 ¥0.16/秒 (5秒基准 ¥0.80)',
      unit: '秒',
      durations: [
        { val: 5, label: '5 秒', tag: '标配' },
        { val: 6, label: '6 秒', tag: '延展' },
        { val: 10, label: '10 秒', tag: '长片' },
        { val: 15, label: '15 秒', tag: '旗舰' }
      ],
      desc: '768P 电影级光影，原生支持 4~15 秒超长生成时长，支持首帧 / 尾帧参考图精准驱动动态',
      resolutions: [
        { label: '2K 横屏', icon: 'ratio16_9', val: '2560x1440' },
        { label: '2K 竖屏', icon: 'ratio9_16', val: '1440x2560' }
      ]
    },
    {
      id: 'grok-imagine-video-1.5',
      name: 'Grok Imagine 视频旗舰',
      tag: '物理连贯',
      pricePerSecond: 0.20,
      vipPricePerSecond: 0.16,
      priceText: '原¥0.20/秒 (5秒基准 ¥1.00)',
      vipPriceText: '会员 ¥0.16/秒 (5秒基准 ¥0.80)',
      unit: '秒',
      durations: [
        { val: 5, label: '5 秒', tag: '标配' },
        { val: 10, label: '10 秒', tag: '长片' }
      ],
      desc: '顶尖自然光影渲染与物理一致性模拟，运镜张力十足',
      resolutions: [
        { label: '720P 横屏', icon: 'ratio16_9', val: '1280x720' },
        { label: '720P 竖屏', icon: 'ratio9_16', val: '720x1280' }
      ]
    },
    {
      id: 'muse-video',
      name: 'Muse Video',
      tag: '超值',
      pricePerSecond: 0.05,
      vipPricePerSecond: 0.04,
      priceText: '原¥0.05/秒 (5秒基准 ¥0.25)',
      vipPriceText: '会员 ¥0.04/秒 (5秒基准 ¥0.20)',
      unit: '秒',
      durations: [
        { val: 5, label: '5 秒', tag: '标配' },
        { val: 6, label: '6 秒', tag: '延展' },
        { val: 10, label: '10 秒', tag: '长片' },
        { val: 15, label: '15 秒', tag: '旗舰' }
      ],
      desc: 'Muse 网页端视频生成，720P 出片，时长与横竖画幅可选，支持文生视频与首帧图生视频',
      resolutions: [
        { label: '720P 横屏', icon: 'ratio16_9', val: '1280x720' },
        { label: '720P 竖屏', icon: 'ratio9_16', val: '720x1280' }
      ]
    }
  ];

  function normalizeImageModel(raw) {
    if (!raw) return null;
    const isSquare = (s) => s.startsWith('1024x1024') || s.startsWith('512x512') || s.startsWith('2048x2048');
    const isHoriz = (s) => s.startsWith('1792') || s.startsWith('1280') || s.startsWith('1536') || s.startsWith('1344x768');
    let resolutions = [];
    if (Array.isArray(raw.resolutions)) {
      resolutions = raw.resolutions.map(r => {
        if (typeof r === 'string') {
          return {
            label: r,
            icon: isSquare(r) ? 'ratio1_1' : (isHoriz(r) ? 'ratio16_9' : 'ratio9_16'),
            val: r
          };
        }
        return r;
      });
    }
    // 名称 / 标签 / 价格 / 尺寸一律以服务端 manifest 为准；静态改名逻辑已移除，
    // 避免线上改名或调价后客户端仍显示旧值。
    const displayName = raw.name || raw.id;
    return {
      id: raw.id,
      name: displayName,
      tag: raw.badge || raw.tag || '推荐',
      price: raw.cost != null ? Number(raw.cost) : (raw.price != null ? Number(raw.price) : 0),
      vipPrice: raw.vipCost != null ? Number(raw.vipCost) : (raw.vipPrice != null ? Number(raw.vipPrice) : 0),
      // enabled 由服务端按分组下发；undefined 视为可用（兼容旧 manifest / 静态兜底）
      enabled: raw.enabled !== false,
      singleNOnly: raw.singleNOnly !== undefined ? Boolean(raw.singleNOnly) : (raw.single_n_only !== undefined ? Boolean(raw.single_n_only) : false),
      unit: '张',
      desc: raw.desc || '',
      resolutions: resolutions.length > 0 ? resolutions : [
        { label: '1:1 正方', icon: 'ratio1_1', val: '1024x1024' },
        { label: '16:9 横屏', icon: 'ratio16_9', val: '1792x1024' },
        { label: '9:16 竖屏', icon: 'ratio9_16', val: '1024x1792' }
      ]
    };
  }

  function normalizeVideoModel(raw) {
    if (!raw) return null;
    // 强制剔除非真实视频生成模型的误配项 (如商汤日日新 4K 动效 / sensenova-6.8-flash)
    if (raw.id === 'sensenova-6.8-flash' || (raw.name && raw.name.includes('商汤日日新 4K 动效'))) {
      return null;
    }
    const isHoriz = (s) => s.startsWith('1280') || s.startsWith('1920') || s.startsWith('2560');
    let resolutions = [];
    if (Array.isArray(raw.resolutions)) {
      resolutions = raw.resolutions.map(r => {
        if (typeof r === 'string') {
          return {
            label: r,
            icon: isHoriz(r) ? 'ratio16_9' : 'ratio9_16',
            val: r
          };
        }
        return r;
      });
    }
    let durations = [];
    if (Array.isArray(raw.durations)) {
      durations = raw.durations.map(d => {
        if (typeof d === 'number') {
          return { val: d, label: `${d} 秒`, tag: d <= 5 ? '标配' : (d <= 10 ? '长片' : '旗舰') };
        }
        return d;
      });
    }
    const costSec = raw.costPerSec != null ? Number(raw.costPerSec) : (raw.pricePerSecond != null ? Number(raw.pricePerSecond) : 0);
    const vipCostSec = raw.vipCostPerSec != null ? Number(raw.vipCostPerSec) : (raw.vipPricePerSecond != null ? Number(raw.vipPricePerSecond) : 0);
    // 仅清洗历史脏后缀 "(海螺视频)"，名称本身以服务端 manifest 为准
    let displayName = (raw.name || raw.id).replace(/[\(（]海螺视频[\)）]/g, '').trim();
    return {
      id: raw.id,
      name: displayName,
      tag: raw.badge || raw.tag || '推荐',
      enabled: raw.enabled !== false,
      pricePerSecond: costSec,
      vipPricePerSecond: vipCostSec,
      priceText: raw.priceText || (costSec === 0 ? '限免 ¥0.00/秒' : `原¥${costSec.toFixed(2)}/秒`),
      vipPriceText: raw.vipPriceText || (vipCostSec === 0 ? '限免 ¥0.00/秒' : `VIP ¥${vipCostSec.toFixed(2)}/秒`),
      unit: '秒',
      durations: durations.length > 0 ? durations : [{ val: 5, label: '5 秒', tag: '标配' }],
      desc: raw.desc || '',
      resolutions: resolutions.length > 0 ? resolutions : [
        { label: '720P 横屏', icon: 'ratio16_9', val: '1280x720' },
        { label: '720P 竖屏', icon: 'ratio9_16', val: '720x1280' }
      ]
    };
  }

  const WineTokenManifestManager = {
    _listeners: new Set(),
    _data: null,
    _isFetching: false,

    init() {
      let cached = null;
      try {
        if (typeof localStorage !== 'undefined') {
          const raw = localStorage.getItem(MANIFEST_CACHE_KEY);
          if (raw) cached = JSON.parse(raw);
        }
      } catch (_) {}

      if (!cached) {
        try {
          const fs = require('fs');
          const path = require('path');
          const os = require('os');
          const diskFile = path.join(os.homedir(), '.dsh', 'storages', 'winetoken_manifest.json');
          if (fs.existsSync(diskFile)) {
            cached = JSON.parse(fs.readFileSync(diskFile, 'utf8'));
          }
        } catch (_) {}
      }

      if (cached && Array.isArray(cached.imageModels) && Array.isArray(cached.videoModels)) {
        this._data = {
          imageModels: cached.imageModels.map(normalizeImageModel).filter(Boolean),
          videoModels: cached.videoModels.map(normalizeVideoModel).filter(Boolean),
          chatModels: Array.isArray(cached.chatModels) ? cached.chatModels : [],
          updatedAt: cached.updatedAt || 0
        };
      } else {
        this._data = {
          imageModels: BASE_IMAGE_MODELS_FALLBACK,
          videoModels: BASE_VIDEO_MODELS_FALLBACK,
          chatModels: [],
          updatedAt: 0
        };
      }
    },

    // 只暴露服务端标记为可用的模型；旧缓存无 enabled 字段时视为可用。
    // 若过滤后为空（极端异常），退回原清单，避免下拉彻底空白。
    _usable(list) {
      const arr = Array.isArray(list) ? list : [];
      const filtered = arr.filter(m => m && m.enabled !== false);
      return filtered.length > 0 ? filtered : arr;
    },

    // 对外快照也过滤，保证工坊 manifestSnapshot.imageModels / 订阅回调拿到的是可用清单
    getSnapshot() {
      if (!this._data) this.init();
      const d = this._data;
      return {
        imageModels: this._usable(d.imageModels),
        videoModels: this._usable(d.videoModels),
        chatModels: Array.isArray(d.chatModels) ? d.chatModels : [],
        updatedAt: d.updatedAt || 0
      };
    },

    getImageModels() {
      return this.getSnapshot().imageModels;
    },

    getVideoModels() {
      return this.getSnapshot().videoModels;
    },

    getChatModels() {
      const imgIds = new Set((this._data?.imageModels || []).map(m => m.id));
      const vidIds = new Set((this._data?.videoModels || []).map(m => m.id));
      // 服务端旧逻辑会把未登记的生图模型误塞进 chatModels（如 gpt-image-2.6-*），
      // 这里在消费侧剔除，避免 AI 拆镜把它们当对话模型列出。
      return (this.getSnapshot().chatModels || []).filter(
        m => m && m.enabled !== false && !imgIds.has(m.id) && !vidIds.has(m.id)
      );
    },

    getFreeImageModel() {
      const imgs = this.getImageModels();
      const free = imgs.find(m => m.price === 0 || (m.tag && m.tag.includes('限免')));
      return free ? free.id : (imgs[0]?.id || 'sensenova-u1.5-lite');
    },

    subscribe(listener) {
      this._listeners.add(listener);
      return () => this._listeners.delete(listener);
    },

    _notify() {
      const snapshot = this.getSnapshot();
      for (const fn of this._listeners) {
        try { fn(snapshot); } catch (_) {}
      }
    },

    async fetchManifest(force = false) {
      if (this._isFetching) return;
      this._isFetching = true;
      try {
        const key = getKey();
        const headers = key ? { Authorization: 'Bearer ' + key } : {};
        const res = await fetch(BASE_URL + '/api/subscription/models/manifest', {
          headers
        });
        if (res.ok) {
          const json = await res.json();
          if (json && json.ok) {
            const nextImg = (json.imageModels || []).map(normalizeImageModel).filter(Boolean);
            const nextVid = (json.videoModels || []).map(normalizeVideoModel).filter(Boolean);
            const nextChat = Array.isArray(json.chatModels) ? json.chatModels : [];

            if (nextImg.length > 0 || nextVid.length > 0) {
              // 服务端 manifest 是模型清单的唯一真相：名称 / 标签 / 价格 / 尺寸 / 上下线状态
              // 全部以线上为准。enabled===false 表示当前分组不可用，直接过滤，不再用静态兜底
              // 把它并集回来（否则服务端下架的模型会永远残留在下拉里）。
              // 仅当线上完全没有返回该类模型时，才退回静态兜底，保证断网/异常时界面不空。
              const usableImg = nextImg.filter(m => m.enabled !== false);
              const usableVid = nextVid.filter(m => m.enabled !== false);
              const finalImg = usableImg.length > 0 ? usableImg : BASE_IMAGE_MODELS_FALLBACK;
              const finalVid = usableVid.length > 0 ? usableVid : BASE_VIDEO_MODELS_FALLBACK;

              this._data = {
                imageModels: finalImg,
                videoModels: finalVid,
                chatModels: nextChat,
                updatedAt: json.updatedAt || Date.now()
              };

              try {
                if (typeof localStorage !== 'undefined') {
                  localStorage.setItem(MANIFEST_CACHE_KEY, JSON.stringify(this._data));
                }
              } catch (_) {}

              try {
                const fs = require('fs');
                const path = require('path');
                const os = require('os');
                const storagesDir = path.join(os.homedir(), '.dsh', 'storages');
                if (!fs.existsSync(storagesDir)) fs.mkdirSync(storagesDir, { recursive: true });
                const diskFile = path.join(storagesDir, 'winetoken_manifest.json');
                fs.writeFileSync(diskFile, JSON.stringify(this._data, null, 2), 'utf8');
              } catch (_) {}

              this._notify();
            }
          }
        }
      } catch (err) {
        // 静默容错，保留现有缓存
      } finally {
        this._isFetching = false;
      }
    }
  };

  WineTokenManifestManager.init();
  if (typeof window !== 'undefined') {
    window.WineTokenManifestManager = WineTokenManifestManager;
  }

  // 本地媒体文件与目录系统管理引擎 (基于 Electron 44 + Node.js 24 原生支持，支持自定义另存为路径与文件夹定位)
  const WineTokenFileUtil = {
    // 获取本地专属保存目录：~/Pictures/WineToken（作为兜底目录）
    getSaveDir() {
      try {
        const path = require('path');
        const os = require('os');
        const fs = require('fs');
        const dir = path.join(os.homedir(), 'Pictures', 'WineToken');
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        return dir;
      } catch (_) {
        return null;
      }
    },

    // 获取并记忆用户上次保存的目录
    getLastSaveDir() {
      try {
        const saved = localStorage.getItem('WINETOKEN_LAST_SAVE_DIR');
        const fs = require('fs');
        if (saved && fs.existsSync(saved)) {
          return saved;
        }
      } catch (_) {}
      return this.getSaveDir();
    },

    // 记录用户最新选择的保存目录
    setLastSaveDir(dirPath) {
      if (!dirPath) return;
      try {
        localStorage.setItem('WINETOKEN_LAST_SAVE_DIR', dirPath);
      } catch (_) {}
    },

    // 检查本地物理文件是否存在
    fileExists(filePath) {
      if (!filePath) return false;
      try {
        const fs = require('fs');
        return fs.existsSync(filePath);
      } catch (_) {
        return false;
      }
    },

    // 格式化推断扩展名
    inferExtension(url, type) {
      if (type === 'video') return '.mp4';
      if (typeof url === 'string') {
        if (url.includes('.mp4')) return '.mp4';
        if (url.includes('.jpg') || url.includes('.jpeg')) return '.jpg';
        if (url.includes('.webp')) return '.webp';
        if (url.includes('.gif')) return '.gif';
      }
      return '.png';
    },

    /**
     * 调起 Windows 原生另存为文件对话框，让用户自由挑选存放路径与盘符
     * @param {Object} options
     * @param {string} [options.title] 对话框标题
     * @param {string} [options.defaultName] 预设文件名
     * @param {string} [options.type] 'image' | 'video'
     * @param {string} [options.ext] 默认扩展名（如 '.png' 或 '.mp4'）
     * @param {string} [options.filters] WinForms 过滤器
     * @returns {Promise<string|null>} 用户选中的完整绝对物理路径；取消则返回 null
     */
    async promptSaveLocation(options = {}) {
      const type = options.type || 'image';
      const defaultExt = (options.ext || (type === 'video' ? '.mp4' : '.png')).replace(/^\./, '');
      const defaultName = options.defaultName || `WineToken_${Date.now()}.${defaultExt}`;
      const title = options.title || (type === 'video' ? '另存为视频' : '另存为图片');
      const initialDir = options.initialDir || this.getLastSaveDir() || '';

      // 构建 WinForms 过滤器
      let filter = options.filters;
      if (!filter) {
        if (type === 'video') {
          filter = 'MP4 视频 (*.mp4)|*.mp4|所有文件 (*.*)|*.*';
        } else {
          filter = 'PNG 图片 (*.png)|*.png|JPEG 图片 (*.jpg;*.jpeg)|*.jpg;*.jpeg|WEBP 图片 (*.webp)|*.webp|所有文件 (*.*)|*.*';
        }
      }

      try {
        const cp = require('child_process');
        const path = require('path');
        const config = {
          title,
          fileName: defaultName,
          initialDir,
          filter,
          defaultExt
        };

        const configB64 = Buffer.from(JSON.stringify(config), 'utf8').toString('base64');
        const psScript = `
Add-Type -AssemblyName System.Windows.Forms
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.StartPosition = "Manual"
$owner.Location = New-Object System.Drawing.Point(-32000, -32000)
$owner.Show()
$owner.Activate()

$cfgJson = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("${configB64}"))
$cfg = ConvertFrom-Json $cfgJson

$d = New-Object System.Windows.Forms.SaveFileDialog
$d.Title = $cfg.title
if ($cfg.fileName) { $d.FileName = $cfg.fileName }
if ($cfg.initialDir) { $d.InitialDirectory = $cfg.initialDir }
if ($cfg.filter) { $d.Filter = $cfg.filter }
if ($cfg.defaultExt) { $d.DefaultExt = $cfg.defaultExt }
$d.AddExtension = $true
$d.OverwritePrompt = $true

$res = $d.ShowDialog($owner)
if ($res -eq [System.Windows.Forms.DialogResult]::OK -and $d.FileName) {
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($d.FileName)
  Write-Output ([Convert]::ToBase64String($bytes))
}
$owner.Dispose()
`;

        const scriptB64 = Buffer.from(psScript, 'utf16le').toString('base64');
        const chosenPath = await new Promise((resolve) => {
          const proc = cp.spawn('powershell.exe', ['-STA', '-NoProfile', '-NonInteractive', '-EncodedCommand', scriptB64], {
            windowsHide: true
          });
          let stdout = '';
          proc.stdout.setEncoding('utf8');
          proc.stdout.on('data', (d) => { stdout += d; });
          proc.on('close', () => {
            const raw = stdout.trim();
            if (!raw) return resolve(null);
            try {
              const decoded = Buffer.from(raw, 'base64').toString('utf8');
              resolve(decoded);
            } catch (_) {
              resolve(null);
            }
          });
          proc.on('error', () => resolve(null));
        });

        if (chosenPath) {
          this.setLastSaveDir(path.dirname(chosenPath));
          return chosenPath;
        }
        return null;
      } catch (err) {
        console.warn('[WineToken] 调起原生另存为对话框异常:', err);
        return null;
      }
    },

    /**
     * 将媒体数据直接流式写入用户指定的物理绝对路径
     */
    async writeMediaToFile(url, targetPath) {
      if (!targetPath) throw new Error('未指定目标物理保存路径');
      const fs = require('fs');

      // 1. Base64 DataURL (瞬间解码写入)
      if (typeof url === 'string' && url.startsWith('data:')) {
        const base64Data = url.replace(/^data:[^;]+;base64,/, '');
        await fs.promises.writeFile(targetPath, Buffer.from(base64Data, 'base64'));
        return targetPath;
      }

      // 2. HTTP / HTTPS 远程资源
      const res = await fetch(url);
      if (!res.ok) throw new Error(`下载网络媒体失败: HTTP ${res.status}`);
      const arrayBuf = await res.arrayBuffer();
      await fs.promises.writeFile(targetPath, Buffer.from(arrayBuf));
      return targetPath;
    },

    // 快捷保存至本地存储目录老接口 (作为无感静默缓存使用)
    async saveMedia(url, customName = null, type = 'image') {
      const path = require('path');
      const dir = this.getSaveDir();
      if (!dir) throw new Error('无法初始化本地媒体存储目录 (Pictures/WineToken)');

      const ext = this.inferExtension(url, type);
      const safeName = customName ? customName.replace(/[\\/:*?"<>|]/g, '_') : `WineToken_${Date.now()}`;
      const fileName = safeName.endsWith(ext) ? safeName : `${safeName}${ext}`;
      const fullPath = path.join(dir, fileName);

      return await this.writeMediaToFile(url, fullPath);
    },

    // 以本地文件形式直接打开文件 (调起系统默认图片/视频查看器)
    openFile(filePath) {
      if (!filePath) return false;
      try {
        const electron = require('electron');
        if (electron && electron.shell && electron.shell.openPath) {
          electron.shell.openPath(filePath);
          return true;
        }
      } catch (_) {}
      try {
        const path = require('path');
        const ext = path.extname(filePath).toLowerCase();
        const SAFE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.mp4', '.json', '.txt'];
        if (!SAFE_EXTS.includes(ext)) {
          console.warn('[WineToken] 拒绝打开非安全白名单扩展名的文件:', ext);
          return false;
        }
        const normalized = path.normalize(filePath);
        if (/[\&\|\`\$\;\>\<]/.test(normalized)) {
          console.warn('[WineToken] 文件路径包含非法特殊字符，阻断执行 (SEC-03)');
          return false;
        }
        const cp = require('child_process');
        if (process.platform === 'win32') {
          cp.spawn('explorer.exe', [normalized], { detached: true, stdio: 'ignore' });
        } else if (process.platform === 'darwin') {
          cp.spawn('open', [normalized], { detached: true, stdio: 'ignore' });
        } else {
          cp.spawn('xdg-open', [normalized], { detached: true, stdio: 'ignore' });
        }
        return true;
      } catch (_) {
        return false;
      }
    },

    // 在系统文件资源管理器中定位并高亮显示该文件
    revealFile(filePath) {
      if (!filePath) return false;
      try {
        const electron = require('electron');
        if (electron && electron.shell && electron.shell.showItemInFolder) {
          electron.shell.showItemInFolder(filePath);
          return true;
        }
      } catch (_) {}
      try {
        const cp = require('child_process');
        cp.execFile('explorer.exe', [`/select,${filePath}`]);
        return true;
      } catch (_) {
        return false;
      }
    },

    // 打开存储根目录
    openFolder() {
      const dir = this.getLastSaveDir() || this.getSaveDir();
      if (!dir) return false;
      try {
        const electron = require('electron');
        if (electron && electron.shell && electron.shell.openPath) {
          electron.shell.openPath(dir);
          return true;
        }
      } catch (_) {}
      try {
        const cp = require('child_process');
        cp.execFile('explorer.exe', [dir]);
        return true;
      } catch (_) {
        return false;
      }
    }
  };

  const initialKey = getKey();
  const initialCache = initialKey ? loadBillingCache() : null;

  let billingState = initialCache ? {
    balanceText: initialCache.balanceText || '余额 --',
    usedText: initialCache.usedText || '已用 ¥0.00',
    pillText: initialCache.pillText || initialCache.balanceText || '余额 --',
    hasSubscription: Boolean(initialCache.hasSubscription),
    isSuper: Boolean(initialCache.isSuper),
    userGroup: initialCache.userGroup || '',
    walletBalanceCNY: Number(initialCache.walletBalanceCNY || 0),
    totalUsedCNY: Number(initialCache.totalUsedCNY || 0),
    subRemainAmountCNY: Number(initialCache.subRemainAmountCNY || 0),
    subAmountTotalCNY: Number(initialCache.subAmountTotalCNY || 0),
    subAmountUsedCNY: Number(initialCache.subAmountUsedCNY || 0),
    subUsedPercent: Number(initialCache.subUsedPercent || 0),
    remainDays: Number(initialCache.remainDays || 0),
    subPlanTitle: initialCache.subPlanTitle || '',
    subGroup: initialCache.subGroup || '',
    subEndTime: Number(initialCache.subEndTime || 0),
    tooltip: initialCache.tooltip || 'WineToken 账户管理',
    isFetching: false,
    isCached: true
  } : {
    balanceText: initialKey ? '余额 --' : '未配置 Key',
    usedText: initialKey ? '已用 ¥0.00' : '点击配置',
    pillText: initialKey ? '余额 --' : '未配置 Key',
    hasSubscription: false,
    isSuper: false,
    userGroup: '',
    walletBalanceCNY: 0,
    totalUsedCNY: 0,
    subRemainAmountCNY: 0,
    subAmountTotalCNY: 0,
    subAmountUsedCNY: 0,
    subUsedPercent: 0,
    remainDays: 0,
    subPlanTitle: '',
    subGroup: '',
    subEndTime: 0,
    tooltip: initialKey ? '点击管理 WineToken 账户与密钥' : '未配置 API Key，点击快速填入',
    isFetching: false,
    isCached: false
  };

  const listeners = new Set();
  function notify() {
    for (const fn of listeners) {
      try { fn({ ...billingState }); } catch (_) {}
    }
  }

  async function updateBilling() {
    const key = getKey();
    if (!key) {
      billingState.balanceText = '未配置 Key';
      billingState.usedText = '点击配置';
      billingState.pillText = '未配置 Key';
      billingState.hasSubscription = false;
      billingState.isSuper = false;
      billingState.userGroup = '';
      billingState.walletBalanceCNY = 0;
      billingState.totalUsedCNY = 0;
      billingState.subRemainAmountCNY = 0;
      billingState.subAmountTotalCNY = 0;
      billingState.subAmountUsedCNY = 0;
      billingState.subUsedPercent = 0;
      billingState.remainDays = 0;
      billingState.subPlanTitle = '';
      billingState.subGroup = '';
      billingState.subEndTime = 0;
      billingState.tooltip = '未配置 API Key，点击快速填入';
      billingState.isFetching = false;
      notify();
      return;
    }
    if (billingState.isFetching) return;
    billingState.isFetching = true;

    // 异步同步拉取最新模型清单 (SWR 增量热更新)
    try {
      WineTokenManifestManager.fetchManifest();
    } catch (_) {}

    try {
      const headers = { Authorization: 'Bearer ' + key };

      // 1. 优先获取最新轻量只读双账轨订阅与钱包状态接口 (Tokyo VPS 网关直供)
      let subStatusData = null;
      try {
        const subStatusRes = await fetch(BASE_URL + '/api/subscription/status', { headers });
        if (subStatusRes.ok) {
          subStatusData = await subStatusRes.json();
        }
      } catch (_) {}

      // 2. 获取当月财务审计总流水 (100% 独立账本事实，不受套餐已用影响)
      let usageData = null;
      try {
        const now = new Date();
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
        const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
        const usageRes = await fetch(BASE_URL + '/dashboard/billing/usage?start_date=' + firstDay + '&end_date=' + lastDay, { headers });
        if (usageRes.ok) {
          usageData = await usageRes.json();
        }
      } catch (_) {}

      if (subStatusData && subStatusData.ok) {
        // === 命中高精度双账轨数据源 (唯一精准真相源，杜绝数据闪烁漂移) ===
        const walletCNY = Number(subStatusData.wallet_balance_cny || 0);
        billingState.walletBalanceCNY = walletCNY;
        const walletBalStr = formatCNY(walletCNY);

        // 真实总累计已用金额 (历史所有调用总消耗，彻底取代单月流水)
        const totalUsedCNY = Number(subStatusData.total_used_cny != null ? subStatusData.total_used_cny : (subStatusData.token_used_cny != null ? subStatusData.token_used_cny : subStatusData.wallet_used_cny || 0));
        billingState.totalUsedCNY = totalUsedCNY;
        billingState.tokenUsedCNY = subStatusData.token_used_cny != null ? Number(subStatusData.token_used_cny) : null;
        const totalUsedCNYStr = formatCNY(totalUsedCNY);
        billingState.usedText = '已用 ¥' + totalUsedCNYStr;

        const uGroup = (subStatusData.user && subStatusData.user.group || '').toLowerCase();
        const tGroup = (subStatusData.token && subStatusData.token.group || '').toLowerCase();
        const sGroup = (subStatusData.subscription && subStatusData.subscription.upgrade_group || '').toLowerCase();
        const isSuper = Boolean(subStatusData.is_super || uGroup === 'super' || tGroup === 'super' || sGroup === 'super');
        billingState.isSuper = isSuper;
        billingState.userGroup = isSuper ? 'super' : (sGroup || uGroup || tGroup || 'default');

        const hasSub = Boolean(subStatusData.subscribed && subStatusData.subscription && !isSuper);
        billingState.hasSubscription = hasSub;

        if (isSuper) {
          // === SUPER 会员专属特权分支 (特权分组，无额度限制，无需展示套餐额度与进度条) ===
          billingState.subPlanTitle = 'SUPER 会员特权';
          billingState.subGroup = 'super';
          billingState.subAmountTotalCNY = 0;
          billingState.subAmountUsedCNY = 0;
          billingState.subRemainAmountCNY = 0;
          billingState.subUsedPercent = 0;
          billingState.remainDays = 0;
          billingState.subEndTime = 0;

          billingState.balanceText = '钱包 ¥' + walletBalStr;
          billingState.pillText = 'SUPER · 钱包 ¥' + walletBalStr;
          billingState.tooltip = `SUPER 会员特权 (8折特惠 · 无限量专属免费模型) · 钱包永久: ¥${walletBalStr} · 总累计调用: ¥${totalUsedCNYStr}`;
        } else if (hasSub) {
          const sub = subStatusData.subscription;
          billingState.subPlanTitle = sub.plan_title || 'VIP 订阅套餐';
          billingState.subGroup = (sub.upgrade_group || 'vip').toLowerCase();
          billingState.subAmountTotalCNY = Number(sub.amount_total_cny || 0);
          billingState.subAmountUsedCNY = Number(sub.amount_used_cny || 0);
          billingState.subRemainAmountCNY = Number(sub.remain_amount_cny || 0);
          billingState.subUsedPercent = Number(sub.used_percent || 0);
          billingState.remainDays = Number(sub.remain_days || 0);
          billingState.subEndTime = Number(sub.end_time || 0);

          const groupLabel = billingState.subGroup === 'svip' ? 'SVIP' : (billingState.subGroup === 'vip' ? 'VIP' : '套餐');
          const subRemStr = formatCNY(billingState.subRemainAmountCNY);

          // 胶囊紧凑文字：清晰呈现套餐限时额度与钱包永久余额
          billingState.pillText = `${groupLabel} ¥${subRemStr} · 钱包 ¥${walletBalStr}`;
          billingState.balanceText = `¥${subRemStr}`;
          billingState.tooltip = `${groupLabel}限时额度: ¥${subRemStr} (已用 ${billingState.subUsedPercent}%, 剩${billingState.remainDays}天) · 钱包永久: ¥${walletBalStr} · 总累计调用: ¥${totalUsedCNYStr}`;
        } else {
          billingState.subPlanTitle = '';
          billingState.subGroup = '';
          billingState.subAmountTotalCNY = 0;
          billingState.subAmountUsedCNY = 0;
          billingState.subRemainAmountCNY = 0;
          billingState.subUsedPercent = 0;
          billingState.remainDays = 0;
          billingState.subEndTime = 0;

          billingState.balanceText = '余额 ¥' + walletBalStr;
          billingState.pillText = '余额 ¥' + walletBalStr;
          billingState.tooltip = '钱包永久余额: ¥' + walletBalStr + ' · 总累计调用: ¥' + totalUsedCNYStr;
        }
        billingState.isCached = false;
      } else {
        // === 容灾 Fallback 逻辑 (兼容旧接口) ===
        let usedCNYNum = 0;
        try {
          const usageRes = await fetch(BASE_URL + '/dashboard/billing/usage', { headers });
          if (usageRes.ok) {
            const usageData = await usageRes.json();
            if (usageData && usageData.total_usage != null) {
              usedCNYNum = Number(usageData.total_usage) / 100;
            }
          }
        } catch (_) {}

        let tokenUsage = null;
        try {
          const usageTokenRes = await fetch(BASE_URL + '/api/usage/token/', { headers });
          if (usageTokenRes.ok) tokenUsage = await usageTokenRes.json();
        } catch (_) {}

        let subData = null;
        try {
          const subRes = await fetch(BASE_URL + '/dashboard/billing/subscription', { headers });
          if (subRes.ok) subData = await subRes.json();
        } catch (_) {}

        let balCNY = null;
        if (tokenUsage?.data?.user_quota?.total_available != null) {
          balCNY = tokenUsage.data.user_quota.total_available / 500000;
        } else if (tokenUsage?.data?.unlimited_quota === false && tokenUsage?.data?.total_available != null) {
          balCNY = tokenUsage.data.total_available / 500000;
        } else if (subData?.hard_limit_usd && subData.hard_limit_usd < 100000000) {
          balCNY = Math.max(0, subData.hard_limit_usd - usedCNYNum);
        }

        let fallbackTotalUsed = usedCNYNum;
        if (tokenUsage?.data?.total_used != null) {
          fallbackTotalUsed = tokenUsage.data.total_used / 500000;
        } else if (tokenUsage?.data?.user_quota?.total_used != null) {
          fallbackTotalUsed = tokenUsage.data.user_quota.total_used / 500000;
        }
        billingState.totalUsedCNY = fallbackTotalUsed;
        const totalUsedCNYStr = formatCNY(fallbackTotalUsed);
        billingState.usedText = '已用 ¥' + totalUsedCNYStr;

        if (balCNY != null) {
          billingState.walletBalanceCNY = balCNY;
          const balStr = formatCNY(balCNY);
          billingState.balanceText = '余额 ¥' + balStr;
          billingState.pillText = '余额 ¥' + balStr;
          billingState.tooltip = '当前余额: ¥' + balStr + ' · 总累计调用: ¥' + totalUsedCNYStr;
          billingState.isCached = false;
        } else if (billingState.walletBalanceCNY > 0) {
          // 网络抖动时坚决保留缓存数值，绝不清空为 "--"
          billingState.tooltip = '当前余额: ¥' + formatCNY(billingState.walletBalanceCNY) + ' (缓存) · 总累计调用: ¥' + totalUsedCNYStr;
        } else {
          billingState.balanceText = '余额 --';
          billingState.pillText = '余额 --';
          billingState.tooltip = 'WineToken AI 网关 · 总累计调用: ¥' + totalUsedCNYStr;
        }

        const nowSec = Date.now() / 1000;
        const hardLimit = subData?.hard_limit_usd || 0;
        const hasSub = subData?.access_until && subData.access_until > nowSec && hardLimit < 100000000;
        billingState.hasSubscription = Boolean(hasSub);

        if (hasSub) {
          let pct = 0;
          if (tokenUsage?.data?.total_granted && tokenUsage.data.total_granted > 0) {
            const tokenUsed = Math.max(0, tokenUsage.data.total_used || 0);
            pct = Math.min(100, Math.max(0, Math.round((tokenUsed / tokenUsage.data.total_granted) * 100)));
          } else if (hardLimit > 0) {
            pct = Math.min(100, Math.max(0, Math.round((usedCNYNum / hardLimit) * 100)));
          }
          billingState.subUsedPercent = pct;
          const remainDays = Math.max(1, Math.ceil((subData.access_until - nowSec) / 86400));
          billingState.remainDays = remainDays;
        } else {
          billingState.remainDays = 0;
        }
      }

      saveBillingCache(billingState);
    } catch (e) {
      console.warn('[WineToken Client] Billing update failed:', e);
    } finally {
      billingState.isFetching = false;
      notify();
    }
  }

  // 初始化定时轮询 (合理设为 120 秒，避免频繁请求触发限流)
  updateBilling();
  const billingTimer = setInterval(updateBilling, 120000);
  if (billingTimer && typeof billingTimer.unref === 'function') {
    billingTimer.unref();
  }

  // 窗口聚焦时按需刷新
  if (typeof window !== 'undefined') {
    window.addEventListener('focus', () => {
      updateBilling();
    });
  }

  // 注入轻量旋转动画
  if (typeof document !== 'undefined') {
    try {
      if (!document.getElementById('winetoken-studio-keyframes')) {
        const styleEl = document.createElement('style');
        styleEl.id = 'winetoken-studio-keyframes';
        styleEl.textContent = '@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }';
        document.head.appendChild(styleEl);
      }
    } catch (_) {}
  }

  // DataURL 转标准 File 对象 (用于将工坊图片挂载到 DSH 对话框 / multipart 上传)
  function dataURLtoFile(dataurl, filename = 'artwork.png') {
    try {
      const arr = dataurl.split(',');
      const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/png';
      const bstr = atob(arr[1]);
      let n = bstr.length;
      const u8arr = new Uint8Array(n);
      while (n--) u8arr[n] = bstr.charCodeAt(n);
      if (typeof File !== 'undefined') {
        return new File([u8arr], filename, { type: mime });
      }
      if (typeof Blob !== 'undefined') {
        const b = new Blob([u8arr], { type: mime });
        b.name = filename;
        return b;
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  // xAI 生图比例对齐预设与算法
  const XAI_RATIOS = [
    { label: '1:1', v: 1 }, { label: '9:16', v: 9 / 16 }, { label: '16:9', v: 16 / 9 },
    { label: '3:4', v: 3 / 4 }, { label: '4:3', v: 4 / 3 }, { label: '2:3', v: 2 / 3 },
    { label: '3:2', v: 3 / 2 }, { label: '21:9', v: 21 / 9 }, { label: '5:2', v: 5 / 2 }
  ];
  const snapAspectRatio = (sizeStr) => {
    try {
      const parts = String(sizeStr).toLowerCase().split('x');
      const w = Number(parts[0]);
      const hgt = Number(parts[1]);
      if (!w || !hgt) return '1:1';
      const r = w / hgt;
      let best = '1:1';
      let bestDiff = Infinity;
      for (const it of XAI_RATIOS) {
        const d = Math.abs(Math.log(r) - Math.log(it.v));
        if (d < bestDiff) { bestDiff = d; best = it.label; }
      }
      return best;
    } catch (_) { return '1:1'; }
  };

  // 校验模型是否支持垫图改图 (支持 sensenova-* 与 gpt-image-*)
  function validateImageModelSupport(model, hasReference) {
    if (!hasReference) return { supported: true, protocol: 'generations' };
    const m = String(model || '').toLowerCase();
    if (m.includes('sensenova')) return { supported: true, protocol: 'sensenova-edits' };
    if (m.includes('gpt-image')) return { supported: true, protocol: 'openai-multipart-edits' };
    return {
      supported: false,
      error: '当前模型不支持垫图改图，请切换 sensenova 或 gpt-image 模型，或清空参考图'
    };
  }

  // 构建生图 / 垫图改图标准请求 (严格按协议路由，杜绝往 generations 塞图)
  function buildImageRequest({
    baseUrl = BASE_URL,
    apiKey,
    model,
    prompt,
    size,
    n = 1,
    referenceSlots = []
  }) {
    const hasRef = Array.isArray(referenceSlots) && referenceSlots.length > 0;
    const cleanBase = (baseUrl || '').trim().replace(/\/+$/, '');

    if (hasRef) {
      const check = validateImageModelSupport(model, true);
      if (!check.supported) {
        throw new Error(check.error);
      }

      // 1. 商汤 sensenova-*: JSON 格式 edits (POST /v1/images/edits, Content-Type: application/json, watermark=false)
      if (check.protocol === 'sensenova-edits') {
        const images = referenceSlots.slice(0, 5).map(s => {
          const imgUrl = (typeof s === 'string') ? s : (s.dataUrl || s.url || '');
          return { image_url: imgUrl };
        });
        const editPayload = {
          model,
          prompt,
          images,
          size: size || 'auto',
          n: n || 1,
          response_format: 'url',
          watermark: false
        };
        return {
          url: `${cleanBase}/v1/images/edits`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(apiKey ? { 'Authorization': 'Bearer ' + apiKey } : {})
          },
          body: JSON.stringify(editPayload),
          isMultipart: false,
          payload: editPayload
        };
      }

      // 2. 环灵 gpt-image-*: OpenAI 标准 multipart/form-data edits
      if (check.protocol === 'openai-multipart-edits') {
        const formData = new FormData();
        formData.append('model', model);
        formData.append('prompt', prompt);
        formData.append('n', String(n || 1));
        if (size) formData.append('size', size);
        formData.append('response_format', 'url');

        // 多张时按 OpenAI 规范首张为主图并注入重复 image 字段 (上限 5 张)
        referenceSlots.slice(0, 5).forEach((slot, i) => {
          const rawUrl = (typeof slot === 'string') ? slot : (slot.dataUrl || slot.url || '');
          if (rawUrl && rawUrl.startsWith('data:')) {
            const file = dataURLtoFile(rawUrl, `reference_${i + 1}.png`);
            if (file) {
              formData.append('image', file, `reference_${i + 1}.png`);
            }
          } else if (rawUrl) {
            formData.append('image_url', rawUrl);
          }
        });

        return {
          url: `${cleanBase}/v1/images/edits`,
          method: 'POST',
          headers: {
            ...(apiKey ? { 'Authorization': 'Bearer ' + apiKey } : {})
          },
          body: formData,
          isMultipart: true
        };
      }
    }

    // 3. 无垫图: 纯文生图走 POST /v1/images/generations (坚决彻底剔除任何图像字段)
    const genPayload = {
      model,
      prompt,
      n: n || 1,
      size,
      response_format: 'url'
    };
    if (/grok-imagine-image/i.test(model)) {
      delete genPayload.size;
      genPayload.aspect_ratio = snapAspectRatio(size);
    }

    return {
      url: `${cleanBase}/v1/images/generations`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'Authorization': 'Bearer ' + apiKey } : {})
      },
      body: JSON.stringify(genPayload),
      isMultipart: false,
      payload: genPayload
    };
  }

  // 发送生图 / 垫图请求
  async function sendImageRequest({
    baseUrl = BASE_URL,
    apiKey,
    model,
    prompt,
    size,
    n = 1,
    referenceSlots = [],
    fetchFn = (typeof fetch !== 'undefined' ? fetch : null)
  }) {
    if (!fetchFn) throw new Error('全局 fetch 未就绪');
    const req = buildImageRequest({ baseUrl, apiKey, model, prompt, size, n, referenceSlots });
    const res = await fetchFn(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body
    });
    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.error?.message || `HTTP ${res.status}`);
    }
    return await res.json();
  }

  // 统一创建工坊创作历史项 (强制注入唯一 ID 与 createdAt，杜绝串图)
  function createStudioHistoryItem({ url, prompt, model, size, hasRef, type = 'image', duration }) {
    const prefix = type === 'video' ? 'vid_' : 'img_';
    return {
      id: prefix + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      createdAt: Date.now(),
      url,
      prompt: (prompt || '').trim(),
      model,
      size,
      hasRef: Boolean(hasRef),
      ...(type === 'video' ? { type: 'video', duration } : {}),
      time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    };
  }

  // 纯函数更新历史条目的本地物理路径 (严格按 ID 匹配，杜绝 undefined===undefined 全量串线覆盖)
  function updateHistoryLocalPath(historyList, targetItem, localPath) {
    if (!Array.isArray(historyList) || !targetItem) return historyList || [];
    return historyList.map(x => {
      const isMatch = (targetItem.id && x.id)
        ? (x.id === targetItem.id)
        : (Boolean(targetItem.url && x.url) && x.url === targetItem.url);
      return isMatch ? { ...x, localPath } : x;
    });
  }

  // 官方标准 ModuleLoader 注册
  if (typeof window !== 'undefined' && window.__ModuleLoader__) {
    window.__ModuleLoader__.load({
      id: '@winetoken/dsh-plugin-winetoken',
      factory(require) {
        const React = require('react');
        const h = React.createElement;

        // 全局主题设计 Tokens (方案 C：全链路黑白双模式自适应)
        const THEME_DARK = {
          isDark: true,
          bgMain: '#0d0d0f',
          bgHeader: '#121215',
          bgSidebar: '#131316',
          bgCard: '#18181c',
          bgCardSubtle: 'rgba(255, 255, 255, 0.03)',
          bgInput: '#1b1b1f',
          bgStage: '#0d0d0f', // 展台深色基底
          borderSubtle: 'rgba(255, 255, 255, 0.07)',
          borderStrong: 'rgba(255, 255, 255, 0.12)',
          textPrimary: '#ffffff',
          textSecondary: '#a1a1aa',
          textMuted: '#71717a',
          textPlaceholder: 'rgba(255, 255, 255, 0.35)',
          btnPrimaryBg: '#ffffff',
          btnPrimaryText: '#000000',
          btnDisabledBg: '#27272a',
          btnDisabledText: '#71717a',
          chipActiveBg: '#27272a',
          chipActiveText: '#ffffff',
          chipNormalBg: 'rgba(255, 255, 255, 0.03)',
          chipNormalBorder: 'rgba(255, 255, 255, 0.07)',
          chipNormalText: '#a1a1aa',
          popoverBg: '#121215',
          popoverBorder: 'rgba(255, 255, 255, 0.12)',
          popoverShadow: '0 16px 40px rgba(0, 0, 0, 0.75), 0 0 1px rgba(255, 255, 255, 0.2)',
          popoverInputBg: 'rgba(0, 0, 0, 0.4)',
          popoverCodeBg: 'rgba(0, 0, 0, 0.25)',
          floatingBarBg: 'rgba(24, 24, 27, 0.92)',
          floatingBarBorder: 'rgba(255, 255, 255, 0.12)',
          imgBorder: 'rgba(255, 255, 255, 0.1)',
          imgSelectedBorder: '#ffffff',
          emptyBoxBg: 'rgba(255, 255, 255, 0.03)',
          emptyBoxBorder: 'rgba(255, 255, 255, 0.06)'
        };

        const THEME_LIGHT = {
          isDark: false,
          bgMain: '#f9fafb',
          bgHeader: '#ffffff',
          bgSidebar: '#ffffff',
          bgCard: '#f3f4f6',
          bgCardSubtle: 'rgba(0, 0, 0, 0.02)',
          bgInput: '#ffffff',
          bgStage: '#f3f4f6', // 方案 C：展台同步自适应为现代高雅浅灰展台
          borderSubtle: 'rgba(0, 0, 0, 0.08)',
          borderStrong: 'rgba(0, 0, 0, 0.15)',
          textPrimary: '#111827',
          textSecondary: '#4b5563',
          textMuted: '#9ca3af',
          textPlaceholder: 'rgba(0, 0, 0, 0.35)',
          btnPrimaryBg: '#111827',
          btnPrimaryText: '#ffffff',
          btnDisabledBg: '#e5e7eb',
          btnDisabledText: '#9ca3af',
          chipActiveBg: '#ffffff',
          chipActiveText: '#111827',
          chipNormalBg: 'rgba(0, 0, 0, 0.03)',
          chipNormalBorder: 'rgba(0, 0, 0, 0.08)',
          chipNormalText: '#4b5563',
          popoverBg: '#ffffff',
          popoverBorder: 'rgba(0, 0, 0, 0.12)',
          popoverShadow: '0 16px 36px rgba(0, 0, 0, 0.14), 0 1px 4px rgba(0, 0, 0, 0.06)',
          popoverInputBg: '#f9fafb',
          popoverCodeBg: 'rgba(0, 0, 0, 0.04)',
          floatingBarBg: 'rgba(255, 255, 255, 0.94)',
          floatingBarBorder: 'rgba(0, 0, 0, 0.12)',
          imgBorder: 'rgba(0, 0, 0, 0.12)',
          imgSelectedBorder: '#111827',
          emptyBoxBg: 'rgba(0, 0, 0, 0.03)',
          emptyBoxBorder: 'rgba(0, 0, 0, 0.08)'
        };

        // 响应式黑白主题感知 Hook
        function useTheme() {
          const [isDark, setIsDark] = React.useState(() => {
            if (typeof document === 'undefined') return true;
            const cls = (document.documentElement.className || '') + ' ' + (document.body?.className || '');
            if (cls.includes('light') || cls.includes('vscode-light')) return false;
            if (cls.includes('dark') || cls.includes('vscode-dark')) return true;
            const docTheme = document.documentElement.getAttribute('data-theme');
            if (docTheme === 'light') return false;
            if (docTheme === 'dark') return true;
            if (typeof window !== 'undefined' && window.matchMedia) {
              return window.matchMedia('(prefers-color-scheme: dark)').matches;
            }
            return true;
          });

          React.useEffect(() => {
            if (typeof document === 'undefined') return;

            const checkTheme = () => {
              const cls = (document.documentElement.className || '') + ' ' + (document.body?.className || '');
              let dark = true;
              if (cls.includes('light') || cls.includes('vscode-light')) dark = false;
              else if (cls.includes('dark') || cls.includes('vscode-dark')) dark = true;
              else {
                const docTheme = document.documentElement.getAttribute('data-theme');
                if (docTheme === 'light') dark = false;
                else if (docTheme === 'dark') dark = true;
                else if (typeof window !== 'undefined' && window.matchMedia) {
                  dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                }
              }
              setIsDark(dark);
            };

            const observer = new MutationObserver(checkTheme);
            observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
            if (document.body) {
              observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'data-theme'] });
            }

            let mediaQuery = null;
            if (typeof window !== 'undefined' && window.matchMedia) {
              mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
              try { mediaQuery.addEventListener('change', checkTheme); } catch (_) {
                try { mediaQuery.addListener(checkTheme); } catch (_) {}
              }
            }

            return () => {
              observer.disconnect();
              if (mediaQuery) {
                try { mediaQuery.removeEventListener('change', checkTheme); } catch (_) {
                  try { mediaQuery.removeListener(checkTheme); } catch (_) {}
                }
              }
            };
          }, []);

          return isDark ? THEME_DARK : THEME_LIGHT;
        }

        // 窄屏/移动端感知 Hook：≤640px 视口视为手机布局（matchMedia 监听，旋转/分屏实时响应）
        function useNarrowViewport(breakpoint = 640) {
          const query = (typeof window !== 'undefined' && window.matchMedia)
            ? window.matchMedia('(max-width: ' + breakpoint + 'px)')
            : null;
          const [isNarrow, setIsNarrow] = React.useState(() => (query ? query.matches : false));
          React.useEffect(() => {
            if (!query) return undefined;
            const onChange = (e) => setIsNarrow(e.matches);
            try { query.addEventListener('change', onChange); } catch (_) {
              try { query.addListener(onChange); } catch (_) {}
            }
            setIsNarrow(query.matches);
            return () => {
              try { query.removeEventListener('change', onChange); } catch (_) {
                try { query.removeListener(onChange); } catch (_) {}
              }
            };
          }, [query]);
          return isNarrow;
        }

        // 极简现代单色 SVG 图标集 (彻底去表情，全量采用 16px/18px 矢量)
        function Icon({ name, size = 16, style = {} }) {
          const icons = {
            palette: [
              h('circle', { key: 'c1', cx: '13.5', cy: '6.5', r: '.5', fill: 'currentColor' }),
              h('circle', { key: 'c2', cx: '17.5', cy: '10.5', r: '.5', fill: 'currentColor' }),
              h('circle', { key: 'c3', cx: '8.5', cy: '7.5', r: '.5', fill: 'currentColor' }),
              h('circle', { key: 'c4', cx: '6.5', cy: '12.5', r: '.5', fill: 'currentColor' }),
              h('path', { key: 'p1', d: 'M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z' })
            ],
            camera: [
              h('path', { key: 'p1', d: 'M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z' }),
              h('circle', { key: 'c1', cx: '12', cy: '13', r: '4' })
            ],
            video: [
              h('polygon', { key: 'pl', points: '23 7 16 12 23 17 23 7' }),
              h('rect', { key: 'rc', x: '1', y: '5', width: '15', height: '14', rx: '2', ry: '2' })
            ],
            sparkles: [
              h('path', { key: 'p1', d: 'm12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z' })
            ],
            arrowLeft: [
              h('line', { key: 'l1', x1: '19', x2: '5', y1: '12', y2: '12' }),
              h('polyline', { key: 'pl', points: '12 19 5 12 12 5' })
            ],
            download: [
              h('path', { key: 'p1', d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }),
              h('polyline', { key: 'pl', points: '7 10 12 15 17 10' }),
              h('line', { key: 'l1', x1: '12', x2: '12', y1: '15', y2: '3' })
            ],
            copy: [
              h('rect', { key: 'r1', width: '13', height: '13', x: '9', y: '9', rx: '2', ry: '2' }),
              h('path', { key: 'p1', d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' })
            ],
            refresh: [
              h('path', { key: 'p1', d: 'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8' }),
              h('path', { key: 'p2', d: 'M21 3v5h-5' }),
              h('path', { key: 'p3', d: 'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16' }),
              h('path', { key: 'p4', d: 'M8 16H3v5' })
            ],
            trash: [
              h('path', { key: 'p1', d: 'M3 6h18' }),
              h('path', { key: 'p2', d: 'M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6' }),
              h('path', { key: 'p3', d: 'M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2' })
            ],
            check: [
              h('polyline', { key: 'pl', points: '20 6 9 17 4 12' })
            ],
            ratio1_1: [
              h('rect', { key: 'r1', x: '4', y: '4', width: '16', height: '16', rx: '2' })
            ],
            ratio16_9: [
              h('rect', { key: 'r1', x: '2', y: '6', width: '20', height: '12', rx: '2' })
            ],
            ratio9_16: [
              h('rect', { key: 'r1', x: '6', y: '2', width: '12', height: '20', rx: '2' })
            ],
            wallet: [
              h('path', { key: 'p1', d: 'M21 12V7H5a2 2 0 0 1 0-4h14v4' }),
              h('path', { key: 'p2', d: 'M3 5v14a2 2 0 0 0 2 2h16v-5' }),
              h('path', { key: 'p3', d: 'M18 12a2 2 0 0 0 0 4h4v-4Z' })
            ],
            imageEmpty: [
              h('rect', { key: 'r1', width: '18', height: '18', x: '3', y: '3', rx: '2', ry: '2' }),
              h('circle', { key: 'c1', cx: '9', cy: '9', r: '2' }),
              h('path', { key: 'p1', d: 'm21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21' })
            ],
            upload: [
              h('path', { key: 'p1', d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }),
              h('polyline', { key: 'pl', points: '17 8 12 3 7 8' }),
              h('line', { key: 'l1', x1: '12', x2: '12', y1: '3', y2: '15' })
            ],
            close: [
              h('line', { key: 'l1', x1: '18', x2: '6', y1: '6', y2: '18' }),
              h('line', { key: 'l2', x1: '6', x2: '18', y1: '6', y2: '18' })
            ],
            spinner: [
              h('path', { key: 'p1', d: 'M21 12a9 9 0 1 1-6.219-8.56' })
            ],
            keyIcon: [
              h('circle', { key: 'c', cx: '7.5', cy: '15.5', r: '5.5' }),
              h('path', { key: 'p1', d: 'm21 2-9.6 9.6' }),
              h('path', { key: 'p2', d: 'm15.5 7.5 3 3L22 7l-2-2' })
            ],
            crown: [
              h('path', { key: 'p1', d: 'M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.768a1 1 0 0 1-.965.713H5.818a1 1 0 0 1-.965-.713L2.019 6.019a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z' })
            ],
            messageSquare: [
              h('path', { key: 'p1', d: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' })
            ],
            plus: [
              h('line', { key: 'l1', x1: '12', y1: '5', x2: '12', y2: '19' }),
              h('line', { key: 'l2', x1: '5', y1: '12', x2: '19', y2: '12' })
            ],
            grip: [
              h('circle', { key: 'c1', cx: '9', cy: '12', r: '1' }),
              h('circle', { key: 'c2', cx: '9', cy: '5', r: '1' }),
              h('circle', { key: 'c3', cx: '9', cy: '19', r: '1' }),
              h('circle', { key: 'c4', cx: '15', cy: '12', r: '1' }),
              h('circle', { key: 'c5', cx: '15', cy: '5', r: '1' }),
              h('circle', { key: 'c6', cx: '15', cy: '19', r: '1' })
            ],
            tag: [
              h('path', { key: 'p1', d: 'M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z' }),
              h('line', { key: 'l1', x1: '7', y1: '7', x2: '7.01', y2: '7' })
            ],
            edit: [
              h('path', { key: 'p1', d: 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7' }),
              h('path', { key: 'p2', d: 'M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z' })
            ],
            externalLink: [
              h('path', { key: 'p1', d: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' }),
              h('polyline', { key: 'pl', points: '15 3 21 3 21 9' }),
              h('line', { key: 'l1', x1: '10', y1: '14', x2: '21', y2: '3' })
            ],
            clock: [
              h('circle', { key: 'c1', cx: '12', cy: '12', r: '10' }),
              h('polyline', { key: 'p1', points: '12 6 12 12 16 14' })
            ],
            barChart: [
              h('line', { key: 'l1', x1: '12', x2: '12', y1: '20', y2: '10' }),
              h('line', { key: 'l2', x1: '18', x2: '18', y1: '20', y2: '4' }),
              h('line', { key: 'l3', x1: '6', x2: '6', y1: '20', y2: '16' })
            ],
            help: [
              h('circle', { key: 'c', cx: '12', cy: '12', r: '10' }),
              h('path', { key: 'p', d: 'M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3' }),
              h('line', { key: 'l', x1: '12', y1: '17', x2: '12.01', y2: '17' })
            ],
            canvas: [
              h('rect', { key: 'r', x: '3', y: '3', width: '18', height: '18', rx: '2' }),
              h('path', { key: 'p', d: 'M3 9h18M9 21V9' })
            ],
            plus: [
              h('line', { key: 'l1', x1: '12', y1: '5', x2: '12', y2: '19' }),
              h('line', { key: 'l2', x1: '5', y1: '12', x2: '19', y2: '12' })
            ],
            user: [
              h('path', { key: 'p1', d: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2' }),
              h('circle', { key: 'c1', cx: '12', cy: '7', r: '4' })
            ],
            link: [
              h('path', { key: 'p1', d: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71' }),
              h('path', { key: 'p2', d: 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71' })
            ],
            messageSquare: [
              h('path', { key: 'p1', d: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' })
            ],
            download: [
              h('path', { key: 'p1', d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }),
              h('polyline', { key: 'pl', points: '7 10 12 15 17 10' }),
              h('line', { key: 'l1', x1: '12', y1: '15', x2: '12', y2: '3' })
            ],
            folder: [
              h('path', { key: 'p1', d: 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z' })
            ],
            file: [
              h('path', { key: 'p1', d: 'M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z' }),
              h('polyline', { key: 'pl', points: '13 2 13 9 20 9' })
            ]
          };

          return h('svg', {
            width: size,
            height: size,
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 2,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            style: { display: 'inline-block', verticalAlign: 'middle', flexShrink: 0, ...style }
          }, icons[name] || []);
        }

        // 1. 左侧边栏导航图标 (Palette 单色矢量)
        function StudioNavIcon({ size = 16 }) {
          return h(Icon, { name: 'palette', size: size });
        }

        // 2. 原生账户与密钥管理中心 Popover
        function WineTokenAccountPopover({ onClose, positionTop = false }) {
          const theme = useTheme();
          const isNarrowViewport = useNarrowViewport();
          const [currentKey, setCurrentKey] = React.useState(getKey());
          const [keyInput, setKeyInput] = React.useState('');
          const [showKeyInput, setShowKeyInput] = React.useState(!currentKey);
          const [statusTip, setStatusTip] = React.useState('');
          const [copyTip, setCopyTip] = React.useState(false);
          const [billing, setBilling] = React.useState({ ...billingState });
          const popoverRef = React.useRef(null);

          React.useEffect(() => {
            const listener = (b) => setBilling(b);
            listeners.add(listener);
            return () => listeners.delete(listener);
          }, []);

          React.useEffect(() => {
            function handleKeyDown(e) {
              if (e.key === 'Escape') onClose();
            }
            function handleClickOutside(e) {
              if (popoverRef.current && !popoverRef.current.contains(e.target)) {
                onClose();
              }
            }
            window.addEventListener('keydown', handleKeyDown);
            document.addEventListener('mousedown', handleClickOutside);
            return () => {
              window.removeEventListener('keydown', handleKeyDown);
              document.removeEventListener('mousedown', handleClickOutside);
            };
          }, [onClose]);

          const maskedKey = currentKey
            ? (currentKey.length <= 6
                ? '******'
                : (currentKey.length <= 12
                    ? currentKey.slice(0, 2) + '····' + currentKey.slice(-2)
                    : currentKey.slice(0, 7) + '········' + currentKey.slice(-4)))
            : '未配置';

          const handleCopyKey = () => {
            try {
              if (typeof navigator !== 'undefined' && navigator.clipboard) {
                navigator.clipboard.writeText(currentKey);
                setCopyTip(true);
                setTimeout(() => setCopyTip(false), 1500);
              }
            } catch (_) {}
          };

          const handleSaveKey = async () => {
            const trimmed = keyInput.trim();
            if (!trimmed) {
              setStatusTip('请输入有效的 API Key');
              return;
            }
            const saveRes = await WineTokenCredentialBridge.saveKey(trimmed);
            if (saveRes && saveRes.success === false) {
              setStatusTip(`保存异常: ${saveRes.error || '写入失败'}`);
              return;
            }
            setCurrentKey(trimmed);
            setKeyInput('');
            setShowKeyInput(false);
            setStatusTip('正在连接并同步全局凭据...');
            await updateBilling();
            try {
              WineTokenManifestManager.fetchManifest(true);
            } catch (_) {}
            if (saveRes && saveRes.partial) {
              // 双通道皆不可达：客户端全链路已生效，明示官方对话通道受限，不再误报"保存异常"
              setStatusTip('已保存！工坊生图 / 生视频 / 漫剧画布 / 账单已全部生效；官方对话通道暂受桌面端限制 (' + (saveRes.warning || '无法写入系统凭据') + ')');
              setTimeout(() => setStatusTip(''), 6000);
            } else {
              setStatusTip('已保存！官方模型与生图工坊已全链路就绪');
              setTimeout(() => setStatusTip(''), 3000);
            }
          };

          const handleResetKey = async () => {
            await WineTokenCredentialBridge.clearKey();
            setCurrentKey(DEFAULT_KEY);
            setKeyInput('');
            setShowKeyInput(true);
            setStatusTip('已清空凭据，正在刷新...');
            await updateBilling();
            setStatusTip('已恢复未配置状态！');
            setTimeout(() => setStatusTip(''), 3000);
          };

          // 桌面端：锚定胶囊的绝对定位弹层；窄屏（手机）：切换为视口居中固定面板，杜绝越界出屏
          const popoverBase = {
            background: theme.popoverBg,
            border: `1px solid ${theme.popoverBorder}`,
            borderRadius: '12px',
            boxShadow: theme.popoverShadow,
            padding: '16px',
            zIndex: 999999,
            color: theme.textPrimary,
            fontSize: '12px',
            fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            userSelect: 'none',
            lineHeight: 1.5,
            cursor: 'default'
          };
          const popoverStyle = isNarrowViewport ? {
            ...popoverBase,
            position: 'fixed',
            left: '12px',
            right: '12px',
            top: '50%',
            bottom: 'auto',
            transform: 'translateY(-50%)',
            width: 'auto',
            maxWidth: 'none',
            maxHeight: '76vh',
            overflowY: 'auto',
            borderRadius: '16px',
            padding: '14px'
          } : {
            ...popoverBase,
            position: 'absolute',
            ...(positionTop ? { top: 'calc(100% + 8px)' } : { bottom: 'calc(100% + 10px)' }),
            right: 0,
            width: '320px'
          };

          return h('div', {
            ref: popoverRef,
            style: popoverStyle,
            onClick: (e) => e.stopPropagation()
          }, [
            // 头部
            h('div', {
              style: {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingBottom: '12px',
                borderBottom: `1px solid ${theme.borderSubtle}`,
                marginBottom: '12px'
              }
            }, [
              h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [
                h('div', {
                  style: {
                    width: '24px',
                    height: '24px',
                    borderRadius: '6px',
                    background: theme.isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.05)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: theme.textPrimary
                  }
                }, h(Icon, { name: 'palette', size: 14 })),
                h('span', { style: { fontWeight: '600', fontSize: '13px', color: theme.textPrimary } }, 'WineToken 账户中心'),
                h('span', {
                  style: {
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    background: '#22c55e',
                    boxShadow: '0 0 6px rgba(34, 197, 94, 0.8)'
                  }
                })
              ]),
              h('button', {
                type: 'button',
                style: {
                  background: 'transparent',
                  border: 'none',
                  color: theme.textMuted,
                  cursor: 'pointer',
                  padding: '4px',
                  display: 'flex',
                  alignItems: 'center'
                },
                onClick: onClose
              }, h(Icon, { name: 'close', size: 14 }))
            ]),

            // 资产与订阅总览卡片 (双账轨清晰分列，纯矢量无Emoji)
            h('div', {
              style: {
                background: theme.bgCardSubtle,
                border: `1px solid ${billing.isSuper ? (theme.isDark ? 'rgba(6, 182, 212, 0.35)' : 'rgba(8, 145, 178, 0.3)') : theme.borderSubtle}`,
                borderRadius: '8px',
                padding: '12px',
                marginBottom: '12px',
                boxShadow: billing.isSuper ? (theme.isDark ? '0 0 16px rgba(6, 182, 212, 0.08)' : '0 0 12px rgba(8, 145, 178, 0.06)') : 'none'
              }
            }, [
              // 分区 1A：若是 SUPER 会员，呈现专属青色特权卡片 (无额度限制，展示无限量免流与8折)
              billing.isSuper ? h('div', {
                style: {
                  marginBottom: '10px'
                }
              }, [
                h('div', {
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: '8px'
                  }
                }, [
                  h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } }, [
                    h(Icon, { name: 'crown', size: 14, style: { color: theme.isDark ? '#06b6d4' : '#0891b2' } }),
                    h('span', {
                      style: {
                        fontSize: '11px',
                        fontWeight: '700',
                        color: theme.isDark ? '#06b6d4' : '#0891b2',
                        letterSpacing: '0.4px'
                      }
                    }, 'SUPER 会员特权'),
                    h('span', {
                      style: {
                        fontSize: '9px',
                        color: theme.isDark ? '#22d3ee' : '#0e7490',
                        background: theme.isDark ? 'rgba(6, 182, 212, 0.15)' : 'rgba(8, 145, 178, 0.1)',
                        border: `1px solid ${theme.isDark ? 'rgba(6, 182, 212, 0.35)' : 'rgba(8, 145, 178, 0.3)'}`,
                        padding: '1px 5px',
                        borderRadius: '3px',
                        fontWeight: '600'
                      }
                    }, '8折特惠')
                  ]),
                  h('div', {
                    style: {
                      fontSize: '10px',
                      color: theme.isDark ? '#06b6d4' : '#0891b2',
                      opacity: 0.9,
                      fontWeight: '500'
                    }
                  }, '专属特权通道')
                ]),
                // SUPER 核心权益展台 (亮眼青色微光卡片)
                h('div', {
                  style: {
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                    padding: '8px 10px',
                    borderRadius: '6px',
                    background: theme.isDark ? 'rgba(6, 182, 212, 0.08)' : 'rgba(8, 145, 178, 0.05)',
                    border: `1px solid ${theme.isDark ? 'rgba(6, 182, 212, 0.22)' : 'rgba(8, 145, 178, 0.18)'}`
                  }
                }, [
                  h('div', {
                    style: {
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      fontSize: '11px',
                      fontWeight: '600',
                      color: theme.isDark ? '#22d3ee' : '#0891b2'
                    }
                  }, [
                    h('span', { style: { width: '5px', height: '5px', borderRadius: '50%', background: '#06b6d4', display: 'inline-block' } }),
                    h('span', {}, '无限量专属免费特权模型')
                  ]),
                  h('div', {
                    style: {
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      fontSize: '10.5px',
                      color: theme.textSecondary
                    }
                  }, [
                    h('span', { style: { width: '5px', height: '5px', borderRadius: '50%', background: '#06b6d4', opacity: 0.6, display: 'inline-block' } }),
                    h('span', {}, '全平台模型享 8 折特权')
                  ])
                ])
              ]) :
              // 分区 1B：若拥有活跃周期订阅，呈现专属限时额度与到期自动失效说明
              billing.hasSubscription ? h('div', {
                style: {
                  marginBottom: '10px'
                }
              }, [
                h('div', {
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: '6px'
                  }
                }, [
                  h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } }, [
                    h(Icon, { name: 'crown', size: 14, style: { color: theme.isDark ? '#f59e0b' : '#d97706' } }),
                    h('span', {
                      style: {
                        fontSize: '11px',
                        fontWeight: '600',
                        color: theme.isDark ? '#f59e0b' : '#d97706',
                        letterSpacing: '0.2px'
                      }
                    }, (billing.subGroup ? billing.subGroup.toUpperCase() : 'VIP') + ' 会员特权 · 限时额度'),
                    h('span', {
                      style: {
                        fontSize: '9px',
                        color: theme.textMuted,
                        border: `1px solid ${theme.borderSubtle}`,
                        padding: '0 4px',
                        borderRadius: '3px'
                      }
                    }, '优先扣费')
                  ]),
                  h('div', { style: { display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: theme.textMuted } }, [
                    h(Icon, { name: 'clock', size: 11 }),
                    h('span', {}, billing.remainDays ? `剩余 ${billing.remainDays} 天` : '有效')
                  ])
                ]),
                // 限时额度大数字展示
                h('div', {
                  style: {
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    marginBottom: '6px'
                  }
                }, [
                  h('div', {
                    style: {
                      fontSize: '20px',
                      fontWeight: '700',
                      color: theme.textPrimary,
                      letterSpacing: '-0.3px'
                    }
                  }, '¥ ' + formatCNY(billing.subRemainAmountCNY)),
                  h('div', {
                    style: {
                      fontSize: '11px',
                      color: theme.textMuted
                    }
                  }, `已用 ¥${formatCNY(billing.subAmountUsedCNY)} / 配额 ¥${formatCNY(billing.subAmountTotalCNY)}`)
                ]),
                // 极简纯单色线条进度条
                h('div', {
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }
                }, [
                  h('div', {
                    style: {
                      flex: 1,
                      height: '5px',
                      borderRadius: '3px',
                      background: theme.isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.08)',
                      overflow: 'hidden'
                    }
                  }, h('div', {
                    style: {
                      width: `${billing.subUsedPercent}%`,
                      height: '100%',
                      background: billing.subUsedPercent >= 90 ? '#ef4444' : (billing.subUsedPercent >= 75 ? '#f59e0b' : (theme.isDark ? '#ffffff' : '#111827')),
                      borderRadius: '3px',
                      transition: 'width 0.3s ease'
                    }
                  })),
                  h('span', {
                    style: {
                      fontSize: '10px',
                      fontFamily: 'monospace',
                      color: theme.textMuted,
                      minWidth: '28px',
                      textAlign: 'right'
                    }
                  }, `${billing.subUsedPercent}%`)
                ])
              ]) : null,

              // 分区 2：钱包永久保底余额
              h('div', {
                style: {
                  paddingTop: (billing.isSuper || billing.hasSubscription) ? '10px' : '0',
                  borderTop: (billing.isSuper || billing.hasSubscription) ? `1px dashed ${theme.borderSubtle}` : 'none',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }
              }, [
                h('div', {}, [
                  h('div', {
                    style: {
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px',
                      fontSize: '11px',
                      color: theme.textMuted
                    }
                  }, [
                    h(Icon, { name: 'wallet', size: 12, style: { opacity: 0.8 } }),
                    h('span', {}, '钱包永久余额'),
                    h('span', {
                      style: {
                        fontSize: '9px',
                        color: theme.textMuted,
                        border: `1px solid ${theme.borderSubtle}`,
                        padding: '0 4px',
                        borderRadius: '3px'
                      }
                    }, '永不过期')
                  ]),
                  h('div', {
                    style: {
                      fontSize: billing.hasSubscription ? '15px' : '20px',
                      fontWeight: '600',
                      color: theme.textPrimary,
                      marginTop: '3px'
                    }
                  }, '¥ ' + formatCNY(billing.walletBalanceCNY))
                ]),
                h('div', { style: { textAlign: 'right' } }, [
                  h('div', {
                    style: {
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'flex-end',
                      gap: '4px',
                      fontSize: '11px',
                      color: theme.textMuted
                    }
                  }, [
                    h(Icon, { name: 'barChart', size: 11, style: { opacity: 0.8 } }),
                    h('span', {}, '总累计调用')
                  ]),
                  h('div', {
                    style: {
                      fontSize: '13px',
                      fontWeight: '500',
                      color: theme.textSecondary,
                      marginTop: '3px'
                    }
                  }, '¥ ' + formatCNY(billing.totalUsedCNY != null ? billing.totalUsedCNY : 0)),
                  billing.tokenUsedCNY != null && billing.tokenUsedCNY !== billing.totalUsedCNY ? h('div', {
                    style: {
                      fontSize: '10px',
                      color: theme.textMuted,
                      opacity: 0.8,
                      marginTop: '2px'
                    }
                  }, `(本Key: ¥${formatCNY(billing.tokenUsedCNY)})`) : null
                ])
              ])
            ]),

            // API 密钥管理卡片
            h('div', {
              style: {
                background: theme.bgCardSubtle,
                border: `1px solid ${theme.borderSubtle}`,
                borderRadius: '8px',
                padding: '12px',
                marginBottom: '12px'
              }
            }, [
              h('div', {
                style: {
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: showKeyInput ? '10px' : '0'
                }
              }, [
                h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } }, [
                  h(Icon, { name: 'keyIcon', size: 13, style: { opacity: 0.7 } }),
                  h('span', { style: { fontSize: '11px', color: theme.textMuted } }, 'API 密钥')
                ]),
                !showKeyInput && h('div', { style: { display: 'flex', gap: '8px' } }, [
                  h('button', {
                    type: 'button',
                    style: {
                      background: 'transparent',
                      border: 'none',
                      color: theme.textSecondary,
                      cursor: 'pointer',
                      fontSize: '11px',
                      padding: 0
                    },
                    onClick: handleCopyKey
                  }, copyTip ? '已复制！' : '复制'),
                  h('button', {
                    type: 'button',
                    style: {
                      background: 'transparent',
                      border: 'none',
                      color: theme.textPrimary,
                      cursor: 'pointer',
                      fontSize: '11px',
                      fontWeight: '600',
                      padding: 0
                    },
                    onClick: () => setShowKeyInput(true)
                  }, '更换 Key')
                ])
              ]),

              !showKeyInput ? h('div', {
                style: {
                  marginTop: '6px',
                  fontFamily: 'monospace',
                  fontSize: '11px',
                  color: theme.textSecondary,
                  background: theme.popoverCodeBg,
                  padding: '6px 8px',
                  borderRadius: '4px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }
              }, maskedKey) : h('div', {}, [
                !currentKey && h('div', {
                  style: {
                    fontSize: '11px',
                    color: theme.isDark ? '#38bdf8' : '#0284c7',
                    background: theme.isDark ? 'rgba(56, 189, 248, 0.1)' : 'rgba(2, 132, 199, 0.08)',
                    border: `1px solid ${theme.isDark ? 'rgba(56, 189, 248, 0.2)' : 'rgba(2, 132, 199, 0.2)'}`,
                    padding: '6px 8px',
                    borderRadius: '4px',
                    marginBottom: '8px',
                    lineHeight: 1.4
                  }
                }, '欢迎使用 WineToken！配置 API Key 后，DSH 官方模型与生图工坊将全链路自动同步激活。'),
                h('input', {
                  type: 'text',
                  placeholder: currentKey ? '粘贴新的 sk-... 密钥' : '请粘贴您的 WineToken sk-... 密钥',
                  value: keyInput,
                  onChange: (e) => setKeyInput(e.target.value),
                  style: {
                    width: '100%',
                    boxSizing: 'border-box',
                    background: theme.popoverInputBg,
                    border: `1px solid ${theme.borderStrong}`,
                    borderRadius: '6px',
                    padding: '8px 10px',
                    color: theme.textPrimary,
                    fontSize: '11px',
                    fontFamily: 'monospace',
                    outline: 'none',
                    marginBottom: '8px'
                  }
                }),
                h('div', { style: { display: 'flex', gap: '6px', justifyContent: 'flex-end' } }, [
                  currentKey && h('button', {
                    type: 'button',
                    style: {
                      background: 'transparent',
                      border: `1px solid ${theme.borderSubtle}`,
                      borderRadius: '4px',
                      color: theme.textMuted,
                      fontSize: '11px',
                      padding: '4px 8px',
                      cursor: 'pointer'
                    },
                    onClick: handleResetKey
                  }, '清空凭据'),
                  h('button', {
                    type: 'button',
                    style: {
                      background: 'transparent',
                      border: `1px solid ${theme.borderSubtle}`,
                      borderRadius: '4px',
                      color: theme.textMuted,
                      fontSize: '11px',
                      padding: '4px 8px',
                      cursor: 'pointer'
                    },
                    onClick: () => {
                      if (!currentKey) {
                        onClose();
                      } else {
                        setShowKeyInput(false);
                        setKeyInput('');
                      }
                    }
                  }, '取消'),
                  h('button', {
                    type: 'button',
                    style: {
                      background: theme.btnPrimaryBg,
                      border: 'none',
                      borderRadius: '4px',
                      color: theme.btnPrimaryText,
                      fontWeight: '600',
                      fontSize: '11px',
                      padding: '4px 10px',
                      cursor: 'pointer'
                    },
                    onClick: handleSaveKey
                  }, '保存并连接')
                ])
              ]),

              statusTip && h('div', {
                style: {
                  marginTop: '6px',
                  fontSize: '11px',
                  color: statusTip.includes('成功') ? '#22c55e' : '#f59e0b'
                }
              }, statusTip)
            ]),

            // 底部操作区
            h('div', {
              style: {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingTop: '6px'
              }
            }, [
              h('button', {
                type: 'button',
                style: {
                  background: 'transparent',
                  border: 'none',
                  color: theme.textSecondary,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  fontSize: '11px',
                  padding: '4px 0'
                },
                onClick: () => {
                  setStatusTip('正在刷新...');
                  updateBilling().then(() => {
                    setStatusTip('刷新完成！');
                    setTimeout(() => setStatusTip(''), 2000);
                  });
                }
              }, [
                h(Icon, { name: 'refresh', size: 12 }),
                h('span', {}, '立即刷新')
              ]),
              h('button', {
                type: 'button',
                style: {
                  background: 'transparent',
                  border: 'none',
                  color: theme.textPrimary,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '11px',
                  fontWeight: '600',
                  padding: '4px 0'
                },
                onClick: () => {
                  try {
                    if (typeof window !== 'undefined') {
                      window.open('https://www.winetoken.asia', '_blank');
                    }
                  } catch (_) {}
                }
              }, [
                h('span', {}, '前往 Token 控制台'),
                h(Icon, { name: 'externalLink', size: 11 })
              ])
            ])
          ]);
        }

        // ==========================================
        // 3. 漫剧 AI 画布 (Canvas) 底层双轨存储驱动
        // ==========================================
        const CANVAS_TUTORIAL_SEEN_KEY = 'WINETOKEN_CANVAS_TUTORIAL_SEEN_V1';

        const CanvasStorage = {
          getTutorialDismissed() {
            try {
              if (typeof localStorage !== 'undefined') {
                const val = localStorage.getItem(CANVAS_TUTORIAL_SEEN_KEY);
                if (val !== null) return val === 'true';
              }
            } catch (_) {}
            try {
              const fs = require('fs');
              const path = require('path');
              const os = require('os');
              const cfgFile = path.join(os.homedir(), '.dsh', 'storages', 'winetoken_canvas_config.json');
              if (fs.existsSync(cfgFile)) {
                const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
                return Boolean(cfg.tutorialDismissed);
              }
            } catch (_) {}
            return false;
          },
          setTutorialDismissed(dismissed) {
            const flag = Boolean(dismissed);
            try {
              if (typeof localStorage !== 'undefined') {
                localStorage.setItem(CANVAS_TUTORIAL_SEEN_KEY, flag ? 'true' : 'false');
              }
            } catch (_) {}
            try {
              const fs = require('fs');
              const path = require('path');
              const os = require('os');
              const dir = path.join(os.homedir(), '.dsh', 'storages');
              if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
              const cfgFile = path.join(dir, 'winetoken_canvas_config.json');
              let cfg = {};
              if (fs.existsSync(cfgFile)) {
                try { cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8')); } catch (_) {}
              }
              cfg.tutorialDismissed = flag;
              cfg.lastUpdated = new Date().toISOString();
              fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2), 'utf8');
            } catch (_) {}
          }
        };

        // ==========================================
        // 4. 交互式探照灯新手引导组件 (零 Emoji 工业风)
        // ==========================================
        function CanvasOnboardingTutorial({ isOpen, onClose }) {
          const theme = useTheme();
          const [step, setStep] = React.useState(0);
          const [dontShowAgain, setDontShowAgain] = React.useState(false);
          const [targetRect, setTargetRect] = React.useState(null);

          const STEPS = [
            {
              badge: '01 / 06',
              tag: '视口操控',
              targetSelector: '#winetoken-canvas-viewport',
              title: '无限画布 · 平移缩放与适应视图',
              desc: '专为漫剧多镜头排布打造的高帧率无限画板，支持全局全景鸟瞰与微距细节精修。',
              tips: [
                { key: 'Ctrl + 滚轮 / 触控板捏合', text: '以光标为中心定点缩放 (20% ~ 300%)' },
                { key: '滚轮 / Shift+滚轮 / Space+拖拽 / 中键', text: '画布平移 (纵向 / 横向 / 自由漫游)' },
                { key: 'V / H', text: '切换选择工具与抓手工具' },
                { key: 'Ctrl + 0 或工具栏「适应」', text: '适应画布，一键总览全部内容' }
              ]
            },
            {
              badge: '02 / 06',
              tag: '选择与批量',
              targetSelector: '#winetoken-canvas-panels-area',
              title: '选择集 · 框选多选与批量操作',
              desc: '像专业画板一样整批调度分镜：框选、加选、整组移动、批量删除，一步到位。',
              tips: [
                { key: '空白处按下拖拽', text: '橡皮筋框选批量选中分镜卡' },
                { key: 'Shift + 点击', text: '加选 / 减选单个分镜' },
                { key: '拖动选中集任一卡', text: '整组批量移动 (8px 磁吸 + 对齐参考线自动吸附)' },
                { key: 'Ctrl/Alt + G · Alt + Shift + F', text: '成组管理；一键整理画布自动布局并适应视图' },
                { key: 'Del / Ctrl + A / Ctrl + Z', text: '批量删除 / 全选分镜 / 撤销重做' }
              ]
            },
            {
              badge: '03 / 06',
              tag: '节点与连线',
              targetSelector: '#winetoken-canvas-items-area',
              title: '万物皆节点 · 生成图落画布与自由连线',
              desc: '生成的每一张图都会作为独立节点落在画布上并自动连到源分镜；节点之间可自由连线表达创作关系。',
              tips: [
                { key: 'Tab / 右键空白处', text: '呼出新建节点菜单 (分镜 / 角色 / 图片 / 文本)' },
                { key: '拖动节点上的绿色锚点', text: '拖出连线到目标节点；Ctrl+L 进入连续连线模式' },
                { key: 'Ctrl + D / Alt + 拖动', text: '复制节点和连线 / 快速克隆节点' },
                { key: '点击连线再按 Del', text: '删除连线；Esc 退出连线模式' }
              ]
            },
            {
              badge: '04 / 06',
              tag: '角色定妆',
              targetSelector: '#winetoken-canvas-char-deck',
              title: '角色锚点 · 连线锁定五官与画风',
              desc: '在左侧建立主角定妆卡，设定外貌特征词与定妆照，拖出连线赋予分镜格，跨镜头绝不崩脸。',
              tips: [
                { key: '角色定妆卡', text: '配置主角外貌特征 DNA 标签与标准三视图' },
                { key: '锚点贝塞尔连线', text: '点击或按住连接点，直接绑定至目标分镜卡' },
                { key: '多镜头特征流转', text: '多分镜复用同一角色，模型自动注入一致性设定' }
              ]
            },
            {
              badge: '05 / 06',
              tag: '分镜出图',
              targetSelector: '#winetoken-canvas-panels-area',
              title: '景别运镜 · 对白气泡与条漫拼版',
              desc: '一键切换特写/中景/全景镜头，输入台词自动生成漫画气泡，一键无损拼版导出 1080P 条漫。',
              tips: [
                { key: '标准景别切换', text: '特写 CU、中景 MS、全景 WS 一键注入运镜提示词' },
                { key: '矢量漫画对白', text: '输入角色台词，自动排布标准漫画对白气泡框' },
                { key: 'Ctrl + Enter (选中分镜)', text: '批量生成所选分镜；生成图自动落画布' }
              ]
            },
            {
              badge: '06 / 06',
              tag: '进阶能力',
              targetSelector: '#winetoken-canvas-items-area',
              title: '多工程 · 视频节点 · 提示词库 · 画布助手',
              desc: '画布对标无限画布工作台：工程可切换与导入导出，连线驱动生成，视频节点、提示词库与大模型画布工具协同。',
              tips: [
                { key: '多工程', text: '顶栏可新建/切换/重命名工程，导出 .wtcanvas.json 后再导入' },
                { key: '连线即输入', text: '把图片或文本节点连到分镜，自动成为参考图与提示词补充' },
                { key: '视频节点 / 重跑', text: 'Tab 新建视频节点，点击「重跑」生成，可随时取消轮询' },
                { key: '提示词库', text: '右下「提示词」收藏选中节点提示词，随时搜索复用' },
                { key: '小地图', text: '右下「小地图」开关，点击或拖拽可快速定位视口' },
                { key: '对话协作', text: '聊天中可让大模型读取故事板、追加分镜或排队生成' }
              ]
            }
          ];

          React.useEffect(() => {
            if (!isOpen) return;
            const current = STEPS[step];
            if (current && current.targetSelector) {
              const el = document.querySelector(current.targetSelector);
              if (el) {
                const r = el.getBoundingClientRect();
                setTargetRect({ left: r.left, top: r.top, width: r.width, height: r.height });
                return;
              }
            }
            setTargetRect(null);
          }, [isOpen, step]);

          React.useEffect(() => {
            if (!isOpen) return;
            const onKeyDown = (e) => {
              if (e.key === 'Escape') handleClose();
            };
            window.addEventListener('keydown', onKeyDown);
            return () => window.removeEventListener('keydown', onKeyDown);
          }, [isOpen, dontShowAgain]);

          if (!isOpen) return null;

          const current = STEPS[step];
          const isFirst = step === 0;
          const isLast = step === STEPS.length - 1;

          const handleClose = () => {
            if (dontShowAgain) CanvasStorage.setTutorialDismissed(true);
            onClose();
          };

          const handleNext = () => {
            if (isLast) handleClose();
            else setStep(s => s + 1);
          };

          const handlePrev = () => {
            if (!isFirst) setStep(s => s - 1);
          };

          // SVG 探照灯抠孔遮罩
          const renderMask = () => {
            const vw = typeof window !== 'undefined' ? window.innerWidth : 1920;
            const vh = typeof window !== 'undefined' ? window.innerHeight : 1080;
            if (!targetRect) {
              return h('path', { d: `M 0 0 H ${vw} V ${vh} H 0 Z`, fill: 'rgba(0, 0, 0, 0.65)' });
            }
            const pad = 8;
            const r = 10;
            const x = Math.max(0, targetRect.left - pad);
            const y = Math.max(0, targetRect.top - pad);
            const w = targetRect.width + pad * 2;
            const hVal = targetRect.height + pad * 2;

            const pathD = [
              `M 0 0 H ${vw} V ${vh} H 0 Z`,
              `M ${x + r} ${y}`,
              `H ${x + w - r}`,
              `A ${r} ${r} 0 0 1 ${x + w} ${y + r}`,
              `V ${y + hVal - r}`,
              `A ${r} ${r} 0 0 1 ${x + w - r} ${y + hVal}`,
              `H ${x + r}`,
              `A ${r} ${r} 0 0 1 ${x} ${y + hVal - r}`,
              `V ${y + r}`,
              `A ${r} ${r} 0 0 1 ${x + r} ${y}`,
              `Z`
            ].join(' ');

            return h('path', { d: pathD, fill: 'rgba(0, 0, 0, 0.65)', fillRule: 'evenodd' });
          };

          // 卡片自适应位置
          const getCardStyle = () => {
            if (!targetRect) {
              return { position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
            }
            const vh = window.innerHeight;
            const vw = window.innerWidth;
            // 窄屏钳制：卡片按视口收缩，避免手机上左边界钳制公式失效导致越界（样式层另有 92vw 兜底）
            const cardW = Math.min(480, Math.max(200, vw - 40));
            const cardH = 320;

            let left = targetRect.left + (targetRect.width - cardW) / 2;
            left = Math.max(20, Math.min(vw - cardW - 20, left));

            let top = targetRect.top + targetRect.height + 16;
            if (top + cardH > vh - 20) {
              top = targetRect.top - cardH - 16;
            }
            top = Math.max(20, Math.min(vh - cardH - 20, top));

            return { position: 'fixed', left: `${left}px`, top: `${top}px` };
          };

          return h('div', {
            style: { position: 'fixed', inset: 0, zIndex: 9999 }
          }, [
            h('svg', {
              key: 'mask-svg',
              style: { position: 'fixed', inset: 0, width: '100%', height: '100%' },
              onClick: handleClose
            }, [renderMask()]),

            h('div', {
              key: 'card',
              style: {
                ...getCardStyle(),
                width: '480px',
                maxWidth: '92vw',
                backgroundColor: theme.popoverBg,
                border: `1px solid ${theme.popoverBorder}`,
                borderRadius: '12px',
                boxShadow: '0 20px 45px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.08)',
                zIndex: 10000,
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                userSelect: 'none'
              },
              onClick: (e) => e.stopPropagation()
            }, [
              h('div', {
                style: {
                  padding: '12px 18px',
                  borderBottom: `1px solid ${theme.chipNormalBorder}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }
              }, [
                h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [
                  h('span', {
                    style: {
                      fontSize: '11px',
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: '4px',
                      backgroundColor: theme.isDark ? 'rgba(34, 197, 94, 0.15)' : 'rgba(34, 197, 94, 0.1)',
                      color: '#22c55e',
                      border: '1px solid rgba(34, 197, 94, 0.3)'
                    }
                  }, current.badge),
                  h('span', { style: { fontSize: '12px', color: theme.textMuted, fontWeight: 500 } }, current.tag)
                ]),
                h('button', {
                  type: 'button',
                  onClick: handleClose,
                  style: {
                    background: 'none',
                    border: 'none',
                    fontSize: '12px',
                    color: theme.textMuted,
                    cursor: 'pointer',
                    padding: '4px 6px',
                    borderRadius: '4px'
                  }
                }, '跳过 (Esc)')
              ]),

              h('div', {
                style: { padding: '18px 20px 14px', display: 'flex', flexDirection: 'column', gap: '10px' }
              }, [
                h('h3', { style: { margin: 0, fontSize: '15px', fontWeight: 600, color: theme.textPrimary } }, current.title),
                h('p', { style: { margin: 0, fontSize: '12px', lineHeight: '1.6', color: theme.textSecondary } }, current.desc),
                h('div', {
                  style: {
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                    marginTop: '4px',
                    backgroundColor: theme.isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
                    padding: '10px 12px',
                    borderRadius: '6px',
                    border: `1px solid ${theme.chipNormalBorder}`
                  }
                }, current.tips.map((tip, i) => h('div', {
                  key: i,
                  style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }
                }, [
                  h('span', {
                    style: {
                      fontSize: '11px',
                      fontFamily: 'ui-monospace, monospace',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      backgroundColor: theme.isDark ? '#27272a' : '#f4f4f5',
                      border: `1px solid ${theme.chipNormalBorder}`,
                      color: theme.textPrimary
                    }
                  }, tip.key),
                  h('span', { style: { fontSize: '11.5px', color: theme.textSecondary } }, tip.text)
                ])))
              ]),

              h('div', {
                style: {
                  padding: '12px 18px',
                  borderTop: `1px solid ${theme.chipNormalBorder}`,
                  backgroundColor: theme.isDark ? 'rgba(255,255,255,0.015)' : 'rgba(0,0,0,0.01)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }
              }, [
                h('label', {
                  style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: theme.textMuted, cursor: 'pointer' }
                }, [
                  h('input', {
                    type: 'checkbox',
                    checked: dontShowAgain,
                    onChange: (e) => setDontShowAgain(e.target.checked),
                    style: { cursor: 'pointer', accentColor: '#22c55e' }
                  }),
                  '不再自动弹出'
                ]),
                h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [
                  !isFirst && h('button', {
                    type: 'button',
                    onClick: handlePrev,
                    style: {
                      padding: '5px 12px',
                      fontSize: '12px',
                      borderRadius: '5px',
                      border: `1px solid ${theme.chipNormalBorder}`,
                      backgroundColor: 'transparent',
                      color: theme.textPrimary,
                      cursor: 'pointer'
                    }
                  }, '上一步'),
                  h('button', {
                    type: 'button',
                    onClick: handleNext,
                    style: {
                      padding: '5px 16px',
                      fontSize: '12px',
                      fontWeight: 500,
                      borderRadius: '5px',
                      border: 'none',
                      backgroundColor: theme.btnPrimaryBg,
                      color: theme.btnPrimaryText,
                      cursor: 'pointer'
                    }
                  }, isLast ? '开始创作' : '下一步')
                ])
              ])
            ])
          ]);
        }

        // ==========================================
        // 4.5 画布快捷键速查面板 (CANVAS-M1 1.9, 对标 LibTV 四栏布局)
        // ==========================================
        function CanvasShortcutsPanel({ isOpen, onClose }) {
          const theme = useTheme();
          React.useEffect(() => {
            if (!isOpen) return;
            const onKeyDown = (e) => { if (e.key === 'Escape') onClose(); };
            window.addEventListener('keydown', onKeyDown);
            return () => window.removeEventListener('keydown', onKeyDown);
          }, [isOpen]);

          if (!isOpen) return null;

          const groups = [
            {
              title: '选择与编辑',
              items: [
                ['空白处拖拽', '框选批量选中'],
                ['Shift + 点击', '加选 / 减选'],
                ['Ctrl + A', '全选分镜'],
                ['Esc', '取消选择'],
                ['Del / Backspace', '删除所选分镜'],
                ['Ctrl + Z / Ctrl + Shift + Z', '撤销 / 重做']
              ]
            },
            {
              title: '节点与连线',
              items: [
                ['Tab / 右键空白', '新建节点菜单'],
                ['Ctrl + L', '连线模式 (点源 → 点目标)'],
                ['拖动绿色锚点', '拖出连线到目标节点'],
                ['点击连线 + Del', '选中并删除连线'],
                ['Ctrl + D', '复制节点和连线'],
                ['Alt + 拖动节点', '克隆节点 (不带线)'],
                ['Ctrl + Alt + 拖动节点', '创建副本 (保留对外连线)'],
                ['Ctrl + Enter', '批量生成所选分镜']
              ]
            },
            {
              title: '组织',
              items: [
                ['Ctrl/Alt + G', '成组所选'],
                ['Ctrl/Alt + Shift + G', '解组所选'],
                ['Ctrl + Alt + G', '合并分镜组'],
                ['Alt + Shift + F', '整理画布 (自动布局 + 适应视图)'],
                ['Ctrl + F', '节点搜索'],
                ['拖动组成员', '整组随动']
              ]
            },
            {
              title: '缩放',
              items: [
                ['Ctrl + 滚轮 / 触控板捏合', '定点缩放 (20%~300%)'],
                ['Ctrl + + / Ctrl + -', '步进放大 / 缩小'],
                ['Ctrl + 0', '适应画布总览']
              ]
            },
            {
              title: '移动画布',
              items: [
                ['滚轮 / Shift + 滚轮', '纵向 / 横向平移'],
                ['Space + 拖拽 / 鼠标中键', '自由平移'],
                ['V', '选择工具'],
                ['H', '抓手工具 (拖拽平移)']
              ]
            },
            {
              title: '对齐',
              items: [
                ['拖动时自动', '8px 网格磁吸'],
                ['靠近邻卡边缘', '对齐参考线自动吸附']
              ]
            },
            {
              title: '进阶能力',
              items: [
                ['Tab / 右键空白', '新建分镜 / 图片 / 文本 / 视频节点'],
                ['节点顶栏「重跑」', '按提示词与上游连线重新生成'],
                ['连线到分镜', '图片作参考图、文本补充提示词'],
                ['右下「小地图」', '开关缩略图，拖拽定位视口'],
                ['右下「提示词」', '收藏 / 搜索 / 插入节点提示词'],
                ['顶栏「工程」', '切换 / 新建 / 导入导出工程'],
                ['聊天对话', '让大模型读取故事板 / 追加分镜 / 排队生成']
              ]
            }
          ];

          return h('div', {
            onClick: onClose,
            style: {
              position: 'fixed',
              left: 0,
              top: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.55)',
              zIndex: 9000,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '24px'
            }
          }, [
            h('div', {
              onClick: (e) => e.stopPropagation(),
              style: {
                backgroundColor: theme.bgCard,
                border: `1px solid ${theme.borderSubtle}`,
                borderRadius: '14px',
                boxShadow: '0 24px 60px rgba(0, 0, 0, 0.4)',
                padding: '22px 26px',
                maxWidth: '880px',
                width: '100%',
                maxHeight: '80vh',
                overflowY: 'auto'
              }
            }, [
              h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' } }, [
                h('div', { style: { fontSize: '15px', fontWeight: 700, color: theme.textPrimary } }, '画布快捷键'),
                h('button', {
                  type: 'button',
                  onClick: onClose,
                  style: { background: 'none', border: 'none', color: theme.textMuted, fontSize: '18px', cursor: 'pointer', lineHeight: 1, padding: '0 4px' }
                }, '×')
              ]),
              h('div', {
                style: {
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                  gap: '18px'
                }
              }, groups.map(g => h('div', { key: g.title }, [
                h('div', { style: { fontSize: '12.5px', fontWeight: 700, color: '#06b6d4', marginBottom: '10px' } }, g.title),
                h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
                  g.items.map(([k, v]) => h('div', { key: k, style: { display: 'flex', flexDirection: 'column', gap: '2px' } }, [
                    h('div', {
                      style: {
                        fontSize: '11px',
                        fontFamily: 'monospace',
                        color: theme.textPrimary,
                        backgroundColor: theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
                        borderRadius: '4px',
                        padding: '2px 6px',
                        alignSelf: 'flex-start'
                      }
                    }, k),
                    h('div', { style: { fontSize: '11px', color: theme.textSecondary } }, v)
                  ])))
              ])))
            ])
          ]);
        }

        // ==========================================
        // 4.6 画布小地图 (对标 infinite-canvas canvas-mini-map.tsx)
        // 纯几何由 src/canvas-minimap.js 提供，节点着色由 src/canvas-nodes.js 注册表提供
        // ==========================================
        function CanvasMiniMapPanel({ theme, project, viewport, tick, onViewportChange, onToggle }) {
          const defaults = CanvasMiniMapUtils.MINIMAP_DEFAULTS;
          const containerRef = React.useRef(null);
          const nodes = React.useMemo(() => CanvasNodeUtils.listNodes(project), [tick]);
          const bounds = React.useMemo(() => CanvasMiniMapUtils.computeWorldBounds(nodes, defaults.padding), [nodes]);
          const transform = React.useMemo(() => CanvasMiniMapUtils.createMinimapTransform(bounds, defaults.width, defaults.height), [bounds]);
          const rects = React.useMemo(() => CanvasMiniMapUtils.computeNodeRects(nodes, transform), [nodes, transform]);
          const [screenSize, setScreenSize] = React.useState({ width: 800, height: 600 });

          React.useEffect(() => {
            const el = containerRef.current?.parentElement;
            if (!el) return;
            const measure = () => {
              const r = el.getBoundingClientRect();
              if (r.width && r.height) setScreenSize({ width: r.width, height: r.height });
            };
            measure();
            window.addEventListener('resize', measure);
            return () => window.removeEventListener('resize', measure);
          }, []);

          const viewportRect = CanvasMiniMapUtils.computeViewportRect(viewport, screenSize, transform);
          const handlePointer = (e) => {
            const rect = containerRef.current?.getBoundingClientRect();
            if (!rect) return;
            const point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
            const next = CanvasMiniMapUtils.minimapPanToViewport(point, screenSize, transform, viewport.zoom);
            onViewportChange(next);
          };

          return h('div', {
            ref: containerRef,
            onPointerDown: (e) => {
              e.preventDefault();
              e.currentTarget.setPointerCapture?.(e.pointerId);
              handlePointer(e);
            },
            onPointerMove: (e) => {
              if (e.buttons === 1) handlePointer(e);
            },
            title: '小地图：点击或拖拽定位视口',
            style: {
              position: 'absolute', bottom: '64px', right: '20px', zIndex: 100,
              width: `${defaults.width}px`, height: `${defaults.height}px`,
              borderRadius: '8px', overflow: 'hidden',
              backgroundColor: theme.isDark ? 'rgba(18,18,21,0.92)' : 'rgba(245,245,247,0.94)',
              border: `1px solid ${theme.popoverBorder}`,
              boxShadow: '0 6px 18px rgba(0,0,0,0.2)', cursor: 'crosshair'
            }
          }, [
            ...rects.map((r, i) => h('div', {
              key: 'n' + i,
              style: {
                position: 'absolute', left: `${r.x}px`, top: `${r.y}px`,
                width: `${r.width}px`, height: `${r.height}px`,
                backgroundColor: CanvasNodeUtils.getNodeDefinition(nodes[i] && nodes[i].type).minimapColor,
                opacity: 0.85, borderRadius: '1px', pointerEvents: 'none'
              }
            })),
            h('div', {
              style: {
                position: 'absolute', left: `${viewportRect.x}px`, top: `${viewportRect.y}px`,
                width: `${viewportRect.width}px`, height: `${viewportRect.height}px`,
                border: `1.5px solid ${theme.isDark ? '#e5e7eb' : '#111827'}`,
                backgroundColor: theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
                pointerEvents: 'none', boxSizing: 'border-box'
              }
            }),
            h('button', {
              type: 'button',
              onPointerDown: (e) => e.stopPropagation(),
              onClick: (e) => { e.stopPropagation(); onToggle(); },
              title: '关闭小地图',
              style: {
                position: 'absolute', top: '2px', right: '2px', padding: '0 5px',
                background: 'none', border: 'none', color: theme.textMuted,
                cursor: 'pointer', fontSize: '12px', lineHeight: '16px'
              }
            }, '×')
          ]);
        }

        // ==========================================
        // 5. 漫剧 AI 画布旧版工作台组件 (LegacyCanvasWorkspace)
        // ==========================================
        function LegacyCanvasWorkspace({ theme: propTheme, isVip, isSvip, isSuper, onOpenTutorial }) {
          const hookTheme = useTheme();
          const theme = propTheme || hookTheme;
          // 三级水合恢复机制：全局内存单例 -> CanvasProjectStorage 磁盘备份 -> localStorage 镜像 -> 初始模板 (CANVAS-01)
          // 对标 infinite-canvas: 多工程注册表冷启动接入 (旧单文件零迁移，内存单例仍最优先)
          // 三级水合机制保持不变，仅在磁盘层之前插入"当前激活工程"这一层数据源
          const initialProject = React.useMemo(() => {
            const mem = (typeof window !== 'undefined') ? window.__WINETOKEN_CANVAS_MEMORY_STORE__ : null;
            if (mem && mem.characters && mem.panels && mem.characters.length > 0) {
              return mem;
            }
            if (canvasProjectStore) {
              try {
                canvasProjectStore.ensureLegacyMigration();
                const activeId = canvasProjectStore.getActiveId();
                if (activeId) {
                  const active = canvasProjectStore.loadProject(activeId);
                  if (active && active.characters && active.panels) return active;
                }
              } catch (err) {
                console.warn('[WineToken Canvas] 激活工程读取失败，回退单文件磁盘备份:', err.message);
              }
            }
            if (canvasStorageDriver) {
              try {
                const disk = canvasStorageDriver.loadProject();
                if (disk && disk.characters && disk.panels && disk.characters.length > 0) {
                  return disk;
                }
              } catch (_) {}
            }
            try {
              if (typeof localStorage !== 'undefined') {
                const raw = localStorage.getItem('__winetoken_canvas_snapshot__');
                if (raw) {
                  const parsed = JSON.parse(raw);
                  if (parsed && parsed.characters && parsed.panels) return parsed;
                }
              }
            } catch (_) {}
            return (canvasStorageDriver && canvasStorageDriver.getDefaultProject()) || {
              characters: [{ id: 'char_chuyun', name: '主角·楚云', dna: '少年剑客，黑袍高领，银白碎发，剑眉星目，冷峻英气，电影质感', avatar: '' }],
              panels: [
                { id: 'shot_01', num: 1, x: 360, y: 60, width: 280, height: 420, aspectRatio: '2:3', shot: 'CU', shotLabel: '特写', prompt: '少年剑客面部特写，发丝微动，冷峻眼神，侧逆光，细致皮肤纹理，虚化背景，电影光影', dialogue: '“这一剑，我已等了三年。”', characterId: 'char_chuyun', imageUrl: '', isGenerating: false, stagingCandidateUrl: null },
                { id: 'shot_02', num: 2, x: 690, y: 60, width: 360, height: 240, aspectRatio: '16:9', shot: 'MS', shotLabel: '中景', prompt: '雨夜长街，黑袍剑客拔剑而立，剑锋泛起寒光，雨水飞溅，深邃冷色调，宽银幕构图', dialogue: '长街风雨骤急，杀气四伏。', characterId: 'char_chuyun', imageUrl: '', isGenerating: false, stagingCandidateUrl: null }
              ],
              viewport: { x: 40, y: 30, zoom: 1 }
            };
          }, []);

          // 视口变换参数 (基于 Direct DOM Transform 硬件加速)
          const viewportRef = React.useRef(initialProject.viewport || { x: 40, y: 30, zoom: 1 });
          const canvasLayerRef = React.useRef(null);
          const viewportContainerRef = React.useRef(null);
          const [viewportWidth, setViewportWidth] = React.useState(() => {
            return (typeof window !== 'undefined' && typeof window.innerWidth === 'number') ? window.innerWidth : 1440;
          });

          React.useEffect(() => {
            if (typeof window === 'undefined') return;
            const updateWidth = () => {
              const el = viewportContainerRef.current || (typeof document !== 'undefined' ? document.getElementById('winetoken-canvas-viewport') : null);
              const w = (el && el.clientWidth) ? el.clientWidth : window.innerWidth;
              if (typeof w === 'number' && w > 0) {
                setViewportWidth(w);
              }
            };
            updateWidth();
            window.addEventListener('resize', updateWidth);
            let ro = null;
            const el = viewportContainerRef.current || (typeof document !== 'undefined' ? document.getElementById('winetoken-canvas-viewport') : null);
            if (typeof ResizeObserver !== 'undefined' && el) {
              try {
                ro = new ResizeObserver((entries) => {
                  for (const entry of entries) {
                    const w = entry.contentRect?.width;
                    if (typeof w === 'number' && w > 0) {
                      setViewportWidth(w);
                    }
                  }
                });
                ro.observe(el);
              } catch (_) {}
            }
            return () => {
              window.removeEventListener('resize', updateWidth);
              if (ro) ro.disconnect();
            };
          }, []);

          const isNarrow = viewportWidth < 900;
          const isCompact = viewportWidth < 1280;

          const isDraggingRef = React.useRef(false);
          const dragStartRef = React.useRef({ x: 0, y: 0, originX: 0, originY: 0 });
          const isSpacePressedRef = React.useRef(false);
          const [zoomDisplay, setZoomDisplay] = React.useState(Math.round((initialProject.viewport?.zoom || 1) * 100));

          // CANVAS-M1 1.4/1.7: 选择集、工具状态与框选/参考线渲染态
          const [selectedIds, setSelectedIds] = React.useState(() => new Set());
          const [activeTool, setActiveTool] = React.useState('select'); // 'select' | 'grab'
          const [showShortcuts, setShowShortcuts] = React.useState(false);
          // 对标 infinite-canvas: 多工程管理态 / 小地图开关 / 工程导入导出错误透传
          const [projectList, setProjectList] = React.useState(() => canvasProjectStore ? canvasProjectStore.listProjects() : []);
          const [activeProjectId, setActiveProjectId] = React.useState(() => initialProject.id || (canvasProjectStore ? canvasProjectStore.getActiveId() : null));
          const [projectError, setProjectError] = React.useState('');
          const [showMiniMap, setShowMiniMap] = React.useState(() => {
            try { return localStorage.getItem('WINETOKEN_CANVAS_MINIMAP') !== 'off'; } catch (_) { return true; }
          });
          const [minimapTick, setMinimapTick] = React.useState(0);
          // 对标 infinite-canvas 提示词库: localStorage 持久化，脏数据由纯模块归一化
          const PROMPT_LIB_KEY = 'WINETOKEN_CANVAS_PROMPT_LIBRARY_V1';
          const [promptLibrary, setPromptLibrary] = React.useState(() => {
            try {
              const raw = localStorage.getItem(PROMPT_LIB_KEY);
              return CanvasPromptUtils
                ? CanvasPromptUtils.normalizeLibrary(raw ? JSON.parse(raw) : {})
                : { version: 1, items: [] };
            } catch (_) { return { version: 1, items: [] }; }
          });
          const [promptLibOpen, setPromptLibOpen] = React.useState(false);
          const [promptLibQuery, setPromptLibQuery] = React.useState('');
          const persistPromptLibrary = (lib) => {
            setPromptLibrary(lib);
            try { localStorage.setItem(PROMPT_LIB_KEY, JSON.stringify(lib)); }
            catch (err) { setProjectError(`提示词库保存失败: ${err.message}`); }
          };
          // CANVAS-M4 客户端部分: AI 剧本拆镜
          const [aiSplitOpen, setAiSplitOpen] = React.useState(false);
          const [aiSplitText, setAiSplitText] = React.useState('');
          const [aiSplitCount, setAiSplitCount] = React.useState(6);
          const [aiSplitBusy, setAiSplitBusy] = React.useState(false);
          const [aiSplitModel, setAiSplitModel] = React.useState(() => {
            try {
              return (typeof localStorage !== 'undefined' && localStorage.getItem('__winetoken_ai_split_model__')) || '';
            } catch (_) { return ''; }
          });
          const [marqueeRect, setMarqueeRect] = React.useState(null); // 容器相对坐标 {x0,y0,x1,y1}
          const [alignGuides, setAlignGuides] = React.useState([]); // [{orientation:'v'|'h', pos}]
          const isMarqueeRef = React.useRef(false);
          const marqueeOriginRef = React.useRef(null);

          const clearSelection = () => setSelectedIds(prev => (prev.size ? new Set() : prev));
          const toggleSelectId = (id) => setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
          });

          // 漫剧画布生图模型状态与原图全屏预览灯箱
          const [canvasModel, setCanvasModel] = React.useState(initialProject.activeModel || WineTokenManifestManager.getFreeImageModel() || 'sensenova-u1.5-lite');
          const [availableImageModels, setAvailableImageModels] = React.useState(WineTokenManifestManager.getImageModels());
          const [availableVideoModels, setAvailableVideoModels] = React.useState(() => WineTokenManifestManager.getVideoModels());
          // AI 拆镜用对话模型列表 (与图片模型共用 Manifest SWR 热更新)
          const [availableChatModels, setAvailableChatModels] = React.useState(() => WineTokenManifestManager.getChatModels());
          const [lightboxUrl, setLightboxUrl] = React.useState(null);

          // 补充规格 S1 资产库面板状态与 S3 标签筛选
          const [assetLibraryOpen, setAssetLibraryOpen] = React.useState(false);
          const [assetLibCategory, setAssetLibCategory] = React.useState('全部');
          const [assetLibQuery, setAssetLibQuery] = React.useState('');
          const [assetLibSort, setAssetLibSort] = React.useState('updatedAt');
          const [assetLibTick, setAssetLibTick] = React.useState(0);
          const [tagFilter, setTagFilter] = React.useState('全部'); // S3 标签筛选

          // 补充规格 S4 裁剪与存为资产弹窗状态
          const [cropModal, setCropModal] = React.useState(null); // { itemId, url, assetKey }
          const [saveAssetModal, setSaveAssetModal] = React.useState(null); // { itemId, assetKey, name, category, description }
          const [presetModal, setPresetModal] = React.useState(null); // { targetItemId: string }
          const [presetCategory, setPresetCategory] = React.useState('全部');
          const [tagPicker, setTagPicker] = React.useState(null); // { nodeId, nodeType }

          // 监听 Manifest SWR 热更新事件
          React.useEffect(() => {
            const unsub = WineTokenManifestManager.subscribe((models) => {
              if (models && models.imageModels && models.imageModels.length > 0) {
                setAvailableImageModels(models.imageModels);
              }
              if (models && models.videoModels && models.videoModels.length > 0) {
                setAvailableVideoModels(models.videoModels);
              }
              if (models && Array.isArray(models.chatModels)) {
                setAvailableChatModels(models.chatModels);
              }
            });
            return unsub;
          }, []);

          // 角色资产库
          const [characters, setCharacters] = React.useState(initialProject.characters);

          // 分镜格资产
          const [panels, setPanels] = React.useState(initialProject.panels);

          // CANVAS-M2 2.1: 通用画布节点 (生成图/文本) 与显式连线
          const [canvasItems, setCanvasItems] = React.useState(initialProject.canvasItems || []);
          const [edges, setEdges] = React.useState(initialProject.edges || []);
          // CANVAS-M3 3.1/3.3/3.4: 组、搜索与视口裁剪
          const [groups, setGroups] = React.useState(initialProject.groups || []);
          const [searchOpen, setSearchOpen] = React.useState(false);
          const [searchQuery, setSearchQuery] = React.useState('');
          const [viewportTick, setViewportTick] = React.useState(0); // 平移结束后触发虚拟化重算
          const [connectMode, setConnectMode] = React.useState(null); // null | {from: {type,id}|null} — Ctrl+L 连线模式
          const [connectDrag, setConnectDrag] = React.useState(null); // {from, x, y} — 锚点拖出临时线
          const [nodeMenu, setNodeMenu] = React.useState(null); // {screenX, screenY, worldX, worldY}
          const nodeMenuRef = React.useRef(null); // 菜单元素引用：供"点击菜单外任意处自动收起"判定
          const connectDragRef = React.useRef(null);
          const panelsRef = React.useRef(panels);
          const canvasItemsRef = React.useRef(canvasItems);
          React.useEffect(() => { panelsRef.current = panels; }, [panels]);
          React.useEffect(() => { canvasItemsRef.current = canvasItems; }, [canvasItems]);

          // 撤销/重做统一快照 (含节点、连线与组)
          const snapshotState = () => ({ characters, panels, canvasItems, edges, groups });

          // ==========================================
          // 5.0 多工程管理 (对标 infinite-canvas: create/open/rename/delete/import/export)
          // 任何写盘失败都向 UI 真实透传，绝不静默吞错 (工程铁律 3)
          // ==========================================
          const refreshProjectList = () => {
            if (!canvasProjectStore) return;
            try {
              setProjectList(canvasProjectStore.listProjects());
            } catch (err) {
              setProjectError(`工程列表读取失败: ${err.message}`);
            }
          };

          const applyProjectToCanvas = (project, id) => {
            setCharacters(project.characters || []);
            setPanels(project.panels || []);
            setCanvasItems(project.canvasItems || []);
            setEdges(project.edges || []);
            setGroups(project.groups || []);
            if (project.viewport) {
              viewportRef.current = { ...project.viewport };
              // 直接更新变换层，不依赖后面声明的 updateTransform (规避闭包声明顺序耦合)
              if (canvasLayerRef.current) {
                const vp = viewportRef.current;
                canvasLayerRef.current.style.transform = `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`;
              }
              setZoomDisplay(Math.round((project.viewport.zoom || 1) * 100));
            }
            if (project.activeModel) setCanvasModel(project.activeModel);
            setSelectedIds(new Set());
            if (canvasHistoryManager) canvasHistoryManager.clear();
            setActiveProjectId(id || null);
            setMinimapTick(t => t + 1);
          };

          const handleSwitchProject = (id) => {
            if (!canvasProjectStore || !id || id === activeProjectId) return;
            try {
              const project = canvasProjectStore.loadProject(id);
              if (canvasProjectStore.setActiveId(id)) {
                applyProjectToCanvas(project, id);
                setProjectError('');
              }
            } catch (err) {
              setProjectError(`工程切换失败: ${err.message}`);
            }
          };

          const handleCreateProject = () => {
            if (!canvasProjectStore) return;
            const name = window.prompt('新建工程名称', `未命名工程 ${new Date().toLocaleDateString()}`);
            if (name === null) return;
            try {
              const meta = canvasProjectStore.createProject(name);
              const project = canvasProjectStore.loadProject(meta.id);
              canvasProjectStore.setActiveId(meta.id);
              applyProjectToCanvas(project, meta.id);
              refreshProjectList();
              setProjectError('');
            } catch (err) {
              setProjectError(`新建工程失败: ${err.message}`);
            }
          };

          const handleRenameProject = () => {
            if (!canvasProjectStore || !activeProjectId) return;
            const current = projectList.find(p => p.id === activeProjectId);
            const name = window.prompt('重命名当前工程', current ? current.name : '未命名工程');
            if (name === null) return;
            try {
              canvasProjectStore.renameProject(activeProjectId, name);
              refreshProjectList();
              setProjectError('');
            } catch (err) {
              setProjectError(`重命名失败: ${err.message}`);
            }
          };

          const handleDeleteProject = () => {
            if (!canvasProjectStore || !activeProjectId) return;
            if (!window.confirm('确定要把当前工程移入回收站吗？工程内容不会立即删除，可在回收站恢复。')) return;
            try {
              canvasProjectStore.deleteProject(activeProjectId);
              const rest = canvasProjectStore.listProjects();
              refreshProjectList();
              if (rest.length) {
                const nextId = rest[0].id;
                canvasProjectStore.setActiveId(nextId);
                applyProjectToCanvas(canvasProjectStore.loadProject(nextId), nextId);
              } else {
                setActiveProjectId(null);
              }
              setProjectError('');
            } catch (err) {
              setProjectError(`删除工程失败: ${err.message}`);
            }
          };

          const handleRestoreProject = () => {
            if (!canvasProjectStore) return;
            const deleted = canvasProjectStore.listDeleted();
            if (!deleted.length) { setProjectError('回收站为空'); return; }
            const label = deleted.map((p, i) => `${i + 1}. ${p.name}`).join('\n');
            const pick = window.prompt(`输入要恢复的工程序号:\n${label}`, '1');
            if (pick === null) return;
            const idx = Number(pick) - 1;
            if (!Number.isInteger(idx) || idx < 0 || idx >= deleted.length) { setProjectError('序号无效'); return; }
            try {
              const id = deleted[idx].id;
              canvasProjectStore.restoreProject(id);
              refreshProjectList();
              setProjectError(`已恢复工程: ${deleted[idx].name}`);
            } catch (err) {
              setProjectError(`恢复工程失败: ${err.message}`);
            }
          };

          // ==========================================
          // 5.1 提示词库操作 (对标 infinite-canvas prompt library)
          // ==========================================
          const findSelectedPromptTarget = () => {
            const ids = Array.from(selectedIds);
            if (!ids.length) return null;
            const panel = panels.find(p => ids.includes(p.id));
            if (panel) return { kind: 'panel', id: panel.id, get: () => panel.prompt || '', set: (v) => setPanels(prev => prev.map(x => x.id === panel.id ? { ...x, prompt: v } : x)) };
            const item = canvasItems.find(it => ids.includes(it.id) && (it.type === 'image' || it.type === 'video' || it.type === 'text'));
            if (item) return {
              kind: 'item', id: item.id,
              get: () => (item.type === 'text' ? (item.data?.text || '') : (item.data?.prompt || '')),
              set: (v) => setCanvasItems(prev => prev.map(x => x.id === item.id ? {
                ...x, data: { ...(x.data || {}), [item.type === 'text' ? 'text' : 'prompt']: v }
              } : x))
            };
            return null;
          };

          const handleCollectPrompt = () => {
            if (!CanvasPromptUtils) { setProjectError('提示词库模块不可用'); return; }
            const target = findSelectedPromptTarget();
            if (!target) { setProjectError('请先选中一个分镜或图片/视频/文本节点'); return; }
            const text = target.get();
            if (!text || !text.trim()) { setProjectError('所选节点没有可收藏的提示词'); return; }
            const r = CanvasPromptUtils.addPrompt(promptLibrary, { text, title: text.slice(0, 24), tags: [target.kind] });
            if (r.added) persistPromptLibrary(r.library);
            setProjectError(r.added ? '已收藏到提示词库' : r.reason);
          };

          const handleApplyPrompt = (text) => {
            const target = findSelectedPromptTarget();
            if (!target) { setProjectError('请先选中一个节点，再把提示词插入其中'); return; }
            if (canvasHistoryManager) canvasHistoryManager.pushState(snapshotState());
            target.set(text);
            setPromptLibOpen(false);
            setProjectError('提示词已插入所选节点');
          };

          const handleRemovePrompt = (id) => {
            if (!CanvasPromptUtils) return;
            persistPromptLibrary(CanvasPromptUtils.removePrompt(promptLibrary, id).library);
          };

          const handleExportPromptLibrary = async () => {
            if (!CanvasPromptUtils) { setProjectError('提示词库模块不可用'); return; }
            try {
              const manifest = CanvasPromptUtils.buildExport(promptLibrary);
              const targetPath = await WineTokenFileUtil.promptSaveLocation({
                title: '导出提示词库', defaultName: `WineToken_提示词库_${Date.now()}.json`,
                type: 'image', ext: '.json', filters: 'JSON 文件 (*.json)|*.json'
              });
              if (!targetPath) return;
              const fs = require('fs');
              fs.writeFileSync(targetPath, JSON.stringify(manifest, null, 2), 'utf8');
              const readBack = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
              if (readBack.app !== manifest.app || readBack.items.length !== manifest.items.length) {
                throw new Error('导出文件回读校验失败');
              }
              WineTokenFileUtil.revealFile(targetPath);
              setProjectError(`提示词库已导出 (${manifest.items.length} 条)`);
            } catch (err) { setProjectError(`提示词库导出失败: ${err.message}`); }
          };

          const handleImportPromptLibrary = async (ev) => {
            const file = ev.target.files && ev.target.files[0];
            ev.target.value = '';
            if (!file || !CanvasPromptUtils) return;
            try {
              const text = await file.text();
              const r = CanvasPromptUtils.parseImport(text, promptLibrary);
              if (!r.ok) throw new Error(r.error);
              persistPromptLibrary(r.library);
              setProjectError(`已导入 ${r.added} 条提示词${r.warnings.length ? ' (含兼容提示)' : ''}`);
            } catch (err) { setProjectError(`提示词库导入失败: ${err.message}`); }
          };

          // 工程导出: 版本化清单 + 资产清单，走 Windows 原生另存为；失败真实报错
          const handleExportProject = async () => {
            if (!CanvasExportUtils) { setProjectError('工程导出模块不可用'); return; }
            try {
              const manifest = CanvasExportUtils.buildExportManifest(snapshotState());
              const targetPath = await WineTokenFileUtil.promptSaveLocation({
                title: '导出画布工程',
                defaultName: `WineToken_工程_${Date.now()}.wtcanvas.json`,
                type: 'image',
                ext: '.json',
                filters: '画布工程 (*.wtcanvas.json)|*.wtcanvas.json|JSON 文件 (*.json)|*.json'
              });
              if (!targetPath) return;
              const fs = require('fs');
              fs.writeFileSync(targetPath, JSON.stringify(manifest, null, 2), 'utf8');
              // 物理回读强校验
              const readBack = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
              if (readBack.app !== manifest.app || readBack.version !== manifest.version) {
                throw new Error('导出文件回读校验失败');
              }
              WineTokenFileUtil.revealFile(targetPath);
              setProjectError(`工程已导出 (${manifest.assets.length} 项资产引用)`);
            } catch (err) {
              setProjectError(`工程导出失败: ${err.message}`);
            }
          };

          const handleImportProject = async (ev) => {
            const file = ev.target.files && ev.target.files[0];
            ev.target.value = '';
            if (!file || !CanvasExportUtils || !canvasProjectStore) return;
            if (!window.confirm('导入将新建一个工程，当前画布内容会先自动保存到现有工程。是否继续？')) return;
            try {
              const text = await file.text();
              const parsed = CanvasExportUtils.parseImportManifest(text);
              if (!parsed.ok) throw new Error(parsed.error);
              const meta = canvasProjectStore.createProject(`${parsed.manifest.project.panels?.length || 0} 镜 · 导入工程`);
              const imported = {
                ...parsed.manifest.project,
                viewport: parsed.manifest.project.viewport || { x: 40, y: 30, zoom: 1 },
                activeModel: parsed.manifest.project.activeModel || canvasModel
              };
              canvasProjectStore.saveProject(meta.id, imported);
              canvasProjectStore.setActiveId(meta.id);
              applyProjectToCanvas(imported, meta.id);
              refreshProjectList();
              setProjectError(`导入成功${parsed.warnings.length ? ' (含 ' + parsed.warnings.length + ' 条兼容提示)' : ''}`);
            } catch (err) {
              setProjectError(`工程导入失败: ${err.message}`);
            }
          };

          // 状态变更双轨同步写盘与内存保活 (CANVAS-01, CANVAS-02)
          React.useEffect(() => {
            const snapshot = {
              characters,
              panels,
              canvasItems,
              edges,
              groups,
              viewport: viewportRef.current,
              activeModel: canvasModel
            };
            if (typeof window !== 'undefined' && window.__WINETOKEN_CANVAS_MEMORY_STORE__) {
              window.__WINETOKEN_CANVAS_MEMORY_STORE__ = snapshot;
            }
            if (canvasStorageDriver) {
              canvasStorageDriver.debounceSave(snapshot, 500);
            }
            try {
              if (typeof localStorage !== 'undefined') {
                localStorage.setItem('__winetoken_canvas_snapshot__', JSON.stringify(snapshot));
              }
            } catch (_) {}
            // 对标 infinite-canvas: 状态变更同步写入当前激活工程 (失败必须向 UI 真实报错，铁律 3)
            if (canvasProjectStore && activeProjectId) {
              try {
                canvasProjectStore.saveProject(activeProjectId, snapshot);
                setProjectError(prev => prev ? '' : prev);
              } catch (err) {
                setProjectError(`工程保存失败: ${err.message}`);
              }
            }
          }, [characters, panels, canvasItems, edges, groups, canvasModel, activeProjectId, viewportTick]);

          // 更新视图 Transform
          const updateTransform = () => {
            if (!canvasLayerRef.current) return;
            const { x, y, zoom } = viewportRef.current;
            // 用 2D translate 而非 translate3d：避免 Chromium 把整层提升为固定分辨率的合成纹理，
            // 否则 scale 放大时只是拉伸那张纹理，文字/图片会像"图片被放大"一样糊。
            canvasLayerRef.current.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`;
          };

          // 30 步命令模式撤销/重做堆栈 (CANVAS-04, CANVAS-M2/M3 含节点、连线与组)
          const handleUndo = () => {
            if (!canvasHistoryManager || !canvasHistoryManager.canUndo()) return;
            const prev = canvasHistoryManager.undo(snapshotState());
            if (prev) {
              if (prev.characters) setCharacters(prev.characters);
              if (prev.panels) setPanels(prev.panels);
              if (prev.canvasItems) setCanvasItems(prev.canvasItems);
              if (prev.edges) setEdges(prev.edges);
              if (prev.groups) setGroups(prev.groups);
            }
          };

          const handleRedo = () => {
            if (!canvasHistoryManager || !canvasHistoryManager.canRedo()) return;
            const next = canvasHistoryManager.redo(snapshotState());
            if (next) {
              if (next.characters) setCharacters(next.characters);
              if (next.panels) setPanels(next.panels);
              if (next.canvasItems) setCanvasItems(next.canvasItems);
              if (next.edges) setEdges(next.edges);
              if (next.groups) setGroups(next.groups);
            }
          };

          // 监听 WAL 异步任务队列，跨卸载/跨Tab自动完成水合对账 (CANVAS-02)
          React.useEffect(() => {
            if (!CanvasJobQueueSingleton) return;
            const unsub = CanvasJobQueueSingleton.subscribe((job) => {
              if (job.status === 'completed' && job.resultUrl) {
                setPanels(prev => prev.map(p => {
                  if (p.id === job.panelId) {
                    return {
                      ...p,
                      imageUrl: job.resultUrl,
                      isGenerating: false,
                      candidates: [job.resultUrl, ...(p.candidates || [])].slice(0, 4)
                    };
                  }
                  return p;
                }));
                // CANVAS-M2 2.2: 生成图作为独立节点落画布并连线到源分镜 (跨Tab水合同样生效)
                const srcPanel = panelsRef.current.find(p => p.id === job.panelId);
                if (srcPanel) spawnImageNodeForPanel(srcPanel, job.resultUrl);
              } else if (job.status === 'failed') {
                setPanels(prev => prev.map(p => p.id === job.panelId ? { ...p, isGenerating: false } : p));
              }
            });
            return unsub;
          }, []);

          // 滚轮手势处理 (CANVAS-M1 1.2, 决策 D1 对齐 LibTV):
          // Ctrl/Cmd+滚轮 = 光标定点缩放 (触控板捏合在 Chromium 中天然携带 ctrlKey)
          // 普通滚轮 = 纵向平移, Shift+滚轮 = 横向平移, 触控板双指 = deltaX/deltaY 直接平移
          const handleWheel = (e) => {
            e.preventDefault();
            const container = canvasLayerRef.current?.parentElement;
            if (!container) return;
            const rect = container.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            const cur = viewportRef.current;

            if (e.ctrlKey || e.metaKey) {
              let delta = e.deltaY;
              if (e.deltaMode === 1) delta *= 16;
              const clampedDelta = Math.max(-80, Math.min(80, delta));
              const factor = 1 - clampedDelta * 0.0018;
              const nextZoom = Math.min(5.0, Math.max(0.05, cur.zoom * factor));
              const ratio = nextZoom / cur.zoom;
              cur.x = mouseX - (mouseX - cur.x) * ratio;
              cur.y = mouseY - (mouseY - cur.y) * ratio;
              cur.zoom = nextZoom;
            } else {
              let dx = e.deltaX || 0;
              let dy = e.deltaY;
              if (e.deltaMode === 1) { dx *= 16; dy *= 16; }
              if (e.shiftKey && !dx) { dx = dy; dy = 0; }
              cur.x -= dx;
              cur.y -= dy;
            }

            requestAnimationFrame(() => {
              updateTransform();
              setZoomDisplay(Math.round(viewportRef.current.zoom * 100));
            });
          };

          // React 的 onWheel 在根节点注册为 passive，无法阻止 Ctrl+滚轮触发浏览器整页缩放，
          // 因此改用原生非 passive 监听挂载在视口容器上 (CANVAS-M1 1.2)
          React.useEffect(() => {
            const container = canvasLayerRef.current?.parentElement;
            if (!container) return;
            container.addEventListener('wheel', handleWheel, { passive: false });
            return () => container.removeEventListener('wheel', handleWheel);
          }, []);

          // 鼠标按下: 中键/空格/抓手 → 漫游; 左键点背景 → 清空选择并开始框选 (CANVAS-M1 1.4)
          const handlePointerDown = (e) => {
            if (e.button === 1 || (e.button === 0 && (isSpacePressedRef.current || activeTool === 'grab'))) {
              e.preventDefault();
              // 漫游不清空选择集 (对齐 Figma/LibTV 惯例)，仅框选起点清空
              isDraggingRef.current = true;
              dragStartRef.current = {
                x: e.clientX,
                y: e.clientY,
                originX: viewportRef.current.x,
                originY: viewportRef.current.y
              };
              e.currentTarget.setPointerCapture?.(e.pointerId);
              return;
            }
            if (e.button !== 0 || activeTool !== 'select') return;
            const startedOnBackground = e.target === canvasLayerRef.current || e.target === e.currentTarget;
            if (!startedOnBackground) {
              // 点在卡片内 (画面区/控件区): 交由卡片自身的选中逻辑处理
              return;
            }
            e.preventDefault();
            clearSelection();
            const rect = e.currentTarget.getBoundingClientRect();
            const sx = e.clientX - rect.left;
            const sy = e.clientY - rect.top;
            isMarqueeRef.current = true;
            marqueeOriginRef.current = { x: sx, y: sy };
            setMarqueeRect({ x0: sx, y0: sy, x1: sx, y1: sy });
            e.currentTarget.setPointerCapture?.(e.pointerId);
          };

          const handlePointerMove = (e) => {
            if (isMarqueeRef.current) {
              const rect = canvasLayerRef.current?.parentElement;
              if (!rect) return;
              const box = rect.getBoundingClientRect();
              const sx = e.clientX - box.left;
              const sy = e.clientY - box.top;
              setMarqueeRect(prev => prev ? { ...prev, x1: sx, y1: sy } : prev);
              return;
            }
            if (!isDraggingRef.current) return;
            const dx = e.clientX - dragStartRef.current.x;
            const dy = e.clientY - dragStartRef.current.y;
            viewportRef.current.x = dragStartRef.current.originX + dx;
            viewportRef.current.y = dragStartRef.current.originY + dy;
            requestAnimationFrame(updateTransform);
          };

          const handlePointerUp = (e) => {
            if (isMarqueeRef.current) {
              isMarqueeRef.current = false;
              e.currentTarget.releasePointerCapture?.(e.pointerId);
              const origin = marqueeOriginRef.current;
              const rect = canvasLayerRef.current?.parentElement;
              if (origin && rect && marqueeRect) {
                const box = rect.getBoundingClientRect();
                const x1 = e.clientX - box.left;
                const y1 = e.clientY - box.top;
                const zoom = viewportRef.current.zoom || 1;
                const wx0 = (Math.min(origin.x, x1) - viewportRef.current.x) / zoom;
                const wy0 = (Math.min(origin.y, y1) - viewportRef.current.y) / zoom;
                const wx1 = (Math.max(origin.x, x1) - viewportRef.current.x) / zoom;
                const wy1 = (Math.max(origin.y, y1) - viewportRef.current.y) / zoom;
                // 微小拖拽视同误触，不产生选择
                if (wx1 - wx0 > 4 && wy1 - wy0 > 4) {
                  const hits = new Set(
                    panels
                      .filter(p => {
                        const pw = p.width || 280;
                        const ph = p.height || 420;
                        return p.x < wx1 && (p.x + pw) > wx0 && p.y < wy1 && (p.y + ph) > wy0;
                      })
                      .map(p => p.id)
                  );
                  setSelectedIds(hits);
                }
              }
              setMarqueeRect(null);
              marqueeOriginRef.current = null;
              return;
            }
            if (isDraggingRef.current) {
              isDraggingRef.current = false;
              e.currentTarget.releasePointerCapture?.(e.pointerId);
              // 平移结束触发视口虚拟化重算 (CANVAS-M3 3.4)
              setViewportTick(t => t + 1);
            }
          };

          // 视口快速复位
          const handleResetView = () => {
            viewportRef.current = { x: 40, y: 30, zoom: 1 };
            updateTransform();
            setZoomDisplay(100);
          };

          // 适应画布 (Ctrl+0, CANVAS-M1 1.3): 计算全部内容 AABB 后缩放视口至刚好容纳 (80px 内边距)
          const handleFitToContent = () => {
            const container = canvasLayerRef.current?.parentElement;
            if (!container) return;
            const rect = container.getBoundingClientRect();
            if (!rect.width || !rect.height) return;

            // 角色资产库锚点卡为固定左列 (left:40, top:60, 宽 220, 行距 246, 高约 230)，与渲染层布局常量保持一致
            const boxes = characters.map((c, i) => ({ x: 40, y: 60 + i * 246, w: 220, h: 230 }));
            panels.forEach(p => boxes.push({ x: p.x, y: p.y, w: p.width || 280, h: p.height || 420 }));
            if (!boxes.length) {
              handleResetView();
              return;
            }

            const pad = 80;
            const minX = Math.min(...boxes.map(b => b.x)) - pad;
            const minY = Math.min(...boxes.map(b => b.y)) - pad;
            const contentW = Math.max(...boxes.map(b => b.x + b.w)) + pad - minX;
            const contentH = Math.max(...boxes.map(b => b.y + b.h)) + pad - minY;

            const nextZoom = Math.min(5.0, Math.max(0.05, Math.min(rect.width / contentW, rect.height / contentH)));
            viewportRef.current = {
              x: (rect.width - contentW * nextZoom) / 2 - minX * nextZoom,
              y: (rect.height - contentH * nextZoom) / 2 - minY * nextZoom,
              zoom: nextZoom
            };
            updateTransform();
            setZoomDisplay(Math.round(nextZoom * 100));
          };

          const handleZoomStep = (inOut) => {
            const cur = viewportRef.current;
            const factor = inOut ? 1.2 : 0.833;
            const nextZoom = Math.min(5.0, Math.max(0.05, cur.zoom * factor));
            cur.zoom = nextZoom;
            updateTransform();
            setZoomDisplay(Math.round(nextZoom * 100));
          };

          // 统一快捷键管理器 (CANVAS-M1 1.1): 画布全部键盘快捷键在此单一注册；
          // 输入控件聚焦时统一失效 (决策 D4)，后续 V/H/Del/框选等按键只需在此追加分支
          const isEditableTarget = (target) => {
            if (!target) return false;
            const tag = (target.tagName || '').toUpperCase();
            return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || Boolean(target.isContentEditable);
          };

          // 依赖 panels/characters/selectedIds/activeTool 以刷新闭包 (撤销栈与选择集操作)
          React.useEffect(() => {
            const handleCanvasShortcut = (e) => {
              if (isEditableTarget(e.target)) return;
              if (e.code === 'Space' && !e.repeat) {
                isSpacePressedRef.current = true;
                if (canvasLayerRef.current) canvasLayerRef.current.style.cursor = 'grab';
                return;
              }
              // 无修饰键: 工具切换、选择集操作与节点创建 (CANVAS-M1 1.4/1.7, CANVAS-M2 2.5)
              if (!(e.ctrlKey || e.metaKey)) {
                const k = e.key.toLowerCase();
                // Alt 组合: 成组/解组 (LibTV Ctrl/Alt+G 双绑定) 与整理画布 Alt+Shift+F (CANVAS-M3 3.1/3.2)
                if (e.altKey) {
                  if (k === 'g') {
                    e.preventDefault();
                    if (e.shiftKey) ungroupSelection(); else groupSelection();
                  } else if (k === 'f') {
                    e.preventDefault();
                    tidyCanvas();
                  }
                  return;
                }
                if (k === 'v') {
                  setActiveTool('select');
                } else if (k === 'h') {
                  setActiveTool('grab');
                } else if (e.key === 'Escape') {
                  setConnectMode(null);
                  setNodeMenu(null);
                  setSearchOpen(false);
                  setSelectedIds(new Set());
                } else if (e.key === 'Tab') {
                  e.preventDefault();
                  const rect = canvasLayerRef.current?.parentElement?.getBoundingClientRect();
                  if (!rect) return;
                  const zoom = viewportRef.current.zoom || 1;
                  setNodeMenu({
                    screenX: rect.width / 2,
                    screenY: rect.height / 2,
                    worldX: (rect.width / 2 - viewportRef.current.x) / zoom,
                    worldY: (rect.height / 2 - viewportRef.current.y) / zoom
                  });
                } else if (e.key === 'Delete' || e.key === 'Backspace') {
                  if (!selectedIds.size) return;
                  e.preventDefault();
                  if (typeof confirm !== 'undefined' && !confirm('确定要删除选中的内容吗？关联连线将一并移除，此操作可按 Ctrl+Z 撤销。')) return;
                  if (canvasHistoryManager) {
                    canvasHistoryManager.pushState(snapshotState());
                  }
                  setPanels(prev => prev.filter(x => !selectedIds.has(x.id)));
                  setCanvasItems(prev => prev.filter(x => !selectedIds.has(x.id)));
                  setEdges(prev => prev.filter(x => !selectedIds.has(x.id) && !selectedIds.has(x.from.id) && !selectedIds.has(x.to.id)));
                  setSelectedIds(new Set());
                }
                return;
              }
              // 修饰键组合 (LibTV 对标快捷键)
              const key = e.key.toLowerCase();
              if (key === 'z') {
                e.preventDefault();
                if (e.shiftKey) handleRedo(); else handleUndo();
              } else if (key === 'y') {
                e.preventDefault();
                handleRedo();
              } else if (key === 'a') {
                e.preventDefault();
                setSelectedIds(new Set([...panels.map(p => p.id), ...canvasItems.map(it => it.id)]));
              } else if (key === 'l') {
                e.preventDefault();
                setConnectMode(prev => prev ? null : { from: null });
              } else if (key === 'd') {
                e.preventDefault();
                duplicateSelection();
              } else if (key === 'g') {
                // CANVAS-M3 3.1: Ctrl+G 成组 / Ctrl+Shift+G 解组 / Ctrl+Alt+G 合并分镜组
                e.preventDefault();
                if (e.altKey) mergeSelectedGroups();
                else if (e.shiftKey) ungroupSelection();
                else groupSelection();
              } else if (key === 'f') {
                // CANVAS-M3 3.2/3.3: Ctrl+F 节点搜索 / Ctrl+Shift+F 整理画布
                e.preventDefault();
                if (e.shiftKey) tidyCanvas(); else setSearchOpen(true);
              } else if (key === 'enter') {
                e.preventDefault();
                // CANVAS-M2 2.7: 批量生成所选分镜 (受控间隔入队，防并发击穿)
                const targetIds = panels.filter(p => selectedIds.has(p.id)).map(p => p.id);
                if (!targetIds.length) return;
                targetIds.forEach((id, i) => setTimeout(() => handleGeneratePanel(id), i * 350));
              } else if (key === '=' || key === '+') {
                e.preventDefault();
                handleZoomStep(true);
              } else if (key === '-') {
                e.preventDefault();
                handleZoomStep(false);
              } else if (key === '0') {
                e.preventDefault();
                handleFitToContent();
              }
            };
            const handleCanvasShortcutKeyUp = (e) => {
              if (e.code === 'Space') {
                isSpacePressedRef.current = false;
                if (canvasLayerRef.current) canvasLayerRef.current.style.cursor = activeTool === 'grab' ? 'grab' : 'default';
              }
            };
            window.addEventListener('keydown', handleCanvasShortcut);
            window.addEventListener('keyup', handleCanvasShortcutKeyUp);
            return () => {
              window.removeEventListener('keydown', handleCanvasShortcut);
              window.removeEventListener('keyup', handleCanvasShortcutKeyUp);
            };
          }, [panels, characters, canvasItems, edges, groups, selectedIds, activeTool]);

          // ==========================================
          // CANVAS-M2 核心辅助: 生成图落画布 / 连线 / 通用拖拽 / 复制三件套 / 新建节点
          // ==========================================

          // 2.2 生成图节点落地: 以源分镜右侧为锚, 同分镜多候选纵向错位, 按 URL 去重
          const spawnImageNodeForPanel = (srcPanel, url) => {
            if (!srcPanel || !url) return;
            if (canvasItemsRef.current.some(it => it.type === 'image' && it.data && it.data.url === url)) return;
            const countForPanel = canvasItemsRef.current.filter(it => it.sourcePanelId === srcPanel.id).length;
            const stamp = Date.now();
            const itemId = `item_${stamp}_${Math.floor(Math.random() * 1e4)}`;
            const newItem = {
              id: itemId,
              type: 'image',
              x: CanvasMathUtils ? CanvasMathUtils.snapToGrid((srcPanel.x || 0) + (srcPanel.width || 280) + 24, 8) : (srcPanel.x || 0) + (srcPanel.width || 280) + 24,
              y: CanvasMathUtils ? CanvasMathUtils.snapToGrid((srcPanel.y || 0) + countForPanel * 32, 8) : (srcPanel.y || 0) + countForPanel * 32,
              width: 240,
              height: 320,
              data: { url, prompt: srcPanel.prompt || '' },
              sourcePanelId: srcPanel.id,
              createdAt: stamp
            };
            const newEdge = {
              id: `edge_${stamp}_${Math.floor(Math.random() * 1e4)}`,
              from: { type: 'panel', id: srcPanel.id },
              to: { type: 'item', id: itemId }
            };
            setCanvasItems(prev => [...prev, newItem]);
            setEdges(prev => [...prev, newEdge]);
          };

          // 2.4 建边 (去重 + 撤销快照)
          const createEdge = (from, to) => {
            if (!from || !to || from.id === to.id) return;
            if (canvasHistoryManager) canvasHistoryManager.pushState(snapshotState());
            setEdges(prev => prev.some(x => x.from.id === from.id && x.to.id === to.id)
              ? prev
              : [...prev, { id: `edge_${Date.now()}_${Math.floor(Math.random() * 1e4)}`, from, to }]);
          };

          // 2.4 Ctrl+L 连线模式: 两次点击 (源 → 目标)
          const handleConnectNodeClick = (type, id) => {
            if (!connectMode) return;
            if (!connectMode.from) {
              setConnectMode({ from: { type, id } });
              return;
            }
            if (connectMode.from.id === id) {
              setConnectMode({ from: null });
              return;
            }
            createEdge(connectMode.from, { type, id });
            setConnectMode({ from: null });
          };

          // 2.4 锚点拖出连线: 指针释放时以 elementFromPoint 命中 data-node-id 目标
          const beginConnectDrag = (e, type, id) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            e.preventDefault();
            const worldOf = (clientX, clientY) => {
              const rect = canvasLayerRef.current?.parentElement?.getBoundingClientRect();
              if (!rect) return { x: 0, y: 0 };
              const zoom = viewportRef.current.zoom || 1;
              return {
                x: (clientX - rect.left - viewportRef.current.x) / zoom,
                y: (clientY - rect.top - viewportRef.current.y) / zoom
              };
            };
            const start = worldOf(e.clientX, e.clientY);
            const cd = { from: { type, id }, x: start.x, y: start.y };
            connectDragRef.current = cd;
            setConnectDrag(cd);
            const move = (ev) => {
              const p = worldOf(ev.clientX, ev.clientY);
              const next = { ...(connectDragRef.current || cd), x: p.x, y: p.y };
              connectDragRef.current = next;
              setConnectDrag(next);
            };
            const up = (ev) => {
              window.removeEventListener('pointermove', move);
              window.removeEventListener('pointerup', up);
              const cur = connectDragRef.current;
              connectDragRef.current = null;
              setConnectDrag(null);
              if (!cur) return;
              const el = document.elementFromPoint(ev.clientX, ev.clientY);
              const holder = el && el.closest ? el.closest('[data-node-id]') : null;
              const targetId = holder ? holder.getAttribute('data-node-id') : null;
              if (targetId && targetId !== id) {
                const targetType = holder.getAttribute('data-node-type') === 'panel' ? 'panel' : 'item';
                createEdge({ type, id }, { type: targetType, id: targetId });
              }
            };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
          };

          // 2.6 克隆器: Alt+拖动=克隆(不带线); Ctrl+Alt+拖动=克隆并保留对外连线 (决策 D3 语义待 LibTV 视频核实)
          const cloneCanvasObject = (kind, obj, withEdges) => {
            const stamp = Date.now();
            const rand = Math.floor(Math.random() * 1e4);
            if (kind === 'panel') {
              const data = {
                ...obj,
                id: `shot_${stamp}_${rand}`,
                num: panels.reduce((m, p) => Math.max(m, p.num || 0), 0) + 1,
                x: obj.x + 24,
                y: obj.y + 24,
                isGenerating: false,
                stagingCandidateUrl: null
              };
              const newEdges = withEdges
                ? edges
                    .filter(ed => (ed.from.id === obj.id) !== (ed.to.id === obj.id))
                    .map(ed => ({
                      ...ed,
                      id: `edge_${stamp}_${rand}_${Math.floor(Math.random() * 1e4)}`,
                      from: ed.from.id === obj.id ? { ...ed.from, id: data.id } : ed.from,
                      to: ed.to.id === obj.id ? { ...ed.to, id: data.id } : ed.to
                    }))
                : [];
              return { kind: 'panel', data, edges: newEdges };
            }
            const data = { ...obj, id: `item_${stamp}_${rand}`, x: obj.x + 24, y: obj.y + 24 };
            return { kind: 'item', data, edges: [] };
          };

          // 2.3/2.6 通用画布对象拖拽启动器: 分镜卡与通用节点共用 (多选整体移动 + Alt 克隆 + 连线模式接管)
          const beginObjectDrag = (e, kind, obj) => {
            // 仅左键进入拖拽; 中键/右键放行给容器 (中键漫游 / 右键菜单)
            if (e.button !== 0) return;
            if (e.target.tagName === 'SELECT' || e.target.tagName === 'BUTTON' || e.target.tagName === 'OPTION' || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            e.stopPropagation();
            if (connectMode) {
              handleConnectNodeClick(kind === 'panel' ? 'panel' : 'item', obj.id);
              return;
            }
            if (e.shiftKey) {
              toggleSelectId(obj.id);
              return;
            }
            let dragObj = obj;
            if (e.altKey && e.button === 0) {
              const clone = cloneCanvasObject(kind, dragObj, e.ctrlKey || e.metaKey);
              if (!clone) return;
              if (canvasHistoryManager) canvasHistoryManager.pushState(snapshotState());
              if (clone.kind === 'panel') setPanels(prev => [...prev, clone.data]);
              else setCanvasItems(prev => [...prev, clone.data]);
              if (clone.edges.length) setEdges(prev => [...prev, ...clone.edges]);
              setSelectedIds(new Set([clone.data.id]));
              dragObj = clone.data;
            }
            const dragIds = (selectedIds.has(dragObj.id) && selectedIds.size > 1)
              ? Array.from(selectedIds)
              : [dragObj.id];
            if (!selectedIds.has(dragObj.id) || selectedIds.size !== 1) {
              setSelectedIds(new Set([dragObj.id]));
            }
            // CANVAS-M3 3.1: 拖动组成员时整组随动 (Figma 惯例)
            const preSet = new Set(dragIds);
            groups.forEach(g => {
              const ids = g.memberIds || [];
              if (ids.some(id => preSet.has(id))) {
                ids.forEach(id => {
                  if (!preSet.has(id)) {
                    preSet.add(id);
                    dragIds.push(id);
                  }
                });
              }
            });
            const dragIdSet = new Set(dragIds);
            const originals = [];
            for (const id of dragIds) {
              const ps = panels.find(x => x.id === id);
              if (ps) {
                originals.push({ kind: 'panel', id, x: ps.x, y: ps.y, w: ps.width || 280, h: ps.height || 420 });
                continue;
              }
              const it = canvasItems.find(x => x.id === id);
              if (it) originals.push({ kind: 'item', id, x: it.x, y: it.y, w: it.width || 240, h: it.height || 320 });
            }
            const startX = e.clientX;
            const startY = e.clientY;
            let hasMoved = false;

            const handleDragMove = (moveEvt) => {
              const zoom = viewportRef.current.zoom || 1;
              const dx = (moveEvt.clientX - startX) / zoom;
              const dy = (moveEvt.clientY - startY) / zoom;
              if (!hasMoved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
                hasMoved = true;
                if (canvasHistoryManager) {
                  canvasHistoryManager.pushState(snapshotState());
                }
              }
              if (hasMoved && originals.length) {
                const primary = originals[0];
                const rawX = primary.x + dx;
                const rawY = primary.y + dy;
                const snappedX = CanvasMathUtils ? CanvasMathUtils.snapToGrid(rawX, 8) : Math.round(rawX);
                const snappedY = CanvasMathUtils ? CanvasMathUtils.snapToGrid(rawY, 8) : Math.round(rawY);
                const others = [];
                panels.forEach(x => { if (!dragIdSet.has(x.id)) others.push({ x: x.x, y: x.y, w: x.width || 280, h: x.height || 420 }); });
                canvasItems.forEach(x => { if (!dragIdSet.has(x.id)) others.push({ x: x.x, y: x.y, w: x.width || 240, h: x.height || 320 }); });
                const guided = (CanvasMathUtils && CanvasMathUtils.computeAlignGuides)
                  ? CanvasMathUtils.computeAlignGuides({ x: snappedX, y: snappedY, w: primary.w, h: primary.h }, others, 6)
                  : { dx: 0, dy: 0, guides: [] };
                const fixX = snappedX + guided.dx - rawX;
                const fixY = snappedY + guided.dy - rawY;
                setAlignGuides(guided.guides || []);
                setPanels(prev => prev.map(item => {
                  const o = originals.find(t => t.kind === 'panel' && t.id === item.id);
                  return o ? { ...item, x: o.x + dx + fixX, y: o.y + dy + fixY } : item;
                }));
                setCanvasItems(prev => prev.map(item => {
                  const o = originals.find(t => t.kind === 'item' && t.id === item.id);
                  return o ? { ...item, x: o.x + dx + fixX, y: o.y + dy + fixY } : item;
                }));
              }
            };

            const handleDragUp = () => {
              window.removeEventListener('pointermove', handleDragMove);
              window.removeEventListener('pointerup', handleDragUp);
              setAlignGuides([]);
            };

            window.addEventListener('pointermove', handleDragMove);
            window.addEventListener('pointerup', handleDragUp);
          };

          // 2.6 Ctrl+D 复制所选节点和连线 (内部连线随副本复制, 对外连线不复制)
          const duplicateSelection = () => {
            if (!selectedIds.size) return;
            if (canvasHistoryManager) canvasHistoryManager.pushState(snapshotState());
            const stamp = Date.now();
            const rand = () => Math.floor(Math.random() * 1e4);
            const idMap = new Map();
            const newPanels = [];
            const newItems = [];
            panels.forEach(p => {
              if (!selectedIds.has(p.id)) return;
              const nid = `shot_${stamp}_${rand()}`;
              idMap.set(p.id, nid);
              newPanels.push({ ...p, id: nid, num: 0, x: p.x + 24, y: p.y + 24, isGenerating: false, stagingCandidateUrl: null });
            });
            let baseNum = panels.reduce((m, p) => Math.max(m, p.num || 0), 0);
            newPanels.forEach(np => { baseNum += 1; np.num = baseNum; });
            canvasItems.forEach(it => {
              if (!selectedIds.has(it.id)) return;
              const nid = `item_${stamp}_${rand()}`;
              idMap.set(it.id, nid);
              newItems.push({ ...it, id: nid, x: it.x + 24, y: it.y + 24 });
            });
            if (!newPanels.length && !newItems.length) return;
            const newEdges = edges
              .filter(ed => idMap.has(ed.from.id) && idMap.has(ed.to.id))
              .map(ed => ({ ...ed, id: `edge_${stamp}_${rand()}`, from: { ...ed.from, id: idMap.get(ed.from.id) }, to: { ...ed.to, id: idMap.get(ed.to.id) } }));
            if (newPanels.length) setPanels(prev => [...prev, ...newPanels]);
            if (newItems.length) setCanvasItems(prev => [...prev, ...newItems]);
            if (newEdges.length) setEdges(prev => [...prev, ...newEdges]);
            setSelectedIds(new Set(idMap.values()));
          };

          // ==========================================
          // CANVAS-M3 组织力: 成组 / 解组 / 合并分镜组 / 整理画布 / 节点搜索
          // ==========================================

          // 3.1 成组所选 (分镜卡与通用节点通用)
          const groupSelection = () => {
            const members = [...panels.map(p => p.id), ...canvasItems.map(it => it.id)].filter(id => selectedIds.has(id));
            if (!members.length) return;
            if (canvasHistoryManager) canvasHistoryManager.pushState(snapshotState());
            setGroups(prev => [...prev, {
              id: `grp_${Date.now()}_${Math.floor(Math.random() * 1e4)}`,
              name: `组 ${prev.length + 1}`,
              memberIds: members,
              createdAt: Date.now()
            }]);
          };

          // 3.1 解组: 所选成员从所属组移除, 空组自动清除
          const ungroupSelection = () => {
            if (!selectedIds.size) return;
            const affected = groups.filter(g => (g.memberIds || []).some(id => selectedIds.has(id)));
            if (!affected.length) return;
            if (canvasHistoryManager) canvasHistoryManager.pushState(snapshotState());
            setGroups(prev => prev
              .map(g => ({ ...g, memberIds: (g.memberIds || []).filter(id => !selectedIds.has(id)) }))
              .filter(g => (g.memberIds || []).length > 0));
          };

          // 3.1 合并分镜组: 所有含所选成员的组并入第一个组 (Ctrl+Alt+G)
          const mergeSelectedGroups = () => {
            const affected = groups.filter(g => (g.memberIds || []).some(id => selectedIds.has(id)));
            if (affected.length < 2) return;
            if (canvasHistoryManager) canvasHistoryManager.pushState(snapshotState());
            const mergedIds = [];
            affected.forEach(g => (g.memberIds || []).forEach(id => {
              if (!mergedIds.includes(id)) mergedIds.push(id);
            }));
            const keepId = affected[0].id;
            const removeIds = affected.slice(1).map(a => a.id);
            setGroups(prev => prev
              .map(g => g.id === keepId ? { ...g, memberIds: mergedIds } : g)
              .filter(g => !removeIds.includes(g.id)));
          };

          // 3.2 整理画布 (Alt+Shift+F / Ctrl+Shift+F): 自动布局 + 适应画布
          const tidyCanvas = () => {
            if (!CanvasMathUtils || !CanvasMathUtils.layoutCanvas) return;
            const { panelMoves, itemMoves } = CanvasMathUtils.layoutCanvas(panels, canvasItems, groups);
            if (!panelMoves.length && !itemMoves.length) return;
            if (canvasHistoryManager) canvasHistoryManager.pushState(snapshotState());
            const pm = new Map(panelMoves.map(m => [m.id, m]));
            const im = new Map(itemMoves.map(m => [m.id, m]));
            setPanels(prev => prev.map(p => pm.has(p.id) ? { ...p, x: pm.get(p.id).x, y: pm.get(p.id).y } : p));
            setCanvasItems(prev => prev.map(it => im.has(it.id) ? { ...it, x: im.get(it.id).x, y: im.get(it.id).y } : it));
            setTimeout(() => handleFitToContent(), 60);
          };

          // 3.3 将节点居中到视口中央
          const centerViewportOn = (box) => {
            const rect = canvasLayerRef.current?.parentElement?.getBoundingClientRect();
            if (!rect || !box) return;
            const zoom = viewportRef.current.zoom || 1;
            viewportRef.current.x = rect.width / 2 - (box.x + (box.width || 280) / 2) * zoom;
            viewportRef.current.y = rect.height / 2 - (box.y + (box.height || 420) / 2) * zoom;
            updateTransform();
            setViewportTick(t => t + 1);
          };

          // 3.3 搜索结果应用: 选中 + 定位居中 (组结果选中全体成员)
          const applySearchResult = (r) => {
            setSearchOpen(false);
            if (!r) return;
            if (r.kind === 'group') {
              const g = groups.find(x => x.id === r.id);
              if (!g) return;
              const ids = (g.memberIds || []).filter(id => panels.some(p => p.id === id) || canvasItems.some(it => it.id === id));
              setSelectedIds(new Set(ids));
              return;
            }
            setSelectedIds(new Set([r.id]));
            if (r.box) centerViewportOn(r.box);
          };

          // 3.3 搜索结果集 (镜号/景别/提示词/台词/角色名/节点文本/组名)
          const searchResults = React.useMemo(() => {
            const q = searchQuery.trim().toLowerCase();
            if (!searchOpen || !q) return [];
            const out = [];
            panels.forEach(p => {
              const char = characters.find(c => c.id === p.characterId);
              const hay = [`#${p.num}`, p.shotLabel || '', p.prompt || '', p.dialogue || '', char ? char.name : ''].join(' ').toLowerCase();
              if (hay.includes(q)) {
                out.push({
                  kind: 'panel',
                  id: p.id,
                  label: `分镜 #${p.num} · ${p.shotLabel || ''}${char ? ` · ${char.name}` : ''}`,
                  snippet: (p.prompt || '').slice(0, 48),
                  box: { x: p.x, y: p.y, width: p.width || 280, height: p.height || 420 }
                });
              }
            });
            canvasItems.forEach(it => {
              const hay = [it.data && it.data.prompt, it.data && it.data.text].filter(Boolean).join(' ').toLowerCase();
              if (hay.includes(q)) {
                out.push({
                  kind: it.type || 'item',
                  id: it.id,
                  label: it.type === 'image' ? '图片节点' : '文本便签',
                  snippet: ((it.data && (it.data.prompt || it.data.text)) || '').slice(0, 48),
                  box: { x: it.x, y: it.y, width: it.width || 240, height: it.height || 320 }
                });
              }
            });
            groups.forEach(g => {
              if ((g.name || '').toLowerCase().includes(q)) {
                out.push({ kind: 'group', id: g.id, label: `分镜组 · ${g.name || '未命名'}`, snippet: `${(g.memberIds || []).length} 个成员`, box: null });
              }
            });
            return out.slice(0, 8);
          }, [searchOpen, searchQuery, panels, canvasItems, groups, characters]);

          // ==========================================
          // CANVAS-M4 客户端部分: AI 剧本拆镜自动铺图
          // (对标 LibTV 脚本生成器: 粘贴剧本 → 对话模型结构化拆解 → 分镜卡阵列自动落画布)
          // ==========================================

          const runAiSplit = async () => {
            if (aiSplitBusy) return;
            const script = aiSplitText.trim();
            if (!script) {
              alert('请先粘贴剧本文本');
              return;
            }
            const apiKey = getKey();
            if (!apiKey) {
              alert('未检测到 API Key，请先点击顶栏钥匙图标输入');
              return;
            }
            const usable = (availableChatModels || []).filter(m => m && m.id && m.enabled !== false);
            // 优先用用户在弹窗里选的模型；未选或已下线则退回列表首个；manifest 为空时用生产兜底
            const picked = usable.find(m => m.id === aiSplitModel);
            const chosen = (picked || usable[0] || {}).id || 'deepseek-v4.1-flash';
            const count = Math.max(2, Math.min(12, Number(aiSplitCount) || 6));
            setAiSplitBusy(true);
            try {
              const systemPrompt = '你是资深漫剧分镜师。把用户给出的剧本文本拆解为指定数量的分镜。只输出 JSON 数组，禁止输出任何解释文字。数组每个元素形如 {"shot":"CU|MS|WS|FS","shotLabel":"特写|中景|远景|全景","prompt":"画面提示词，包含角色外貌DNA、构图与光影","dialogue":"该镜台词，没有则为空字符串"}。';
              const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                  model: chosen,
                  messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: `拆解为 ${count} 个分镜：\n\n${script}` }
                  ],
                  temperature: 0.7
                })
              });
              if (!res.ok) {
                const errJson = await res.json().catch(() => ({}));
                throw new Error(errJson.error?.message || `HTTP ${res.status}`);
              }
              const data = await res.json();
              const content = data.choices?.[0]?.message?.content || '';
              const shots = CanvasMathUtils && CanvasMathUtils.parseStoryboardJSON
                ? CanvasMathUtils.parseStoryboardJSON(content)
                : [];
              if (!shots.length) throw new Error('模型未返回可解析的分镜 JSON，请重试或更换对话模型');

              if (canvasHistoryManager) canvasHistoryManager.pushState(snapshotState());
              // 起排位置: 现有内容下方空带，从角色列右侧 360px 起
              let maxY = 60;
              panels.forEach(p => { maxY = Math.max(maxY, (p.y || 0) + (p.height || 420)); });
              canvasItems.forEach(it => { maxY = Math.max(maxY, (it.y || 0) + (it.height || 320)); });
              const baseNum = panels.reduce((m, p) => Math.max(m, p.num || 0), 0);
              const startY = CanvasMathUtils ? CanvasMathUtils.snapToGrid(maxY + 40, 8) : maxY + 40;
              const newPanels = shots.map((s, i) => ({
                id: `shot_${Date.now()}_${i}`,
                num: baseNum + i + 1,
                x: CanvasMathUtils ? CanvasMathUtils.snapToGrid(360 + i * (280 + 40), 8) : 360 + i * 320,
                y: startY,
                width: 280,
                height: 420,
                aspectRatio: '2:3',
                shot: s.shot,
                shotLabel: s.shotLabel,
                prompt: s.prompt,
                dialogue: s.dialogue,
                characterId: characters[0]?.id || '',
                imageUrl: '',
                isGenerating: false,
                stagingCandidateUrl: null
              }));
              setPanels(prev => [...prev, ...newPanels]);
              setSelectedIds(new Set(newPanels.map(p => p.id)));
              setAiSplitOpen(false);
              setAiSplitText('');
              setTimeout(() => handleFitToContent(), 60);
            } catch (err) {
              alert(`AI 拆镜失败: ${err.message}`);
            } finally {
              setAiSplitBusy(false);
            }
          };

          // 2.5 自由生成节点创建引擎 (对标 LibTV §2.1 / §3.2.1)
          const createNodeAtWorld = (type, worldX, worldY, initialData = {}) => {
            if (canvasHistoryManager) canvasHistoryManager.pushState(snapshotState());
            const snap = (v) => (CanvasMathUtils ? CanvasMathUtils.snapToGrid(v, 8) : Math.round(v));
            const wx = snap(worldX || 0);
            const wy = snap(worldY || 0);
            if (type === 'panel') {
              const nextNum = panels.reduce((m, p) => Math.max(m, p.num || 0), 0) + 1;
              const newP = {
                id: `shot_${Date.now()}`,
                num: nextNum,
                x: wx,
                y: wy,
                width: 280,
                height: 420,
                aspectRatio: initialData.aspectRatio || '2:3',
                shot: initialData.shot || 'CU',
                shotLabel: initialData.shotLabel || '特写',
                prompt: initialData.prompt || `镜头 #${nextNum}，人物画面，专业漫剧光影，构图严谨`,
                dialogue: initialData.dialogue || '',
                characterId: characters[0]?.id || '',
                imageUrl: initialData.imageUrl || '',
                tags: initialData.tags || [],
                isGenerating: false,
                stagingCandidateUrl: null
              };
              setPanels(prev => [...prev, newP]);
              setSelectedIds(new Set([newP.id]));
            } else if (type === 'character') {
              handleAddCharacter();
            } else if (type === 'image') {
              const defaultImageModel = canvasModel || WineTokenManifestManager.getFreeImageModel() || 'sensenova-u1.5-lite';
              const it = {
                id: `item_${Date.now()}`,
                type: 'image',
                x: wx,
                y: wy,
                width: 290,
                height: 460,
                data: {
                  url: initialData.url || '',
                  assetKey: initialData.assetKey || '',
                  prompt: initialData.prompt || '',
                  name: initialData.name || '图片生成节点',
                  tags: initialData.tags || [],
                  params: {
                    model: initialData.model || defaultImageModel,
                    aspectRatio: initialData.aspectRatio || '16:9',
                    quality: 'standard',
                    size: initialData.size || '1792x1024',
                    count: 1
                  }
                },
                sourcePanelId: initialData.sourcePanelId || null,
                createdAt: Date.now()
              };
              setCanvasItems(prev => [...prev, it]);
              setSelectedIds(new Set([it.id]));
            } else if (type === 'text') {
              const it = {
                id: `item_${Date.now()}`,
                type: 'text',
                x: wx,
                y: wy,
                width: 240,
                height: 160,
                data: {
                  text: initialData.text || '',
                  name: initialData.name || '文本便签',
                  tags: initialData.tags || []
                },
                sourcePanelId: null,
                createdAt: Date.now()
              };
              setCanvasItems(prev => [...prev, it]);
              setSelectedIds(new Set([it.id]));
            } else if (type === 'video') {
              const vs = CanvasVideoUtils ? CanvasVideoUtils.createVideoNodeState() : { status: 'idle', videoUrl: '', error: '' };
              const defaultVideoModel = (availableVideoModels[0]?.id) || 'MiniMax-H3';
              const it = {
                id: `item_${Date.now()}`,
                type: 'video',
                x: wx,
                y: wy,
                width: 330,
                height: 470,
                data: {
                  url: initialData.url || '',
                  assetKey: initialData.assetKey || '',
                  prompt: initialData.prompt || '',
                  name: initialData.name || '视频生成节点',
                  tags: initialData.tags || [],
                  videoState: vs,
                  params: {
                    model: initialData.model || defaultVideoModel,
                    duration: 5,
                    size: '1280x720',
                    resolution: '720P',
                    aspectRatio: '16:9',
                    generateAudio: false,
                    count: 1
                  }
                },
                sourcePanelId: null,
                createdAt: Date.now()
              };
              setCanvasItems(prev => [...prev, it]);
              setSelectedIds(new Set([it.id]));
            }
          };

          const createNodeAtCenter = (type, initialData = {}) => {
            const rect = canvasLayerRef.current?.parentElement?.getBoundingClientRect();
            const zoom = viewportRef.current.zoom || 1;
            const screenW = rect ? rect.width : (typeof window !== 'undefined' ? window.innerWidth : 1200);
            const screenH = rect ? rect.height : (typeof window !== 'undefined' ? window.innerHeight : 800);
            const worldX = (screenW / 2 - viewportRef.current.x) / zoom;
            const worldY = (screenH / 2 - viewportRef.current.y) / zoom;
            createNodeAtWorld(type, worldX, worldY, initialData);
          };

          const createNodeFromMenu = (type) => {
            if (!nodeMenu) return;
            const { worldX, worldY } = nodeMenu;
            setNodeMenu(null);
            createNodeAtWorld(type, worldX, worldY);
          };

          // 2.5 右键空白处新建节点 (对标桌面软件右键菜单惯例；Tab 快捷键保留)
          const handleCanvasContextMenu = (e) => {
            e.preventDefault(); // 画布右键语义专属"新建节点"，任何工具下均压制浏览器原生菜单
            if (activeTool !== 'select' || connectMode) return;
            const startedOnBackground = e.target === canvasLayerRef.current || e.target === e.currentTarget;
            if (!startedOnBackground) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const zoom = viewportRef.current.zoom || 1;
            setNodeMenu({
              screenX: e.clientX - rect.left,
              screenY: e.clientY - rect.top,
              worldX: (e.clientX - rect.left - viewportRef.current.x) / zoom,
              worldY: (e.clientY - rect.top - viewportRef.current.y) / zoom
            });
          };

          // LibTV 规格: 双击画布空白处快速新建节点
          const handleCanvasDoubleClick = (e) => {
            if (activeTool !== 'select' || connectMode) return;
            const startedOnBackground = e.target === canvasLayerRef.current || e.target === e.currentTarget;
            if (!startedOnBackground) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const zoom = viewportRef.current.zoom || 1;
            setNodeMenu({
              screenX: e.clientX - rect.left,
              screenY: e.clientY - rect.top,
              worldX: (e.clientX - rect.left - viewportRef.current.x) / zoom,
              worldY: (e.clientY - rect.top - viewportRef.current.y) / zoom
            });
          };

          // S3 标签与关键词管理
          const toggleNodeTag = (nodeId, nodeType, tagLabel) => {
            if (canvasHistoryManager) canvasHistoryManager.pushState(snapshotState());
            if (nodeType === 'panel') {
              setPanels(prev => prev.map(p => {
                if (p.id !== nodeId) return p;
                const oldTags = Array.isArray(p.tags) ? p.tags : [];
                const nextTags = oldTags.includes(tagLabel)
                  ? oldTags.filter(t => t !== tagLabel)
                  : [...oldTags, tagLabel];
                return { ...p, tags: nextTags };
              }));
            } else {
              setCanvasItems(prev => prev.map(it => {
                if (it.id !== nodeId) return it;
                const itData = it.data || {};
                const oldTags = Array.isArray(itData.tags) ? itData.tags : [];
                const nextTags = oldTags.includes(tagLabel)
                  ? oldTags.filter(t => t !== tagLabel)
                  : [...oldTags, tagLabel];
                return { ...it, data: { ...itData, tags: nextTags } };
              }));
            }
          };

          const addCustomKeyword = (nodeId, nodeType, keyword) => {
            const clean = (keyword || '').trim();
            if (!clean) return;
            toggleNodeTag(nodeId, nodeType, clean);
          };

          // S4 派生后处理动作 (高清/重绘/全景/多角度/重打光/图层拆分)
          const handleDeriveItem = (sourceItem, actionId) => {
            let displaySrc = sourceItem.data?.url || '';
            if (displaySrc.startsWith('asset:') && canvasAssetsDriver) {
              try { displaySrc = canvasAssetsDriver.readAsDataUrl(displaySrc.slice(6)); } catch (_) { displaySrc = ''; }
            }
            if (!displaySrc) {
              alert('该节点尚未生成或上传图片，请先获得图片后再执行派生后处理');
              return;
            }
            const action = CanvasPromptUtils ? CanvasPromptUtils.getDerivedAction(actionId) : null;
            const actionName = action ? action.name : actionId;
            const derivedPrompt = CanvasPromptUtils ? CanvasPromptUtils.buildDerivedPrompt(sourceItem.data?.prompt || '', actionId) : (sourceItem.data?.prompt || '');
            
            const snap = (v) => (CanvasMathUtils ? CanvasMathUtils.snapToGrid(v, 8) : Math.round(v));
            const newItemId = `item_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
            const newItemX = snap(sourceItem.x + (sourceItem.width || 290) + 40);
            const newItemY = snap(sourceItem.y);
            
            if (canvasHistoryManager) canvasHistoryManager.pushState(snapshotState());
            const newItem = {
              id: newItemId,
              type: 'image',
              x: newItemX,
              y: newItemY,
              width: sourceItem.width || 290,
              height: sourceItem.height || 460,
              data: {
                url: '',
                assetKey: '',
                prompt: derivedPrompt,
                name: `${sourceItem.data?.name || '图像'}_${actionName}`,
                tags: [...(sourceItem.data?.tags || [])],
                params: {
                  ...(sourceItem.data?.params || {}),
                  preset: actionId
                }
              },
              sourcePanelId: sourceItem.sourcePanelId || null,
              createdAt: Date.now()
            };
            const newEdge = {
              id: `edge_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              from: { type: 'item', id: sourceItem.id },
              to: { type: 'item', id: newItemId }
            };
            setCanvasItems(prev => [...prev, newItem]);
            setEdges(prev => [...prev, newEdge]);
            setSelectedIds(new Set([newItemId]));
            
            setTimeout(() => {
              handleGenerateItem(newItemId);
            }, 60);
          };

          // S4 裁剪确认
          const handleCropConfirm = (itemId, targetRatio) => {
            const item = canvasItems.find(x => x.id === itemId);
            if (!item) return;
            let displaySrc = item.data?.url || '';
            if (displaySrc.startsWith('asset:') && canvasAssetsDriver) {
              try { displaySrc = canvasAssetsDriver.readAsDataUrl(displaySrc.slice(6)); } catch (_) {}
            }
            if (!displaySrc) return;

            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
              const [rw, rh] = targetRatio.split(':').map(Number);
              const targetAspect = rw / rh;
              const imgAspect = img.width / img.height;
              let cropW, cropH, cropX, cropY;
              if (imgAspect > targetAspect) {
                cropH = img.height;
                cropW = Math.round(img.height * targetAspect);
                cropX = Math.round((img.width - cropW) / 2);
                cropY = 0;
              } else {
                cropW = img.width;
                cropH = Math.round(img.width / targetAspect);
                cropX = 0;
                cropY = Math.round((img.height - cropH) / 2);
              }
              const canvas = document.createElement('canvas');
              canvas.width = cropW;
              canvas.height = cropH;
              const ctx2d = canvas.getContext('2d');
              ctx2d.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
              const dataUrl = canvas.toDataURL('image/png');
              let newAssetKey = '';
              let newUrl = dataUrl;
              if (canvasAssetsDriver) {
                try {
                  const saved = canvasAssetsDriver.saveDataUrl(dataUrl);
                  newAssetKey = saved.assetKey;
                  newUrl = `asset:${newAssetKey}`;
                } catch (err) {
                  console.warn('[WineToken Canvas] 裁剪后落盘失败:', err.message);
                }
              }
              if (canvasHistoryManager) canvasHistoryManager.pushState(snapshotState());
              setCanvasItems(prev => prev.map(x => x.id === itemId ? {
                ...x,
                data: {
                  ...x.data,
                  url: newUrl,
                  assetKey: newAssetKey,
                  params: { ...(x.data?.params || {}), aspectRatio: targetRatio }
                }
              } : x));
              setCropModal(null);
            };
            img.src = displaySrc;
          };

          // S1/S2 存入资产库提交
          const handleSaveAssetSubmit = ({ itemId, name, category, description, tags }) => {
            const item = canvasItems.find(x => x.id === itemId);
            if (!item || !assetLibraryStore) return;
            let assetKey = item.data?.assetKey;
            let displaySrc = item.data?.url || '';
            if (!assetKey && displaySrc.startsWith('data:') && canvasAssetsDriver) {
              try {
                const saved = canvasAssetsDriver.saveDataUrl(displaySrc);
                assetKey = saved.assetKey;
                setCanvasItems(prev => prev.map(x => x.id === itemId ? { ...x, data: { ...x.data, assetKey, url: `asset:${assetKey}` } } : x));
              } catch (err) {
                alert(`保存资产失败: ${err.message}`);
                return;
              }
            }
            if (!assetKey) {
              alert('未检出有效本地资产键，请先确保图片已生成或落盘');
              return;
            }
            try {
              assetLibraryStore.addItem({
                assetKey,
                name: name || item.data?.name || '未命名资产',
                category: category || '自定义',
                description: description || item.data?.prompt || '',
                tags: Array.isArray(tags) ? tags : []
              });
              setAssetLibTick(t => t + 1);
              setSaveAssetModal(null);
              setCanvasItems(prev => prev.map(x => x.id === itemId ? { ...x, data: { ...x.data, name: name || x.data?.name } } : x));
            } catch (err) {
              alert(`存入资产库失败: ${err.message}`);
            }
          };

          // S1 调入资产到画布
          const handleUseAssetOnCanvas = (asset) => {
            if (!asset || !asset.assetKey) return;
            createNodeAtCenter('image', {
              url: `asset:${asset.assetKey}`,
              assetKey: asset.assetKey,
              name: asset.name,
              prompt: asset.description || asset.name,
              tags: asset.tags || []
            });
            if (assetLibraryStore) {
              assetLibraryStore.incrementUsage(asset.id);
              setAssetLibTick(t => t + 1);
            }
            setAssetLibraryOpen(false);
          };

          const handleDeleteAssetFromLibrary = (assetId) => {
            if (typeof confirm !== 'undefined' && !confirm('确定要从资产库中移除此资产吗？已在画布中引用的资产不受影响。')) return;
            if (assetLibraryStore) {
              assetLibraryStore.removeItem(assetId);
              setAssetLibTick(t => t + 1);
            }
          };

          const handleImportAssetFile = (e) => {
            const input = e.target;
            const file = input.files && input.files[0];
            // 立即重置输入值：否则失败后重选同一文件不再触发 change，表现为「点了没反应」
            if (input) input.value = '';
            if (!file) return;
            if (!canvasAssetsDriver || !assetLibraryStore) {
              alert('导入资产失败: 本地资产模块未加载，请重启应用后再试');
              return;
            }
            const finishImport = (dataUrl) => {
              try {
                const saved = canvasAssetsDriver.saveDataUrl(dataUrl);
                assetLibraryStore.addItem({
                  assetKey: saved.assetKey,
                  name: file.name.replace(/\.[^/.]+$/, ''),
                  category: assetLibCategory === '全部' ? '自定义' : assetLibCategory,
                  description: '从本地导入',
                  tags: []
                });
                setAssetLibTick(t => t + 1);
              } catch (err) {
                alert(`导入资产失败: ${err.message}`);
              }
            };
            const reader = new FileReader();
            reader.onload = () => {
              const dataUrl = String(reader.result);
              const mime = ((/^data:([^;]+);/.exec(dataUrl) || [])[1] || '').toLowerCase();
              if (['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4', 'video/webm'].includes(mime)) {
                finishImport(dataUrl);
                return;
              }
              // 白名单外图片 (bmp/avif/heic/tiff 等)：经画布转码为 PNG 再落盘，不再静默拒绝
              if (mime.startsWith('image/')) {
                const img = new Image();
                img.onload = () => {
                  try {
                    const canvas = document.createElement('canvas');
                    canvas.width = img.naturalWidth || img.width;
                    canvas.height = img.naturalHeight || img.height;
                    canvas.getContext('2d').drawImage(img, 0, 0);
                    finishImport(canvas.toDataURL('image/png'));
                  } catch (err) {
                    alert(`导入资产失败: 图片转码失败 (${err.message})`);
                  }
                };
                img.onerror = () => alert(`导入资产失败: 无法解码该图片格式 (${mime})，请先另存为 PNG/JPG 再导入`);
                img.src = dataUrl;
                return;
              }
              alert(`导入资产失败: 不支持的文件类型 (${mime || '未知'})，仅支持图片与 MP4/WebM 视频`);
            };
            reader.onerror = () => alert('导入资产失败: 读取本地文件失败，请重试');
            reader.readAsDataURL(file);
          };

          // 添加新角色锚点卡
          const handleAddCharacter = () => {
            const newChar = {
              id: `char_${Date.now()}`,
              name: `新角色 ${characters.length + 1}`,
              dna: '面容清晰，发型规整，服饰统一，插画质感',
              avatar: ''
            };
            setCharacters(prev => [...prev, newChar]);
          };

          // 删除角色卡 (自动将依赖该角色的分镜安全回退至主角，杜绝空悬报错)
          const handleDeleteCharacter = (charId) => {
            if (characters.length <= 1) return;
            const fallbackCharId = characters.find(c => c.id !== charId)?.id || characters[0].id;
            setCharacters(prev => prev.filter(c => c.id !== charId));
            setPanels(prev => prev.map(p => p.characterId === charId ? { ...p, characterId: fallbackCharId } : p));
          };

          // 添加新分镜卡 (支持指定归属角色，未指定则取第一个角色)
          const handleAddPanel = (aspectRatio = '2:3', shot = 'CU', shotLabel = '特写', targetCharId = null) => {
            const nextNum = panels.length + 1;
            const lastPanel = panels[panels.length - 1];
            const newX = lastPanel ? lastPanel.x + lastPanel.width + 40 : 360;
            const newY = lastPanel ? lastPanel.y : 60;
            const w = aspectRatio === '16:9' ? 360 : 280;
            const h = aspectRatio === '16:9' ? 240 : 420;
            const assignedCharId = targetCharId || characters[0]?.id || '';

            const newP = {
              id: `shot_${Date.now()}`,
              num: nextNum,
              x: newX,
              y: newY,
              width: w,
              height: h,
              aspectRatio: aspectRatio,
              shot: shot,
              shotLabel: shotLabel,
              prompt: `镜头 #${nextNum}，人物画面，专业漫剧光影，构图严谨`,
              dialogue: '',
              characterId: assignedCharId,
              imageUrl: '',
              isGenerating: false,
              stagingCandidateUrl: null
            };
            setPanels(prev => [...prev, newP]);
          };

          // 加载四格漫画预设模版
          const handleLoad4KomaTemplate = () => {
            const char = {
              id: 'char_hero',
              name: '主角·林风',
              dna: '黑发少年，高领运动夹克，眼神明朗，现代漫画风格',
              avatar: ''
            };
            setCharacters([char]);
            setPanels([
              {
                id: 'koma_1',
                num: 1,
                x: 360,
                y: 60,
                width: 280,
                height: 280,
                aspectRatio: '1:1',
                shot: 'WS',
                shotLabel: '远景',
                prompt: '晨光洒落在空旷的操场，安静而开阔，日系清新漫画风格',
                dialogue: '“新学期的第一天，天气晴朗。”',
                characterId: 'char_hero',
                imageUrl: '',
                isGenerating: false,
                stagingCandidateUrl: null
              },
              {
                id: 'koma_2',
                num: 2,
                x: 680,
                y: 60,
                width: 280,
                height: 280,
                aspectRatio: '1:1',
                shot: 'MS',
                shotLabel: '中景',
                prompt: '少年小跑奔向校门口，背着单肩包，神情匆忙',
                dialogue: '“糟了，闹钟居然没响！”',
                characterId: 'char_hero',
                imageUrl: '',
                isGenerating: false,
                stagingCandidateUrl: null
              },
              {
                id: 'koma_3',
                num: 3,
                x: 1000,
                y: 60,
                width: 280,
                height: 280,
                aspectRatio: '1:1',
                shot: 'CU',
                shotLabel: '特写',
                prompt: '少年惊讶的表情特写，目光直视前方，大汗淋漓',
                dialogue: '“校门……已经关上了？！”',
                characterId: 'char_hero',
                imageUrl: '',
                isGenerating: false,
                stagingCandidateUrl: null
              },
              {
                id: 'koma_4',
                num: 4,
                x: 1320,
                y: 60,
                width: 280,
                height: 280,
                aspectRatio: '1:1',
                shot: 'FS',
                shotLabel: '全景',
                prompt: '少年呆呆站在紧闭的校门前，头顶乌鸦飞过，幽默漫画定格',
                dialogue: '“今天原来是星期天啊……”',
                characterId: 'char_hero',
                imageUrl: '',
                isGenerating: false,
                stagingCandidateUrl: null
              }
            ]);
            handleResetView();
          };

          // 执行单格分镜绘制 (调度商汤 4K 限免或 GPT-Image)
          const handleGeneratePanel = async (panelId) => {
            const target = panels.find(p => p.id === panelId);
            if (!target || target.isGenerating) return;

            // 对标 infinite-canvas: 连线是生成输入。收集指向该分镜的上游文本/图片/参数覆盖
            // (纯函数，脏数据绝不抛错)；无上游节点时行为与旧版完全一致，保证零回归。
            const projectSnapshot = { characters, panels, canvasItems, edges, groups };
            const genContext = CanvasNodeUtils && CanvasNodeUtils.buildGenerationContext
              ? CanvasNodeUtils.buildGenerationContext(projectSnapshot, panelId)
              : { prompt: '', referenceImages: [], texts: [], params: {}, warnings: [] };
            const upstreamRefs = genContext.referenceImages.filter(r => typeof r === 'string' && r.trim());
            const resolveRef = (ref) => {
              if (ref.startsWith('asset:') && canvasAssetsDriver && canvasAssetsDriver.exists(ref.slice(6))) {
                try { return canvasAssetsDriver.readAsDataUrl(ref.slice(6)); } catch (_) { return null; }
              }
              return ref.startsWith('asset:') ? null : ref;
            };

            setPanels(prev => prev.map(p => p.id === panelId ? { ...p, isGenerating: true } : p));

            try {
              const char = characters.find(c => c.id === target.characterId);
              let fullPrompt = target.prompt;
              if (char) {
                fullPrompt = `${char.dna}，${target.prompt}，${target.shotLabel}镜头，画面张力`;
              }
              // 上游文本节点作为提示词补充 (去重与 4000 字上限由纯函数保证)
              if (genContext.prompt && genContext.prompt !== target.prompt) {
                fullPrompt = genContext.prompt.includes(target.prompt)
                  ? genContext.prompt
                  : `${fullPrompt}，${genContext.prompt}`;
              }

              // 尺寸对齐: 上游参数覆盖优先，但一律 clamp 到 32 倍数 (沿用既有铁律)
              let reqSize = '1024x1024';
              if (target.aspectRatio === '2:3') reqSize = '1024x1536';
              else if (target.aspectRatio === '16:9') reqSize = '1536x1024';
              if (typeof genContext.params.size === 'string' && /^\d{2,5}x\d{2,5}$/.test(genContext.params.size)) {
                reqSize = genContext.params.size;
              }

              const apiKey = getKey();
              if (!apiKey) throw new Error('未检测到 API Key，请先点击顶栏钥匙图标输入');

              const chosenModel = genContext.params.model || canvasModel || WineTokenManifestManager.getFreeImageModel() || 'sensenova-u1.5-lite';
              // 参考图优先级: 连到分镜的上游节点 > 角色定妆照 (对齐上游 referenceImages 语义)
              const primaryRef = upstreamRefs.length ? resolveRef(upstreamRefs[0]) : (char && char.avatar ? char.avatar : '');

              // WAL 预写日志: 发包前先落盘任务存根，切 Tab / F5 后仍可水合 (工程铁律: 资产绝不丢)
              const walJob = CanvasJobQueueSingleton ? CanvasJobQueueSingleton.createJob({
                panelId, prompt: fullPrompt, model: chosenModel, size: reqSize,
                characterId: target.characterId || null
              }) : null;

              const refSlots = primaryRef ? [{ dataUrl: primaryRef }] : [];
              const data = await sendImageRequest({
                baseUrl: BASE_URL,
                apiKey,
                model: chosenModel,
                prompt: fullPrompt,
                size: reqSize,
                n: 1,
                referenceSlots: refSlots
              });
              const url = data.data?.[0]?.url || (data.data?.[0]?.b64_json ? `data:image/png;base64,${data.data[0].b64_json}` : '');
              if (!url) throw new Error('接口未返回有效图像');
              if (walJob && CanvasJobQueueSingleton) CanvasJobQueueSingleton.completeJob(walJob.id, url);

              // 采用 InvokeAI 风格的幽灵暂存层
              setPanels(prev => prev.map(p => p.id === panelId ? {
                ...p,
                isGenerating: false,
                stagingCandidateUrl: url
              } : p));

              // CANVAS-M2 2.2: 生成图作为独立节点落画布并连线到源分镜
              spawnImageNodeForPanel(target, url);

              updateBilling();
            } catch (err) {
              alert(`分镜 #${target.num} 生成失败: ${err.message}`);
              setPanels(prev => prev.map(p => p.id === panelId ? { ...p, isGenerating: false } : p));
            }
          };

          // 对标 infinite-canvas: 节点即生成器。image 节点自带 prompt/params，
          // 上游连线的文本/图片节点自动成为生成上下文，结果落本地资产后写回 assetKey。
          const handleGenerateItem = async (itemId) => {
            const item = canvasItems.find(x => x.id === itemId && x.type === 'image');
            if (!item || item.data?.generating) return;
            const projectSnapshot = { characters, panels, canvasItems, edges, groups };
            const ctx = CanvasNodeUtils && CanvasNodeUtils.buildGenerationContext
              ? CanvasNodeUtils.buildGenerationContext(projectSnapshot, itemId)
              : { prompt: '', referenceImages: [], params: {}, warnings: [] };
            const prompt = (item.data?.prompt || ctx.prompt || '电影感画面，精致光影').trim().slice(0, 4000);
            const refs = ctx.referenceImages.filter(r => typeof r === 'string' && r.trim());
            const resolveRef = (ref) => {
              if (ref.startsWith('asset:') && canvasAssetsDriver && canvasAssetsDriver.exists(ref.slice(6))) {
                try { return canvasAssetsDriver.readAsDataUrl(ref.slice(6)); } catch (_) { return null; }
              }
              return ref.startsWith('asset:') ? null : ref;
            };
            const primaryRef = refs.length ? resolveRef(refs[0]) : '';

            setCanvasItems(prev => prev.map(x => x.id === itemId ? { ...x, data: { ...x.data, generating: true, error: '' } } : x));
            let walJob = null;
            try {
              const apiKey = getKey();
              if (!apiKey) throw new Error('未检测到 API Key，请先点击顶栏钥匙图标输入');
              const chosenModel = (item.data?.params?.model) || ctx.params.model || canvasModel || WineTokenManifestManager.getFreeImageModel() || 'sensenova-u1.5-lite';
              
              // 比例与尺寸计算
              const ratio = item.data?.params?.aspectRatio || '16:9';
              const ratioSizeMap = {
                '1:1': '1024x1024',
                '16:9': '1792x1024',
                '9:16': '1024x1792',
                '4:3': '1344x768',
                '3:4': '768x1344'
              };
              let size = item.data?.params?.size || ctx.params.size;
              if (!size || !/^\d{2,5}x\d{2,5}$/.test(size)) {
                size = ratioSizeMap[ratio] || '1792x1024';
              }
              const count = Math.max(1, Math.min(4, Number(item.data?.params?.count) || 1));

              // WAL 任务队列记录
              walJob = CanvasJobQueueSingleton ? CanvasJobQueueSingleton.createJob({
                panelId: itemId, prompt, model: chosenModel, size
              }) : null;

              const refSlots = primaryRef ? [{ dataUrl: primaryRef }] : [];
              const data = await sendImageRequest({
                baseUrl: BASE_URL,
                apiKey,
                model: chosenModel,
                prompt,
                size,
                n: count,
                referenceSlots: refSlots
              });
              const url = data.data?.[0]?.url || (data.data?.[0]?.b64_json ? `data:image/png;base64,${data.data[0].b64_json}` : '');
              if (!url) throw new Error('接口未返回有效图像');
              if (walJob && CanvasJobQueueSingleton) CanvasJobQueueSingleton.completeJob(walJob.id, url);

              // 优先把结果落本地资产 (节点只持 assetKey)，失败真实透传，绝不静默吞错
              let finalUrl = url;
              let assetKey = '';
              if (url.startsWith('data:') && canvasAssetsDriver) {
                const saved = canvasAssetsDriver.saveDataUrl(url);
                assetKey = saved.assetKey;
                finalUrl = `asset:${assetKey}`;
              }
              if (canvasHistoryManager) canvasHistoryManager.pushState(snapshotState());
              setCanvasItems(prev => prev.map(x => x.id === itemId ? {
                ...x,
                data: { ...x.data, url: finalUrl, assetKey, prompt, generating: false, error: '' }
              } : x));
              updateBilling();
            } catch (err) {
              if (walJob && CanvasJobQueueSingleton) CanvasJobQueueSingleton.failJob(walJob.id, err.message);
              setCanvasItems(prev => prev.map(x => x.id === itemId ? {
                ...x, data: { ...x.data, generating: false, error: err.message }
              } : x));
              setProjectError(`节点生成失败: ${err.message}`);
            }
          };

          // 对标 infinite-canvas 视频节点: 提交 + 3 秒长轮询 + 状态机 + 本地资产落盘
          // 协议与 StudioPage 已验证链路完全一致，轮询状态判定由 canvas-video.js 纯函数承担
          const videoPollAbortRef = React.useRef(new Map());

          const updateVideoItem = (itemId, statePatch) => {
            setCanvasItems(prev => prev.map(x => {
              if (x.id !== itemId) return x;
              const base = CanvasVideoUtils ? CanvasVideoUtils.createVideoNodeState() : { status: 'idle' };
              const prevState = (x.data && x.data.videoState) || {};
              const nextState = { ...base, ...prevState, ...statePatch };
              return {
                ...x,
                data: {
                  ...(x.data || {}),
                  url: nextState.videoUrl || x.data?.url || '',
                  assetKey: nextState.assetKey || x.data?.assetKey || '',
                  videoState: nextState
                }
              };
            }));
          };

          const handleCancelVideoItem = (itemId) => {
            const ctrl = videoPollAbortRef.current.get(itemId);
            if (ctrl) { try { ctrl.abort(); } catch (_) {} videoPollAbortRef.current.delete(itemId); }
            updateVideoItem(itemId, { status: 'cancelled', error: '已由用户取消' });
          };

          const handleGenerateVideoItem = async (itemId) => {
            const item = canvasItems.find(x => x.id === itemId && x.type === 'video');
            if (!item || !CanvasVideoUtils) return;
            const state = (item.data && item.data.videoState) || {};
            if (CanvasVideoUtils.isBusy(state)) return;
            const apiKey = getKey();
            if (!apiKey) { setProjectError('未检测到 API Key，请先点击顶栏钥匙图标输入'); return; }

            // 上游图片节点连线作为参考图 (支持多图全能参考与单图首帧)
            const projectSnapshot = { characters, panels, canvasItems, edges, groups };
            const ctx = CanvasNodeUtils && CanvasNodeUtils.buildGenerationContext
              ? CanvasNodeUtils.buildGenerationContext(projectSnapshot, itemId)
              : { prompt: '', referenceImages: [], params: {}, warnings: [] };
            const resolveRef = (ref) => {
              if (ref.startsWith('asset:') && canvasAssetsDriver && canvasAssetsDriver.exists(ref.slice(6))) {
                try { return canvasAssetsDriver.readAsDataUrl(ref.slice(6)); } catch (_) { return ''; }
              }
              return ref.startsWith('asset:') ? '' : ref;
            };
            const refs = ctx.referenceImages.filter(r => typeof r === 'string' && r.trim());
            const firstFrame = refs.length ? resolveRef(refs[0]) : '';
            const prompt = (item.data?.prompt || ctx.prompt || '电影感运镜，光线流动').trim().slice(0, 4000);
            const chosenModel = (item.data?.params?.model) || ctx.params.model || (availableVideoModels[0]?.id) || 'MiniMax-H3';
            const duration = Number(item.data?.params?.duration) || 5;
            const size = item.data?.params?.size || '1280x720';

            const payload = CanvasVideoUtils.buildVideoPayload({
              model: chosenModel,
              prompt,
              duration,
              size,
              firstFrameUrl: firstFrame
            });
            if (item.data?.params?.generateAudio) {
              payload.audio = true;
            }
            const endpoints = CanvasVideoUtils.resolveVideoEndpoints(BASE_URL, chosenModel);
            const submitUrl = endpoints.submitUrl;
            const controller = new AbortController();
            videoPollAbortRef.current.set(itemId, controller);

            if (canvasHistoryManager) canvasHistoryManager.pushState(snapshotState());
            updateVideoItem(itemId, { status: 'submitting', error: '', startedAt: Date.now() });
            try {
              const submitRes = await fetch(submitUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                body: JSON.stringify(payload),
                signal: controller.signal
              });
              if (!submitRes.ok) {
                const errText = await submitRes.text().catch(() => '');
                let msg = `HTTP ${submitRes.status}`;
                try { const p = JSON.parse(errText); msg = p.error?.message || msg; } catch (_) { if (errText) msg = errText.slice(0, 100); }
                throw new Error(`创建视频任务失败: ${msg}`);
              }
              const submitData = await submitRes.json();
              const parsed = CanvasVideoUtils.parseSubmitResponse(submitData);
              if (parsed.error) throw new Error(parsed.error);
              let videoUrl = parsed.directUrl;

              if (!videoUrl && parsed.taskId) {
                updateVideoItem(itemId, { status: 'polling', taskId: parsed.taskId });
                const pollUrl = endpoints.pollUrl(parsed.taskId);
                for (let attempt = 1; attempt <= CanvasVideoUtils.DEFAULT_MAX_ATTEMPTS; attempt++) {
                  if (controller.signal.aborted) throw new Error('已由用户取消');
                  await new Promise(r => setTimeout(r, CanvasVideoUtils.DEFAULT_POLL_INTERVAL_MS));
                  if (controller.signal.aborted) throw new Error('已由用户取消');
                  let pollData = {};
                  try {
                    const pollRes = await fetch(pollUrl, {
                      headers: { 'Authorization': `Bearer ${apiKey}` }, signal: controller.signal
                    });
                    if (pollRes.ok) pollData = await pollRes.json();
                  } catch (pollErr) {
                    if (controller.signal.aborted) throw new Error('已由用户取消');
                    pollData = {}; // 单次轮询网络异常不误判失败，继续等待
                  }
                  const reduced = CanvasVideoUtils.reducePollResponse(pollData, attempt, CanvasVideoUtils.DEFAULT_MAX_ATTEMPTS, endpoints.contentUrl(parsed.taskId));
                  updateVideoItem(itemId, {
                    status: reduced.status, attempt, error: reduced.error, videoUrl: reduced.videoUrl
                  });
                  if (reduced.error && reduced.done && reduced.status === 'failed') throw new Error(reduced.error);
                  if (reduced.done && reduced.status === 'timeout') throw new Error(reduced.error);
                  if (reduced.done && reduced.videoUrl) { videoUrl = reduced.videoUrl; break; }
                }
              }
              if (!videoUrl) throw new Error('视频生成已提交但未取得结果，稍后可在创作工坊历史中核对');

              // 远程视频落地为本地资产 (节点只持 assetKey)，失败真实透传不静默吞
              let finalUrl = videoUrl;
              let assetKey = '';
              if (canvasAssetsDriver) {
                try {
                  const isContentEndpoint = Boolean(parsed.taskId) && videoUrl === endpoints.contentUrl(parsed.taskId);
                  const binRes = await fetch(videoUrl, {
                    ...(isContentEndpoint ? { headers: { 'Authorization': `Bearer ${apiKey}` } } : {}),
                    signal: controller.signal
                  });
                  if (binRes.ok) {
                    const buf = Buffer.from(await binRes.arrayBuffer());
                    if (buf.length > 0) {
                      const saved = canvasAssetsDriver.saveBuffer(buf, 'video/mp4');
                      assetKey = saved.assetKey;
                      finalUrl = `asset:${assetKey}`;
                    }
                  }
                } catch (assetErr) {
                  // 资产落盘失败不丢弃已付费的视频结果: 保留远程 URL 并如实告警
                  console.warn('[WineToken Canvas] 视频资产落盘失败，保留远程 URL:', assetErr.message);
                  setProjectError(`视频已生成但本地落盘失败: ${assetErr.message} (仍可用远程链接播放)`);
                }
              }
              updateVideoItem(itemId, {
                status: 'succeeded', error: '', videoUrl: finalUrl, assetKey
              });
              updateBilling();
            } catch (err) {
              const cancelled = controller.signal.aborted;
              updateVideoItem(itemId, {
                status: cancelled ? 'cancelled' : 'failed', error: err.message
              });
              if (!cancelled) setProjectError(`视频节点生成失败: ${err.message}`);
            } finally {
              videoPollAbortRef.current.delete(itemId);
            }
          };

          // 幽灵暂存动作
          const handleAcceptStaging = (panelId) => {
            setPanels(prev => prev.map(p => {
              if (p.id === panelId && p.stagingCandidateUrl) {
                return { ...p, imageUrl: p.stagingCandidateUrl, stagingCandidateUrl: null };
              }
              return p;
            }));
          };

          const handleDiscardStaging = (panelId) => {
            setPanels(prev => prev.map(p => {
              if (p.id === panelId) {
                return { ...p, stagingCandidateUrl: null };
              }
              return p;
            }));
          };

          // 一键导出高清条漫长图 (零依赖 HTML5 Canvas 像素拼接)
          const handleExportStrip = async () => {
            const readyPanels = panels.filter(p => !!p.imageUrl);
            if (readyPanels.length === 0) {
              alert('画布中尚无已生成的画面，请先完成至少一个分镜的绘制后再导出。');
              return;
            }

            const standardW = 1080;
            const gutter = 32;
            let totalH = gutter;

            // 计算总高
            const panelMetrics = readyPanels.map(p => {
              const h = Math.round((standardW * p.height) / p.width);
              totalH += h + gutter;
              return { ...p, renderH: h };
            });

            const canvas = document.createElement('canvas');
            canvas.width = standardW;
            canvas.height = totalH;
            const ctx = canvas.getContext('2d');

            ctx.fillStyle = '#111827';
            ctx.fillRect(0, 0, standardW, totalH);

            let curY = gutter;
            for (const item of panelMetrics) {
              const img = new Image();
              img.crossOrigin = 'anonymous';
              await new Promise((res, rej) => {
                img.onload = res;
                img.onerror = rej;
                img.src = item.imageUrl;
              }).catch(() => {});

              if (img.width > 0) {
                ctx.drawImage(img, 0, curY, standardW, item.renderH);
              }

              // 绘制台词对白气泡 (多行自适应折行断句，彻底杜绝长文本溢出 CANVAS-05)
              if (item.dialogue) {
                ctx.save();
                const bubW = Math.min(standardW - 80, 560);
                const lines = CanvasMathUtils ? CanvasMathUtils.measureAndWrapText(item.dialogue, bubW - 48, 18) : [item.dialogue];
                const lineHeight = 28;
                const bubH = Math.max(54, 24 + lines.length * lineHeight);
                const bubX = (standardW - bubW) / 2;
                const bubY = curY + item.renderH - bubH - 24;

                ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
                ctx.strokeStyle = '#111827';
                ctx.lineWidth = 3;

                ctx.beginPath();
                ctx.roundRect(bubX, bubY, bubW, bubH, 10);
                ctx.fill();
                ctx.stroke();

                ctx.fillStyle = '#111827';
                ctx.font = 'bold 18px "PingFang SC", "Microsoft YaHei", sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                const startTextY = bubY + bubH / 2 - ((lines.length - 1) * lineHeight) / 2;
                lines.forEach((lineText, lIdx) => {
                  ctx.fillText(lineText, standardW / 2, startTextY + lIdx * lineHeight);
                });
                ctx.restore();
              }

              curY += item.renderH + gutter;
            }

            const dataUrl = canvas.toDataURL('image/png');
            try {
              const defaultName = `winetoken-comic-strip-${Date.now()}.png`;
              const targetPath = await WineTokenFileUtil.promptSaveLocation({
                title: '导出漫剧条漫长图',
                defaultName,
                type: 'image',
                ext: '.png'
              });

              if (!targetPath) return; // 用户点击取消，静默退出

              const fullPath = await WineTokenFileUtil.writeMediaToFile(dataUrl, targetPath);
              WineTokenFileUtil.revealFile(fullPath);
            } catch (err) {
              alert('导出漫剧长图失败: ' + err.message);
            }
          };

          // CANVAS-M3 3.4: 视口虚拟化裁剪盒 (世界坐标, 含 200px 边缘缓冲; 滚轮缩放与平移结束均触发重算)
          const zoomNow = viewportRef.current.zoom || 1;
          const viewWorldBox = {
            x: -viewportRef.current.x / zoomNow - 200,
            y: -viewportRef.current.y / zoomNow - 200,
            width: ((typeof window !== 'undefined' ? window.innerWidth : 1920) / zoomNow) + 400,
            height: ((typeof window !== 'undefined' ? window.innerHeight : 1080) / zoomNow) + 400
          };

          return h('div', {
            id: 'winetoken-canvas-viewport',
            ref: viewportContainerRef,
            style: {
              width: '100%',
              height: '100%',
              overflow: 'hidden',
              position: 'relative',
              backgroundColor: theme.isDark ? '#0b0f17' : '#f8fafc',
              backgroundImage: theme.isDark
                ? 'radial-gradient(rgba(255, 255, 255, 0.08) 1px, transparent 1px)'
                : 'radial-gradient(rgba(0, 0, 0, 0.08) 1px, transparent 1px)',
              backgroundSize: '24px 24px',
              userSelect: 'none',
              cursor: activeTool === 'grab' ? 'grab' : 'default'
            },
            onPointerDown: handlePointerDown,
            onPointerMove: handlePointerMove,
            onPointerUp: handlePointerUp,
            onContextMenu: handleCanvasContextMenu,
            // 捕获阶段先于画布交互判定：点击/右按菜单外任意处自动收起新建节点菜单
            onPointerDownCapture: (e) => {
              if (nodeMenu && nodeMenuRef.current && !nodeMenuRef.current.contains(e.target)) {
                setNodeMenu(null);
              }
            }
          }, [
            // 0. 框选橡皮筋覆盖层 (屏幕坐标, CANVAS-M1 1.4)
            marqueeRect ? h('div', {
              style: {
                position: 'absolute',
                left: `${Math.min(marqueeRect.x0, marqueeRect.x1)}px`,
                top: `${Math.min(marqueeRect.y0, marqueeRect.y1)}px`,
                width: `${Math.abs(marqueeRect.x1 - marqueeRect.x0)}px`,
                height: `${Math.abs(marqueeRect.y1 - marqueeRect.y0)}px`,
                border: '1px solid #06b6d4',
                backgroundColor: 'rgba(6, 182, 212, 0.12)',
                pointerEvents: 'none',
                zIndex: 200
              }
            }) : null,
            h(CanvasShortcutsPanel, { isOpen: showShortcuts, onClose: () => setShowShortcuts(false) }),
            // 0.5 Ctrl+L 连线模式提示条 (CANVAS-M2 2.4)
            connectMode ? h('div', {
              style: {
                position: 'absolute',
                top: '16px',
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 300,
                padding: '6px 14px',
                borderRadius: '8px',
                backgroundColor: theme.popoverBg,
                border: `1px solid ${theme.borderSubtle}`,
                color: theme.textPrimary,
                fontSize: '12px',
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.3)',
                pointerEvents: 'none'
              }
            }, connectMode.from ? '已选源节点，点击目标节点完成连线 (Esc 取消)' : '连线模式：点击源节点 (Esc 取消)') : null,
            // 0.6 新建节点菜单 (Tab / 右键空白, CANVAS-M2 2.5)
            nodeMenu ? h('div', {
              ref: nodeMenuRef,
              onPointerDown: (e) => e.stopPropagation(),
              onClick: () => setNodeMenu(null),
              style: {
                position: 'absolute',
                left: `${nodeMenu.screenX}px`,
                top: `${nodeMenu.screenY}px`,
                zIndex: 300,
                minWidth: '132px',
                padding: '6px',
                borderRadius: '10px',
                backgroundColor: theme.popoverBg,
                border: `1px solid ${theme.borderSubtle}`,
                boxShadow: '0 12px 30px rgba(0, 0, 0, 0.35)',
                display: 'flex',
                flexDirection: 'column',
                gap: '2px'
              }
            }, [
              h('div', { style: { fontSize: '10.5px', color: theme.textMuted, padding: '4px 8px 6px' } }, '新建节点'),
              [
                { type: 'panel', label: '分镜卡' },
                { type: 'character', label: '角色卡' },
                { type: 'image', label: '图片节点' },
                { type: 'text', label: '文本便签' },
                { type: 'video', label: '视频节点' }
              ].map(opt => h('button', {
                key: opt.type,
                type: 'button',
                onClick: (e) => {
                  e.stopPropagation();
                  createNodeFromMenu(opt.type);
                },
                style: {
                  background: 'none',
                  border: 'none',
                  color: theme.textPrimary,
                  fontSize: '12px',
                  textAlign: 'left',
                  padding: '6px 8px',
                  borderRadius: '6px',
                  cursor: 'pointer'
                },
                onMouseEnter: (e) => { e.currentTarget.style.backgroundColor = theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)'; },
                onMouseLeave: (e) => { e.currentTarget.style.backgroundColor = 'transparent'; }
              }, opt.label))
            ]) : null,
            // 0.7 节点搜索面板 (Ctrl+F, CANVAS-M3 3.3)
            searchOpen ? h('div', {
              onPointerDown: (e) => e.stopPropagation(),
              style: {
                position: 'absolute',
                top: '56px',
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 320,
                width: '440px',
                maxWidth: '80%',
                borderRadius: '12px',
                backgroundColor: theme.popoverBg,
                border: `1px solid ${theme.borderSubtle}`,
                boxShadow: '0 16px 40px rgba(0, 0, 0, 0.35)',
                overflow: 'hidden'
              }
            }, [
              h('input', {
                autoFocus: true,
                value: searchQuery,
                onChange: (e) => setSearchQuery(e.target.value),
                onKeyDown: (e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter' && searchResults.length) {
                    applySearchResult(searchResults[0]);
                  }
                },
                placeholder: '搜索分镜 / 提示词 / 台词 / 角色名 / 组名…',
                style: {
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '10px 14px',
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: theme.textPrimary,
                  fontSize: '13px'
                }
              }),
              searchResults.length ? h('div', {
                style: { maxHeight: '280px', overflowY: 'auto', borderTop: `1px solid ${theme.borderSubtle}` }
              }, searchResults.map((r, i) => h('div', {
                key: `${r.kind}_${r.id}`,
                onClick: () => applySearchResult(r),
                style: {
                  padding: '8px 14px',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '2px',
                  backgroundColor: i === 0 ? (theme.isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)') : 'transparent'
                },
                onMouseEnter: (e) => { e.currentTarget.style.backgroundColor = theme.isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)'; },
                onMouseLeave: (e) => { e.currentTarget.style.backgroundColor = i === 0 ? (theme.isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)') : 'transparent'; }
              }, [
                h('div', { style: { fontSize: '12px', color: theme.textPrimary } }, r.label),
                r.snippet ? h('div', { style: { fontSize: '11px', color: theme.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, r.snippet) : null
              ]))) : (searchQuery.trim() ? h('div', { style: { padding: '10px 14px', fontSize: '11.5px', color: theme.textMuted, borderTop: `1px solid ${theme.borderSubtle}` } }, '没有匹配的节点') : null)
            ]) : null,
            // 0.8 AI 剧本拆镜对话框 (CANVAS-M4 客户端部分)
            aiSplitOpen ? h('div', {
              onClick: () => { if (!aiSplitBusy) setAiSplitOpen(false); },
              style: {
                position: 'fixed',
                left: 0,
                top: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'rgba(0, 0, 0, 0.55)',
                zIndex: 9100,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '24px'
              }
            }, [
              h('div', {
                onClick: (e) => e.stopPropagation(),
                onPointerDown: (e) => e.stopPropagation(),
                onDoubleClick: (e) => e.stopPropagation(),
                style: {
                  width: '560px',
                  maxWidth: '92%',
                  backgroundColor: theme.bgCard,
                  border: `1px solid ${theme.borderSubtle}`,
                  borderRadius: '14px',
                  boxShadow: '0 24px 60px rgba(0, 0, 0, 0.45)',
                  padding: '20px 22px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px'
                }
              }, [
                h('div', { style: { fontSize: '15px', fontWeight: 700, color: theme.textPrimary } }, 'AI 剧本拆镜 · 自动铺图'),
                h('div', { style: { fontSize: '11.5px', color: theme.textSecondary, lineHeight: 1.6 } }, '粘贴剧本文本，AI 自动拆解为分镜卡阵列铺上画布。调用一次对话模型（消耗少量额度）；出图仍需逐镜手动触发或选中后 Ctrl+Enter。'),
                h('textarea', {
                  value: aiSplitText,
                  onChange: (e) => setAiSplitText(e.target.value),
                  placeholder: '在此粘贴剧本 / 故事梗概…',
                  rows: 10,
                  style: {
                    resize: 'vertical',
                    border: `1px solid ${theme.borderSubtle}`,
                    borderRadius: '8px',
                    background: theme.isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
                    color: theme.textPrimary,
                    fontSize: '12.5px',
                    padding: '10px 12px',
                    outline: 'none',
                    fontFamily: 'inherit',
                    lineHeight: 1.6
                  }
                }),
                h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' } }, [
                  h('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: theme.textSecondary, whiteSpace: 'nowrap' } }, [
                    '目标分镜数 (2~12)',
                    h('input', {
                      type: 'number',
                      min: 2,
                      max: 12,
                      value: aiSplitCount,
                      onChange: (e) => setAiSplitCount(Number(e.target.value)),
                      style: {
                        width: '60px',
                        padding: '4px 8px',
                        border: `1px solid ${theme.borderSubtle}`,
                        borderRadius: '6px',
                        background: 'transparent',
                        color: theme.textPrimary,
                        outline: 'none'
                      }
                    })
                  ]),
                  h('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: theme.textSecondary, whiteSpace: 'nowrap', flex: 1, minWidth: '220px' } }, [
                    '拆解模型',
                    h('select', {
                      value: (() => {
                        const usable = (availableChatModels || []).filter(m => m && m.id && m.enabled !== false);
                        if (usable.some(m => m.id === aiSplitModel)) return aiSplitModel;
                        return (usable[0] || {}).id || '';
                      })(),
                      onChange: (e) => {
                        setAiSplitModel(e.target.value);
                        try {
                          if (typeof localStorage !== 'undefined') {
                            localStorage.setItem('__winetoken_ai_split_model__', e.target.value);
                          }
                        } catch (_) {}
                      },
                      title: '选择用于剧本拆解的对话模型',
                      style: {
                        flex: 1,
                        minWidth: '120px',
                        padding: '5px 8px',
                        border: `1px solid ${theme.borderSubtle}`,
                        borderRadius: '6px',
                        background: theme.bgInput || 'transparent',
                        color: theme.textPrimary,
                        fontSize: '12px',
                        outline: 'none',
                        cursor: 'pointer'
                      }
                    }, (() => {
                      const usable = (availableChatModels || []).filter(m => m && m.id && m.enabled !== false);
                      if (!usable.length) {
                        return [h('option', { key: '__fallback__', value: '' }, '默认对话模型 (Manifest 未加载)')];
                      }
                      return usable.map(m => h('option', {
                        key: m.id,
                        value: m.id,
                        style: { background: theme.bgSidebar, color: theme.textPrimary }
                      }, m.name || m.id));
                    })())
                  ]),
                  h('button', {
                    type: 'button',
                    onClick: runAiSplit,
                    disabled: aiSplitBusy,
                    style: {
                      padding: '8px 18px',
                      borderRadius: '8px',
                      border: 'none',
                      backgroundColor: aiSplitBusy ? theme.borderSubtle : '#06b6d4',
                      color: '#ffffff',
                      fontSize: '12.5px',
                      fontWeight: 600,
                      cursor: aiSplitBusy ? 'not-allowed' : 'pointer',
                      flexShrink: 0
                    }
                  }, aiSplitBusy ? 'AI 拆解中…' : '开始拆镜铺图')
                ])
              ])
            ]) : null,
            // 1. 顶部悬浮工具栏 (黑白极简纯文字与矢量图标)
            h('div', {
              style: {
                position: 'absolute',
                top: '16px',
                left: '20px',
                zIndex: 100,
                display: 'flex',
                alignItems: 'center',
                flexWrap: 'nowrap',
                flexShrink: 0,
                gap: '8px',
                padding: '6px 12px',
                borderRadius: '8px',
                backgroundColor: theme.popoverBg,
                border: `1px solid ${theme.popoverBorder}`,
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.25)',
                maxWidth: 'calc(100% - 40px)',
                overflowX: 'auto',
                overflowY: 'hidden',
                scrollbarWidth: 'none'
              }
            }, [
              h('button', {
                type: 'button',
                onClick: handleAddCharacter,
                style: {
                  padding: '5px 10px',
                  borderRadius: '5px',
                  border: `1px solid ${theme.borderSubtle}`,
                  backgroundColor: 'transparent',
                  color: theme.textPrimary,
                  fontSize: '12px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  flexShrink: 0,
                  whiteSpace: 'nowrap'
                }
              }, [h(Icon, { name: 'user', size: 13 }), h('span', {}, '添加角色')]),

              h('button', {
                type: 'button',
                onClick: () => handleAddPanel('2:3', 'CU', '特写'),
                style: {
                  padding: '5px 10px',
                  borderRadius: '5px',
                  border: `1px solid ${theme.borderSubtle}`,
                  backgroundColor: 'transparent',
                  color: theme.textPrimary,
                  fontSize: '12px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  flexShrink: 0,
                  whiteSpace: 'nowrap'
                }
              }, [h(Icon, { name: 'plus', size: 13 }), h('span', {}, '添加分镜')]),

              h('button', {
                type: 'button',
                onClick: handleUndo,
                title: '撤销上一步操作 (Ctrl+Z)',
                style: {
                  padding: '5px 8px',
                  borderRadius: '5px',
                  border: `1px solid ${theme.borderSubtle}`,
                  backgroundColor: 'transparent',
                  color: theme.textSecondary,
                  fontSize: '12px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  flexShrink: 0,
                  whiteSpace: 'nowrap'
                }
              }, [h(Icon, { name: 'arrowLeft', size: 12 }), h('span', {}, '撤销')]),

              h('button', {
                type: 'button',
                onClick: handleRedo,
                title: '恢复下一步操作 (Ctrl+Y)',
                style: {
                  padding: '5px 8px',
                  borderRadius: '5px',
                  border: `1px solid ${theme.borderSubtle}`,
                  backgroundColor: 'transparent',
                  color: theme.textSecondary,
                  fontSize: '12px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  flexShrink: 0,
                  whiteSpace: 'nowrap'
                }
              }, [h(Icon, { name: 'refresh', size: 12 }), h('span', {}, '重做')]),

              h('div', { style: { width: '1px', height: '16px', backgroundColor: theme.borderSubtle, margin: '0 4px', flexShrink: 0 } }),

              h('button', {
                type: 'button',
                onClick: handleLoad4KomaTemplate,
                style: {
                  padding: '5px 10px',
                  borderRadius: '5px',
                  border: `1px solid ${theme.borderSubtle}`,
                  backgroundColor: 'transparent',
                  color: theme.textSecondary,
                  fontSize: '12px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  flexShrink: 0,
                  whiteSpace: 'nowrap'
                }
              }, [h(Icon, { name: 'canvas', size: 13 }), h('span', {}, '四格模版')]),

              h('div', { style: { width: '1px', height: '16px', backgroundColor: theme.borderSubtle, margin: '0 4px', flexShrink: 0 } }),

              // 对标 infinite-canvas: 多工程选择器 + 新建/重命名/删除/恢复/导入/导出
              canvasProjectStore ? h('select', {
                value: activeProjectId || '',
                onChange: (e) => handleSwitchProject(e.target.value),
                title: '切换画布工程',
                style: {
                  padding: '4px 8px', borderRadius: '5px', maxWidth: '150px',
                  border: `1px solid ${theme.borderSubtle}`, backgroundColor: theme.bgInput,
                  color: theme.textPrimary, fontSize: '11.5px', cursor: 'pointer', flexShrink: 0
                }
              }, projectList.length
                ? projectList.map(p => h('option', { key: p.id, value: p.id, style: { background: theme.bgSidebar, color: theme.textPrimary } }, p.name))
                : [h('option', { key: '_none', value: '' }, '默认工程')]
              ) : null,
              canvasProjectStore ? h('button', {
                type: 'button', onClick: handleCreateProject, title: '新建空白工程',
                style: { padding: '4px 8px', borderRadius: '5px', border: `1px solid ${theme.borderSubtle}`, backgroundColor: 'transparent', color: theme.textSecondary, fontSize: '11.5px', cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' }
              }, '新建') : null,
              canvasProjectStore ? h('button', {
                type: 'button', onClick: handleRenameProject, title: '重命名当前工程',
                style: { padding: '4px 8px', borderRadius: '5px', border: `1px solid ${theme.borderSubtle}`, backgroundColor: 'transparent', color: theme.textSecondary, fontSize: '11.5px', cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' }
              }, '重命名') : null,
              canvasProjectStore ? h('button', {
                type: 'button', onClick: handleDeleteProject, title: '把当前工程移入回收站',
                style: { padding: '4px 8px', borderRadius: '5px', border: `1px solid ${theme.borderSubtle}`, backgroundColor: 'transparent', color: theme.textSecondary, fontSize: '11.5px', cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' }
              }, '回收站') : null,
              canvasProjectStore ? h('button', {
                type: 'button', onClick: handleRestoreProject, title: '从回收站恢复工程',
                style: { padding: '4px 8px', borderRadius: '5px', border: `1px solid ${theme.borderSubtle}`, backgroundColor: 'transparent', color: theme.textSecondary, fontSize: '11.5px', cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' }
              }, '恢复') : null,
              canvasProjectStore ? h('button', {
                type: 'button', onClick: handleExportProject, title: '导出工程为 .wtcanvas.json',
                style: { padding: '4px 8px', borderRadius: '5px', border: `1px solid ${theme.borderSubtle}`, backgroundColor: 'transparent', color: theme.textSecondary, fontSize: '11.5px', cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' }
              }, '导出工程') : null,
              canvasProjectStore ? h('label', {
                title: '导入工程文件 (.wtcanvas.json)',
                style: { padding: '4px 8px', borderRadius: '5px', border: `1px solid ${theme.borderSubtle}`, backgroundColor: 'transparent', color: theme.textSecondary, fontSize: '11.5px', cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' }
              }, [
                '导入工程',
                h('input', { type: 'file', accept: '.json,.wtcanvas.json', onChange: handleImportProject, style: { display: 'none' } })
              ]) : null,

              h('div', { style: { width: '1px', height: '16px', backgroundColor: theme.borderSubtle, margin: '0 4px', flexShrink: 0 } }),

              // 漫剧画布自主生图模型选择器 (同步 Manifest 动态矩阵与实时生效会员价格)
              h('div', {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '3px 10px',
                  borderRadius: '6px',
                  backgroundColor: theme.bgInput,
                  border: `1px solid ${theme.borderSubtle}`,
                  maxWidth: '300px',
                  flexShrink: 0
                }
              }, [
                h(Icon, { name: 'palette', size: 12, style: { opacity: 0.7, flexShrink: 0 } }),
                h('span', { style: { fontSize: '11px', color: theme.textMuted, whiteSpace: 'nowrap', flexShrink: 0 } }, '模型:'),
                h('select', {
                  value: canvasModel,
                  onChange: (e) => setCanvasModel(e.target.value),
                  title: '选择漫剧分镜生成模型与生效费率',
                  style: {
                    background: 'transparent',
                    border: 'none',
                    color: theme.textPrimary,
                    fontSize: '11.5px',
                    fontWeight: 500,
                    outline: 'none',
                    cursor: 'pointer',
                    maxWidth: '230px',
                    textOverflow: 'ellipsis',
                    paddingRight: '6px'
                  }
                }, availableImageModels.map(m => {
                  const isFree = m.price === 0 || (m.tag && m.tag.includes('限免'));
                  let priceText = '';
                  if (isFree) {
                    priceText = '限免 ¥0.00';
                  } else if (isSvip && m.vipPrice != null) {
                    priceText = `${isSuper ? 'SUPER' : 'SVIP'} ¥${formatCNY(m.vipPrice)}/张`;
                  } else if (isVip) {
                    const vipP = m.price != null ? Number((m.price * 0.9).toFixed(2)) : (m.vipPrice != null ? m.vipPrice : null);
                    priceText = vipP != null ? `VIP ¥${formatCNY(vipP)}/张` : (m.vipPriceText || '');
                  } else if (m.price != null) {
                    priceText = `¥${formatCNY(m.price)}/张`;
                  } else {
                    priceText = m.priceText || '';
                  }

                  const tagPart = m.tag ? ` [${m.tag}]` : '';
                  const pricePart = priceText ? ` — ${priceText}` : '';
                  const fullLabel = `${m.name}${tagPart}${pricePart}`;

                  return h('option', {
                    key: m.id,
                    value: m.id,
                    style: { background: theme.bgSidebar, color: theme.textPrimary }
                  }, fullLabel);
                }))
              ]),

              h('button', {
                type: 'button',
                onClick: handleExportStrip,
                style: {
                  padding: '5px 12px',
                  borderRadius: '5px',
                  border: 'none',
                  backgroundColor: theme.btnPrimaryBg,
                  color: theme.btnPrimaryText,
                  fontSize: '12px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  flexShrink: 0,
                  whiteSpace: 'nowrap'
                }
              }, [h(Icon, { name: 'download', size: 13 }), h('span', {}, '导出条漫长图')])
            ]),

            // 2.1 工程状态提示条: 保存/导入/导出/切换失败时向 UI 真实透传 (工程铁律 3)
            projectError ? h('div', {
              style: {
                position: 'absolute', top: '52px', right: '20px', zIndex: 120,
                maxWidth: '420px', padding: '8px 12px', borderRadius: '8px',
                backgroundColor: theme.isDark ? 'rgba(120, 30, 30, 0.92)' : 'rgba(255, 235, 235, 0.96)',
                border: `1px solid ${theme.isDark ? 'rgba(248,113,113,0.5)' : 'rgba(220,38,38,0.35)'}`,
                color: theme.isDark ? '#fecaca' : '#991b1b', fontSize: '11.5px', lineHeight: 1.5
              }
            }, [
              h('span', {}, projectError),
              h('button', {
                type: 'button', onClick: () => setProjectError(''),
                style: { marginLeft: '10px', background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: '13px' }
              }, '×')
            ]) : null,

            // 2.3 提示词库浮层 (对标 infinite-canvas prompt library)
            promptLibOpen ? h('div', {
              onClick: () => setPromptLibOpen(false),
              style: {
                position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                backgroundColor: 'rgba(0,0,0,0.45)', zIndex: 8000,
                display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px'
              }
            }, [
              h('div', {
                onClick: (e) => e.stopPropagation(),
                style: {
                  width: '520px', maxWidth: '100%', maxHeight: '70vh', display: 'flex', flexDirection: 'column',
                  backgroundColor: theme.bgCard, border: `1px solid ${theme.borderSubtle}`,
                  borderRadius: '12px', boxShadow: '0 24px 60px rgba(0,0,0,0.4)', overflow: 'hidden'
                }
              }, [
                h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: `1px solid ${theme.borderSubtle}` } }, [
                  h('div', { style: { fontSize: '14px', fontWeight: 700, color: theme.textPrimary } }, '提示词库'),
                  h('button', { type: 'button', onClick: () => setPromptLibOpen(false), style: { background: 'none', border: 'none', color: theme.textMuted, cursor: 'pointer', fontSize: '18px' } }, '×')
                ]),
                h('div', { style: { display: 'flex', gap: '6px', padding: '10px 18px', flexWrap: 'wrap' } }, [
                  h('input', {
                    type: 'text', value: promptLibQuery,
                    onChange: (e) => setPromptLibQuery(e.target.value),
                    placeholder: '搜索提示词 / 标签…',
                    style: { flex: 1, minWidth: '180px', padding: '6px 10px', borderRadius: '6px', border: `1px solid ${theme.borderSubtle}`, backgroundColor: theme.bgInput, color: theme.textPrimary, fontSize: '12px', outline: 'none' }
                  }),
                  h('button', { type: 'button', onClick: handleCollectPrompt, title: '收藏当前选中节点的提示词', style: { padding: '6px 10px', borderRadius: '6px', border: `1px solid ${theme.borderSubtle}`, backgroundColor: 'transparent', color: '#06b6d4', fontSize: '11.5px', cursor: 'pointer', whiteSpace: 'nowrap' } }, '收藏所选'),
                  h('button', { type: 'button', onClick: handleExportPromptLibrary, style: { padding: '6px 10px', borderRadius: '6px', border: `1px solid ${theme.borderSubtle}`, backgroundColor: 'transparent', color: theme.textSecondary, fontSize: '11.5px', cursor: 'pointer' } }, '导出'),
                  h('label', { style: { padding: '6px 10px', borderRadius: '6px', border: `1px solid ${theme.borderSubtle}`, color: theme.textSecondary, fontSize: '11.5px', cursor: 'pointer' } }, [
                    '导入', h('input', { type: 'file', accept: '.json', onChange: handleImportPromptLibrary, style: { display: 'none' } })
                  ])
                ]),
                h('div', { style: { flex: 1, overflowY: 'auto', padding: '4px 18px 14px' } }, (() => {
                  const list = CanvasPromptUtils ? CanvasPromptUtils.searchPrompts(promptLibrary, promptLibQuery) : [];
                  if (!list.length) return [h('div', { key: 'empty', style: { padding: '24px 0', textAlign: 'center', fontSize: '12px', color: theme.textMuted } }, '暂无提示词，选中节点后点击「收藏所选」')];
                  return list.map(it => h('div', {
                    key: it.id,
                    style: { display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '10px 0', borderBottom: `1px solid ${theme.borderSubtle}` }
                  }, [
                    h('div', { style: { flex: 1, minWidth: 0 } }, [
                      h('div', { style: { fontSize: '12px', color: theme.textPrimary, wordBreak: 'break-all', lineHeight: 1.5 } }, it.text.slice(0, 160) + (it.text.length > 160 ? '…' : '')),
                      h('div', { style: { fontSize: '10px', color: theme.textMuted, marginTop: '4px' } }, it.tags.length ? it.tags.join(' / ') : '未分类')
                    ]),
                    h('button', { type: 'button', onClick: () => handleApplyPrompt(it.text), style: { background: 'none', border: 'none', color: '#06b6d4', cursor: 'pointer', fontSize: '11px', flexShrink: 0 } }, '插入'),
                    h('button', { type: 'button', onClick: () => handleRemovePrompt(it.id), style: { background: 'none', border: 'none', color: theme.textMuted, cursor: 'pointer', fontSize: '12px', flexShrink: 0 } }, '×')
                  ]));
                })())
              ])
            ]) : null,

            // 2.2 小地图 (对标 infinite-canvas canvas-mini-map.tsx): 节点缩略 + 视口矩形 + 拖拽定位
            (showMiniMap && CanvasMiniMapUtils && CanvasNodeUtils) ? h(CanvasMiniMapPanel, {
              theme,
              project: { characters, panels, canvasItems, groups },
              viewport: viewportRef.current,
              tick: minimapTick + viewportTick + zoomDisplay,
              onViewportChange: (vp) => {
                viewportRef.current = { ...vp };
                updateTransform();
                setZoomDisplay(Math.round(vp.zoom * 100));
              },
              onToggle: () => {
                const next = !showMiniMap;
                setShowMiniMap(next);
                try { localStorage.setItem('WINETOKEN_CANVAS_MINIMAP', next ? 'on' : 'off'); } catch (_) {}
              }
            }) : null,

            // 2. 右下角视口浮岛 (平移缩放比 + 帮助入口)
            h('div', {
              id: 'winetoken-canvas-viewport-island',
              style: {
                position: 'absolute',
                bottom: '16px',
                right: isNarrow ? '16px' : '20px',
                zIndex: 100,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '5px 10px',
                borderRadius: '8px',
                backgroundColor: theme.popoverBg,
                border: `1px solid ${theme.popoverBorder}`,
                boxShadow: '0 6px 18px rgba(0,0,0,0.2)'
              }
            }, [
              h('button', {
                type: 'button',
                onClick: () => handleZoomStep(false),
                style: { background: 'none', border: 'none', color: theme.textSecondary, cursor: 'pointer', fontSize: '13px', padding: '2px 6px', whiteSpace: 'nowrap', flexShrink: 0 }
              }, '-'),
              h('span', {
                onClick: handleResetView,
                style: { fontSize: '11px', fontFamily: 'monospace', color: theme.textPrimary, cursor: 'pointer', padding: '0 4px', whiteSpace: 'nowrap', flexShrink: 0 },
                title: '点击重置为 100%'
              }, `${zoomDisplay}%`),
              h('button', {
                type: 'button',
                onClick: () => handleZoomStep(true),
                style: { background: 'none', border: 'none', color: theme.textSecondary, cursor: 'pointer', fontSize: '13px', padding: '2px 6px', whiteSpace: 'nowrap', flexShrink: 0 }
              }, '+'),
              h('button', {
                type: 'button',
                onClick: handleFitToContent,
                style: { background: 'none', border: 'none', color: theme.textSecondary, cursor: 'pointer', fontSize: '11px', padding: '2px 6px', whiteSpace: 'nowrap', flexShrink: 0 },
                title: '适应画布：缩放至刚好容纳全部内容 (Ctrl+0)'
              }, '适应'),
              h('button', {
                type: 'button',
                onClick: () => {
                  const next = !showMiniMap;
                  setShowMiniMap(next);
                  try { localStorage.setItem('WINETOKEN_CANVAS_MINIMAP', next ? 'on' : 'off'); } catch (_) {}
                },
                style: {
                  background: 'none', border: 'none',
                  color: showMiniMap ? '#06b6d4' : theme.textSecondary,
                  cursor: 'pointer', fontSize: '11px', padding: '2px 6px',
                  whiteSpace: 'nowrap', flexShrink: 0
                },
                title: '显示/隐藏小地图'
              }, '小地图'),
              h('button', {
                type: 'button',
                onClick: () => setPromptLibOpen(true),
                style: {
                  background: 'none', border: 'none', color: theme.textSecondary,
                  cursor: 'pointer', fontSize: '11px', padding: '2px 6px',
                  whiteSpace: 'nowrap', flexShrink: 0
                },
                title: '提示词库: 收藏/复用节点提示词'
              }, '提示词'),
              h('div', { style: { width: '1px', height: '14px', backgroundColor: theme.borderSubtle, margin: '0 4px', flexShrink: 0 } }),
              h('button', {
                type: 'button',
                onClick: () => setShowShortcuts(true),
                style: {
                  background: 'none',
                  border: 'none',
                  color: theme.textSecondary,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '11.5px',
                  padding: '2px 6px',
                  whiteSpace: 'nowrap',
                  flexShrink: 0
                },
                title: '查看画布快捷键速查面板'
              }, [h(Icon, { name: 'help', size: 13 }), !isCompact && h('span', {}, '快捷键')].filter(Boolean)),
              h('button', {
                type: 'button',
                onClick: () => setAiSplitOpen(true),
                style: {
                  background: 'none',
                  border: 'none',
                  color: theme.textSecondary,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '11.5px',
                  padding: '2px 6px',
                  whiteSpace: 'nowrap',
                  flexShrink: 0
                },
                title: 'AI 剧本拆镜：粘贴剧本自动生成分镜卡阵列 (调用一次对话模型)'
              }, [h(Icon, { name: 'sparkles', size: 13 }), !isCompact && h('span', {}, 'AI拆镜')].filter(Boolean)),
              h('button', {
                type: 'button',
                onClick: onOpenTutorial,
                style: {
                  background: 'none',
                  border: 'none',
                  color: theme.textSecondary,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '11.5px',
                  padding: '2px 6px',
                  whiteSpace: 'nowrap',
                  flexShrink: 0
                },
                title: '打开漫剧新手引导教程'
              }, [h(Icon, { name: 'help', size: 13 }), !isCompact && h('span', {}, '教程')].filter(Boolean))
            ]),

            // 2.5 漫剧画布底部新建工具栏 (对标 LibTV §2.1 新建节点与资产库/预设库入口)
            h('div', {
              id: 'winetoken-canvas-bottom-toolbar',
              style: {
                position: 'absolute',
                bottom: isNarrow ? '64px' : '16px',
                left: isNarrow ? '50%' : (isCompact ? '16px' : '50%'),
                transform: isNarrow ? 'translateX(-50%)' : (isCompact ? 'none' : 'translateX(-50%)'),
                zIndex: 100,
                display: 'flex',
                alignItems: 'center',
                gap: (isCompact || isNarrow) ? '4px' : '6px',
                padding: isNarrow ? '4px 8px' : (isCompact ? '4px 10px' : '6px 14px'),
                borderRadius: '10px',
                backgroundColor: theme.popoverBg,
                border: `1px solid ${theme.popoverBorder}`,
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.28)',
                userSelect: 'none',
                maxWidth: 'calc(100% - 32px)',
                overflowX: 'auto',
                scrollbarWidth: 'none'
              }
            }, [
              h('button', {
                type: 'button',
                onClick: () => createNodeAtCenter('image'),
                title: '在画布中央新建图片生成节点',
                style: { display: 'flex', alignItems: 'center', gap: '4px', background: 'none', border: `1px solid ${theme.borderSubtle}`, borderRadius: '6px', color: theme.textPrimary, fontSize: '11.5px', padding: isNarrow ? '4px 6px' : '4px 8px', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }
              }, [h(Icon, { name: 'camera', size: 12 }), !isNarrow && h('span', {}, '图片')].filter(Boolean)),
              h('button', {
                type: 'button',
                onClick: () => createNodeAtCenter('video'),
                title: '在画布中央新建视频生成节点',
                style: { display: 'flex', alignItems: 'center', gap: '4px', background: 'none', border: `1px solid ${theme.borderSubtle}`, borderRadius: '6px', color: theme.textPrimary, fontSize: '11.5px', padding: isNarrow ? '4px 6px' : '4px 8px', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }
              }, [h(Icon, { name: 'video', size: 12 }), !isNarrow && h('span', {}, '视频')].filter(Boolean)),
              h('button', {
                type: 'button',
                onClick: () => createNodeAtCenter('text'),
                title: '在画布中央新建文本便签',
                style: { display: 'flex', alignItems: 'center', gap: '4px', background: 'none', border: `1px solid ${theme.borderSubtle}`, borderRadius: '6px', color: theme.textPrimary, fontSize: '11.5px', padding: isNarrow ? '4px 6px' : '4px 8px', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }
              }, [h(Icon, { name: 'messageSquare', size: 12 }), !isNarrow && h('span', {}, '文本')].filter(Boolean)),
              h('button', {
                type: 'button',
                onClick: () => handleAddPanel('2:3', 'CU', '特写'),
                title: '新建漫剧分镜卡',
                style: { display: 'flex', alignItems: 'center', gap: '4px', background: 'none', border: `1px solid ${theme.borderSubtle}`, borderRadius: '6px', color: theme.textPrimary, fontSize: '11.5px', padding: isNarrow ? '4px 6px' : '4px 8px', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }
              }, [h(Icon, { name: 'plus', size: 12 }), !isNarrow && h('span', {}, '分镜')].filter(Boolean)),
              h('button', {
                type: 'button',
                onClick: handleAddCharacter,
                title: '新建角色卡',
                style: { display: 'flex', alignItems: 'center', gap: '4px', background: 'none', border: `1px solid ${theme.borderSubtle}`, borderRadius: '6px', color: theme.textPrimary, fontSize: '11.5px', padding: isNarrow ? '4px 6px' : '4px 8px', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }
              }, [h(Icon, { name: 'user', size: 12 }), !isNarrow && h('span', {}, '角色')].filter(Boolean)),
              h('div', { style: { width: '1px', height: '16px', backgroundColor: theme.borderSubtle, margin: '0 2px', flexShrink: 0 } }),
              h('button', {
                type: 'button',
                onClick: () => setPresetModal({ targetItemId: null }),
                title: '打开 16 项专业预设库 (调度/宫格/视图/质感)',
                style: { display: 'flex', alignItems: 'center', gap: '4px', background: 'none', border: `1px solid ${theme.borderSubtle}`, borderRadius: '6px', color: '#06b6d4', fontSize: '11.5px', padding: isNarrow ? '4px 6px' : '4px 8px', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }
              }, [h(Icon, { name: 'sparkles', size: 12 }), !isNarrow && h('span', {}, '预设库')].filter(Boolean)),
              h('button', {
                type: 'button',
                onClick: () => setAssetLibraryOpen(true),
                title: '打开本地资产库 (角色/场景/道具/已使用次数 S1)',
                style: { display: 'flex', alignItems: 'center', gap: '4px', background: 'none', border: `1px solid ${theme.borderSubtle}`, borderRadius: '6px', color: '#10b981', fontSize: '11.5px', padding: isNarrow ? '4px 6px' : '4px 8px', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }
              }, [h(Icon, { name: 'palette', size: 12 }), !isNarrow && h('span', {}, '资产库')].filter(Boolean)),
              h('div', { style: { width: '1px', height: '16px', backgroundColor: theme.borderSubtle, margin: '0 2px', flexShrink: 0 } }),
              // S3 标签筛选下拉
              h('select', {
                value: tagFilter,
                onChange: (e) => setTagFilter(e.target.value),
                title: '按标签高亮筛选画布节点',
                style: {
                  background: theme.bgInput,
                  border: `1px solid ${theme.borderSubtle}`,
                  borderRadius: '6px',
                  color: theme.textPrimary,
                  fontSize: '11px',
                  padding: '3px 6px',
                  cursor: 'pointer',
                  outline: 'none',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                  maxWidth: isNarrow ? '90px' : '120px'
                }
              }, [
                h('option', { value: '全部' }, isNarrow ? '全部' : '标签: 全部'),
                ...(CanvasPromptUtils?.CANVAS_TAGS || []).map(t => h('option', { key: t.id, value: t.label }, isNarrow ? t.label : `标签: ${t.label}`))
              ])
            ]),

            // S4 快速裁剪弹窗
            cropModal ? h('div', {
              onClick: () => setCropModal(null),
              style: {
                position: 'fixed', left: 0, top: 0, right: 0, bottom: 0,
                backgroundColor: 'rgba(0,0,0,0.65)', zIndex: 9200,
                display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px'
              }
            }, [
              h('div', {
                onClick: (e) => e.stopPropagation(),
                onPointerDown: (e) => e.stopPropagation(),
                style: {
                  width: '520px', maxWidth: '94%', backgroundColor: theme.bgCard,
                  border: `1px solid ${theme.borderSubtle}`, borderRadius: '14px',
                  boxShadow: '0 24px 60px rgba(0,0,0,0.5)', padding: '18px 20px',
                  display: 'flex', flexDirection: 'column', gap: '14px'
                }
              }, [
                h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } }, [
                  h('div', { style: { fontSize: '14px', fontWeight: 700, color: theme.textPrimary } }, '图像画面快速裁剪 (S4)'),
                  h('button', { type: 'button', onClick: () => setCropModal(null), style: { background: 'none', border: 'none', color: theme.textMuted, cursor: 'pointer', fontSize: '14px' } }, '×')
                ]),
                h('div', { style: { fontSize: '11px', color: theme.textSecondary } }, '选择目标比例，系统将自动居中裁切并生成落盘为本地新资产：'),
                h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, [
                  '1:1', '16:9', '9:16', '4:3', '3:4'
                ].map(r => h('button', {
                  key: r,
                  type: 'button',
                  onClick: () => handleCropConfirm(cropModal.itemId, r),
                  style: {
                    padding: '6px 14px', borderRadius: '6px',
                    border: '1px solid #06b6d4', backgroundColor: 'rgba(6,182,212,0.1)',
                    color: theme.textPrimary, fontSize: '12px', cursor: 'pointer'
                  }
                }, `裁剪为 ${r}`))),
                h('div', {
                  style: {
                    height: '240px', backgroundColor: '#000', borderRadius: '8px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden'
                  }
                }, [
                  cropModal.url ? h('img', {
                    src: cropModal.url,
                    style: { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }
                  }) : null
                ])
              ])
            ]) : null,

            // S1/S2 命名分类保存已有资产弹窗
            saveAssetModal ? h('div', {
              onClick: () => setSaveAssetModal(null),
              style: {
                position: 'fixed', left: 0, top: 0, right: 0, bottom: 0,
                backgroundColor: 'rgba(0,0,0,0.65)', zIndex: 9200,
                display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px'
              }
            }, [
              h('div', {
                onClick: (e) => e.stopPropagation(),
                onPointerDown: (e) => e.stopPropagation(),
                style: {
                  width: '460px', maxWidth: '94%', backgroundColor: theme.bgCard,
                  border: `1px solid ${theme.borderSubtle}`, borderRadius: '14px',
                  boxShadow: '0 24px 60px rgba(0,0,0,0.5)', padding: '20px',
                  display: 'flex', flexDirection: 'column', gap: '12px'
                }
              }, [
                h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } }, [
                  h('div', { style: { fontSize: '14px', fontWeight: 700, color: theme.textPrimary } }, '保存已有资产进资产库 (S1/S2)'),
                  h('button', { type: 'button', onClick: () => setSaveAssetModal(null), style: { background: 'none', border: 'none', color: theme.textMuted, cursor: 'pointer', fontSize: '14px' } }, '×')
                ]),
                h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } }, [
                  h('span', { style: { fontSize: '11px', color: theme.textMuted } }, '资产名称:'),
                  h('input', {
                    value: saveAssetModal.name || '',
                    onChange: (e) => setSaveAssetModal(prev => ({ ...prev, name: e.target.value })),
                    placeholder: '如 C_P01_主体成品.png',
                    style: { padding: '7px 10px', fontSize: '12px', borderRadius: '6px', border: `1px solid ${theme.borderSubtle}`, backgroundColor: theme.bgInput, color: theme.textPrimary, outline: 'none' }
                  })
                ]),
                h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } }, [
                  h('span', { style: { fontSize: '11px', color: theme.textMuted } }, '所属分类:'),
                  h('select', {
                    value: saveAssetModal.category || '自定义',
                    onChange: (e) => setSaveAssetModal(prev => ({ ...prev, category: e.target.value })),
                    style: { padding: '7px 10px', fontSize: '12px', borderRadius: '6px', border: `1px solid ${theme.borderSubtle}`, backgroundColor: theme.bgInput, color: theme.textPrimary, outline: 'none' }
                  }, ['角色', '场景', '道具', '自定义'].map(c => h('option', { key: c, value: c }, c)))
                ]),
                h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } }, [
                  h('span', { style: { fontSize: '11px', color: theme.textMuted } }, '描述说明:'),
                  h('input', {
                    value: saveAssetModal.description || '',
                    onChange: (e) => setSaveAssetModal(prev => ({ ...prev, description: e.target.value })),
                    placeholder: '简短描述该资产特征...',
                    style: { padding: '7px 10px', fontSize: '12px', borderRadius: '6px', border: `1px solid ${theme.borderSubtle}`, backgroundColor: theme.bgInput, color: theme.textPrimary, outline: 'none' }
                  })
                ]),
                h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' } }, [
                  h('button', {
                    type: 'button', onClick: () => setSaveAssetModal(null),
                    style: { padding: '7px 14px', borderRadius: '6px', border: `1px solid ${theme.borderSubtle}`, background: 'none', color: theme.textSecondary, cursor: 'pointer', fontSize: '12px' }
                  }, '取消'),
                  h('button', {
                    type: 'button',
                    onClick: () => handleSaveAssetSubmit(saveAssetModal),
                    style: { padding: '7px 18px', borderRadius: '6px', border: 'none', backgroundColor: '#06b6d4', color: '#ffffff', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }
                  }, '确认存入')
                ])
              ])
            ]) : null,

            // 16项专业预设选择弹窗
            presetModal ? h('div', {
              onClick: () => setPresetModal(null),
              style: {
                position: 'fixed', left: 0, top: 0, right: 0, bottom: 0,
                backgroundColor: 'rgba(0,0,0,0.65)', zIndex: 9200,
                display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px'
              }
            }, [
              h('div', {
                onClick: (e) => e.stopPropagation(),
                onPointerDown: (e) => e.stopPropagation(),
                style: {
                  width: '840px', maxWidth: '94%', height: '580px', maxHeight: '88%',
                  backgroundColor: theme.bgCard, border: `1px solid ${theme.borderSubtle}`,
                  borderRadius: '14px', boxShadow: '0 24px 60px rgba(0,0,0,0.5)',
                  padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '14px'
                }
              }, [
                h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } }, [
                  h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [
                    h('div', { style: { fontSize: '15px', fontWeight: 700, color: theme.textPrimary } }, '漫剧专业提示词预设库 (16项)'),
                    presetModal.targetItemId ? h('span', { style: { fontSize: '11px', color: '#06b6d4' } }, '正在套用至当前节点') : null
                  ]),
                  h('button', { type: 'button', onClick: () => setPresetModal(null), style: { background: 'none', border: 'none', color: theme.textMuted, cursor: 'pointer', fontSize: '15px' } }, '×')
                ]),
                h('div', { style: { display: 'flex', gap: '8px', borderBottom: `1px solid ${theme.borderSubtle}`, paddingBottom: '8px' } }, [
                  '全部', '分镜叙事', '空间与机位', '设定图', '质感调节'
                ].map(cat => h('button', {
                  key: cat,
                  type: 'button',
                  onClick: () => setPresetCategory(cat),
                  style: {
                    background: (presetCategory || '全部') === cat ? '#06b6d4' : 'transparent',
                    color: (presetCategory || '全部') === cat ? '#ffffff' : theme.textSecondary,
                    border: 'none', borderRadius: '5px', padding: '4px 10px', fontSize: '11.5px', cursor: 'pointer', fontWeight: 500
                  }
                }, cat))),
                h('div', {
                  style: {
                    flex: 1, overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                    gap: '12px', paddingRight: '4px'
                  }
                }, (CanvasPromptUtils?.LIBTV_PRESETS || []).filter(p => !presetCategory || presetCategory === '全部' || p.category === presetCategory).map(preset => {
                  return h('div', {
                    key: preset.id,
                    style: {
                      border: `1px solid ${theme.borderSubtle}`, borderRadius: '10px',
                      padding: '12px', backgroundColor: theme.isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)',
                      display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '8px'
                    }
                  }, [
                    h('div', {}, [
                      h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' } }, [
                        h('div', { style: { fontSize: '12.5px', fontWeight: 600, color: theme.textPrimary } }, preset.name),
                        h('span', { style: { fontSize: '9.5px', color: '#06b6d4', border: '1px solid rgba(6,182,212,0.3)', padding: '1px 4px', borderRadius: '3px' } }, preset.aspectRatio)
                      ]),
                      h('div', { style: { fontSize: '11px', color: theme.textMuted, marginBottom: '6px' } }, preset.desc),
                      h('div', { style: { fontSize: '10.5px', color: theme.textSecondary, lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' } }, preset.prompt)
                    ]),
                    h('button', {
                      type: 'button',
                      onClick: () => {
                        if (presetModal.targetItemId) {
                          setCanvasItems(prev => prev.map(x => {
                            if (x.id !== presetModal.targetItemId) return x;
                            const applied = CanvasPromptUtils ? CanvasPromptUtils.applyPreset(x.data?.prompt || '', preset.id) : { prompt: preset.prompt, aspectRatio: preset.aspectRatio };
                            return {
                              ...x,
                              data: {
                                ...x.data,
                                prompt: applied.prompt,
                                params: {
                                  ...(x.data?.params || {}),
                                  aspectRatio: applied.aspectRatio || x.data?.params?.aspectRatio || '16:9'
                                }
                              }
                            };
                          }));
                        } else {
                          createNodeAtCenter('image', {
                            prompt: preset.prompt,
                            name: `预设_${preset.name}`,
                            aspectRatio: preset.aspectRatio || '16:9'
                          });
                        }
                        setPresetModal(null);
                      },
                      style: {
                        padding: '6px', borderRadius: '6px', border: 'none',
                        backgroundColor: '#06b6d4', color: '#ffffff', fontSize: '11px',
                        fontWeight: 600, cursor: 'pointer', textAlign: 'center'
                      }
                    }, presetModal.targetItemId ? '套用到此节点' : '新建此预设节点')
                  ]);
                }))
              ])
            ]) : null,

            // S1 独立资产库视图
            assetLibraryOpen ? h('div', {
              onClick: () => setAssetLibraryOpen(false),
              style: {
                position: 'fixed', left: 0, top: 0, right: 0, bottom: 0,
                backgroundColor: 'rgba(0,0,0,0.65)', zIndex: 9200,
                display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px'
              }
            }, [
              h('div', {
                onClick: (e) => e.stopPropagation(),
                onPointerDown: (e) => e.stopPropagation(),
                style: {
                  width: '880px', maxWidth: '95%', height: '620px', maxHeight: '90%',
                  backgroundColor: theme.bgCard, border: `1px solid ${theme.borderSubtle}`,
                  borderRadius: '14px', boxShadow: '0 24px 60px rgba(0,0,0,0.5)',
                  padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '14px'
                }
              }, [
                h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } }, [
                  h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [
                    h('div', { style: { fontSize: '15px', fontWeight: 700, color: theme.textPrimary } }, '素材资产库 (S1)'),
                    h('span', { style: { fontSize: '11px', color: theme.textMuted } }, '沉淀可复用的角色、场景、道具与风格素材')
                  ]),
                  h('button', { type: 'button', onClick: () => setAssetLibraryOpen(false), style: { background: 'none', border: 'none', color: theme.textMuted, cursor: 'pointer', fontSize: '15px' } }, '×')
                ]),
                // 工具行: 分类页签 + 搜索 + 排序 + 导入本地资产
                h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' } }, [
                  h('div', { style: { display: 'flex', gap: '6px' } }, [
                    '全部', '角色', '场景', '道具', '自定义'
                  ].map(cat => h('button', {
                    key: cat,
                    type: 'button',
                    onClick: () => setAssetLibCategory(cat),
                    style: {
                      background: assetLibCategory === cat ? '#10b981' : 'transparent',
                      color: assetLibCategory === cat ? '#ffffff' : theme.textSecondary,
                      border: 'none', borderRadius: '5px', padding: '4px 10px', fontSize: '11.5px', cursor: 'pointer', fontWeight: 500
                    }
                  }, cat))),
                  h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [
                    h('input', {
                      value: assetLibQuery,
                      onChange: (e) => setAssetLibQuery(e.target.value),
                      placeholder: '按名称 / 描述 / 标签搜索...',
                      style: {
                        padding: '4px 8px', fontSize: '11.5px', borderRadius: '5px',
                        border: `1px solid ${theme.borderSubtle}`, backgroundColor: theme.bgInput,
                        color: theme.textPrimary, outline: 'none', width: '160px'
                      }
                    }),
                    h('select', {
                      value: assetLibSort,
                      onChange: (e) => setAssetLibSort(e.target.value),
                      style: {
                        padding: '4px 8px', fontSize: '11.5px', borderRadius: '5px',
                        border: `1px solid ${theme.borderSubtle}`, backgroundColor: theme.bgInput,
                        color: theme.textPrimary, outline: 'none', cursor: 'pointer'
                      }
                    }, [
                      h('option', { value: 'updatedAt' }, '按最近更新'),
                      h('option', { value: 'usageCount' }, '按使用次数')
                    ]),
                    h('label', {
                      title: '从本地导入单张图片或资产包',
                      style: {
                        padding: '4px 10px', borderRadius: '5px', border: `1px solid ${theme.borderSubtle}`,
                        backgroundColor: 'transparent', color: theme.textPrimary, fontSize: '11.5px',
                        cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px'
                      }
                    }, [
                      h(Icon, { name: 'upload', size: 12 }),
                      h('span', {}, '导入资产'),
                      h('input', { type: 'file', accept: 'image/*', onChange: handleImportAssetFile, style: { display: 'none' } })
                    ])
                  ])
                ]),
                // 资产卡片网格
                (() => {
                  const items = assetLibraryStore ? assetLibraryStore.searchItems({ query: assetLibQuery, category: assetLibCategory, sortBy: assetLibSort }) : [];
                  if (!items.length) {
                    return h('div', {
                      style: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.textMuted, fontSize: '12px', flexDirection: 'column', gap: '8px' }
                    }, [
                      h('div', {}, '暂无该分类资产'),
                      h('div', { style: { fontSize: '11px', opacity: 0.7 } }, '可在画布图片节点点击「存为资产」，或通过右上角「导入资产」添入')
                    ]);
                  }
                  return h('div', {
                    style: {
                      flex: 1, overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                      gap: '12px', paddingRight: '4px'
                    }
                  }, items.map(asset => {
                    let displaySrc = '';
                    if (canvasAssetsDriver && asset.assetKey) {
                      try { displaySrc = canvasAssetsDriver.readAsDataUrl(asset.assetKey); } catch (_) {}
                    }
                    return h('div', {
                      key: asset.id,
                      style: {
                        border: `1px solid ${theme.borderSubtle}`, borderRadius: '10px',
                        backgroundColor: theme.isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)',
                        overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'space-between'
                      }
                    }, [
                      h('div', {
                        style: { height: '130px', backgroundColor: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', position: 'relative' }
                      }, [
                        displaySrc ? h('img', { src: displaySrc, style: { width: '100%', height: '100%', objectFit: 'cover' } }) : null,
                        h('span', {
                          style: {
                            position: 'absolute', top: '6px', right: '6px',
                            backgroundColor: 'rgba(0,0,0,0.65)', color: '#ffffff',
                            fontSize: '9.5px', padding: '1px 5px', borderRadius: '4px'
                          }
                        }, asset.category),
                        h('span', {
                          style: {
                            position: 'absolute', bottom: '6px', left: '6px',
                            backgroundColor: 'rgba(0,0,0,0.65)', color: '#10b981',
                            fontSize: '9.5px', padding: '1px 5px', borderRadius: '4px'
                          }
                        }, `已使用 ${asset.usageCount || 0} 次`)
                      ]),
                      h('div', { style: { padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: '4px' } }, [
                        h('div', { style: { fontSize: '12px', fontWeight: 600, color: theme.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, asset.name),
                        asset.description ? h('div', { style: { fontSize: '10.5px', color: theme.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, asset.description) : null
                      ]),
                      h('div', {
                        style: {
                          padding: '6px 10px', borderTop: `1px solid ${theme.borderSubtle}`,
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between'
                        }
                      }, [
                        h('button', {
                          type: 'button',
                          onClick: () => handleUseAssetOnCanvas(asset),
                          title: '调入画布中央并递增使用计数',
                          style: { background: 'none', border: 'none', color: '#06b6d4', fontSize: '11px', cursor: 'pointer', fontWeight: 600, padding: 0 }
                        }, '调入画布'),
                        h('div', { style: { display: 'flex', gap: '6px' } }, [
                          h('button', {
                            type: 'button',
                            onClick: () => {
                              if (displaySrc) {
                                const a = document.createElement('a');
                                a.href = displaySrc;
                                a.download = asset.name || asset.assetKey;
                                a.click();
                              }
                            },
                            title: '下载资产文件',
                            style: { background: 'none', border: 'none', color: theme.textSecondary, fontSize: '11px', cursor: 'pointer', padding: 0 }
                          }, '下载'),
                          h('button', {
                            type: 'button',
                            onClick: () => handleDeleteAssetFromLibrary(asset.id),
                            title: '从资产库删除',
                            style: { background: 'none', border: 'none', color: theme.textMuted, fontSize: '12px', cursor: 'pointer', padding: 0 }
                          }, '×')
                        ])
                      ])
                    ]);
                  }))
                })()
              ])
            ]) : null,

            // 3. 变换视口层 (包含连线 + 角色卡 + 分镜卡)
            h('div', {
              ref: canvasLayerRef,
              style: {
                position: 'absolute',
                left: 0,
                top: 0,
                transformOrigin: '0 0'
                // 不设 willChange: transform —— 它会强制整层栅格化为固定分辨率合成纹理，
                // 导致放大时文字糊（见 updateTransform 注释）。缩放时浏览器按目标分辨率重绘。
              }
            }, [
              // 2.95 分镜组底框层 (CANVAS-M3 3.1): 组成员 AABB 虚线框 + 可点击标题
              groups.map(g => {
                const memberBoxes = (g.memberIds || []).map(id => {
                  const p = panels.find(x => x.id === id);
                  if (p) return { x: p.x, y: p.y, width: p.width || 280, height: p.height || 420 };
                  const it = canvasItems.find(x => x.id === id);
                  return it ? { x: it.x, y: it.y, width: it.width || 240, height: it.height || 320 } : null;
                }).filter(Boolean);
                if (!memberBoxes.length) return null;
                const minX = Math.min(...memberBoxes.map(b => b.x)) - 16;
                const minY = Math.min(...memberBoxes.map(b => b.y)) - 30;
                const maxX = Math.max(...memberBoxes.map(b => b.x + b.width)) + 16;
                const maxY = Math.max(...memberBoxes.map(b => b.y + b.height)) + 16;
                return h('div', { key: g.id }, [
                  h('div', {
                    style: {
                      position: 'absolute',
                      left: `${minX}px`,
                      top: `${minY}px`,
                      width: `${maxX - minX}px`,
                      height: `${maxY - minY}px`,
                      border: '1.5px dashed rgba(6, 182, 212, 0.55)',
                      borderRadius: '12px',
                      backgroundColor: 'rgba(6, 182, 212, 0.04)',
                      pointerEvents: 'none'
                    }
                  }),
                  h('div', {
                    onClick: (ev) => {
                      ev.stopPropagation();
                      setSelectedIds(new Set((g.memberIds || []).filter(id => panels.some(p => p.id === id) || canvasItems.some(it => it.id === id))));
                    },
                    title: '点击选中整组成员',
                    style: {
                      position: 'absolute',
                      left: `${minX + 10}px`,
                      top: `${minY + 6}px`,
                      padding: '1px 8px',
                      borderRadius: '6px',
                      fontSize: '10.5px',
                      fontWeight: 600,
                      color: '#06b6d4',
                      backgroundColor: theme.isDark ? 'rgba(6, 182, 212, 0.14)' : 'rgba(6, 182, 212, 0.1)',
                      cursor: 'pointer',
                      pointerEvents: 'auto',
                      userSelect: 'none',
                      width: 'fit-content'
                    }
                  }, g.name || '未命名组')
                ]);
              }),

              // 3.0 拖拽对齐参考线层 (CANVAS-M1 1.8, 世界坐标直绘于变换层内)
              alignGuides.map((g, i) => h('div', {
                key: `guide_${g.orientation}_${g.pos}_${i}`,
                style: {
                  position: 'absolute',
                  left: g.orientation === 'v' ? `${g.pos}px` : '0px',
                  top: g.orientation === 'v' ? '0px' : `${g.pos}px`,
                  width: g.orientation === 'v' ? '1px' : '5000px',
                  height: g.orientation === 'v' ? '5000px' : '1px',
                  backgroundColor: '#f97316',
                  opacity: 0.85,
                  pointerEvents: 'none',
                  zIndex: 60
                }
              })),
              // 3.1 贝塞尔拓扑流光连线层 (智能精确定位对应角色的锚点位置)
              h('svg', {
                style: {
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  width: '100%',
                  height: '100%',
                  overflow: 'visible',
                  pointerEvents: 'none'
                }
              }, [
                // 3.1a 角色卡 -> 分镜卡流光连线
                ...panels.map(p => {
                  const char = characters.find(c => c.id === p.characterId);
                  if (!char) return null;
                  const charIndex = characters.findIndex(c => c.id === p.characterId);
                  const safeCharIndex = charIndex >= 0 ? charIndex : 0;
                  const sourceBox = { x: 40, y: 60 + safeCharIndex * 246, width: 220, height: 230 };
                  const targetBox = { x: p.x, y: p.y, width: p.width || 280, height: p.height || 420 };
                  const defaultStartY = 60 + safeCharIndex * 246 + 65;
                  const defaultEndY = p.y + 30;

                  let d;
                  if (CanvasMathUtils && CanvasMathUtils.calculateSmartConnectionPath) {
                    d = CanvasMathUtils.calculateSmartConnectionPath(sourceBox, targetBox, { defaultStartY, defaultEndY });
                  } else {
                    const startX = 260;
                    const startY = defaultStartY;
                    const endX = p.x;
                    const endY = defaultEndY;
                    const ctrlX1 = startX + (endX - startX) * 0.5;
                    const ctrlY1 = startY;
                    const ctrlX2 = startX + (endX - startX) * 0.5;
                    const ctrlY2 = endY;
                    d = `M ${startX} ${startY} C ${ctrlX1} ${ctrlY1}, ${ctrlX2} ${ctrlY2}, ${endX} ${endY}`;
                  }

                  return h('path', {
                    key: `wire_${p.id}`,
                    d,
                    fill: 'none',
                    stroke: theme.isDark ? '#06b6d4' : '#0891b2',
                    strokeWidth: 2,
                    strokeDasharray: '4 4',
                    opacity: 0.65
                  });
                }).filter(Boolean),

                // 3.1b 显式连线层 (CANVAS-M2 2.4): edges 数据驱动的贝塞尔连线, 可点击选中后 Del 删除
                ...edges.map(e => {
                  const resolveNode = (end) => {
                    if (!end) return null;
                    if (end.type === 'panel') {
                      const p = panels.find(x => x.id === end.id);
                      return p ? { x: p.x, y: p.y, width: p.width || 280, height: p.height || 420 } : null;
                    }
                    const it = canvasItems.find(x => x.id === end.id);
                    return it ? { x: it.x, y: it.y, width: it.width || 240, height: it.height || 320 } : null;
                  };
                  const nodeA = resolveNode(e.from);
                  const nodeB = resolveNode(e.to);
                  if (!nodeA || !nodeB) return null;
                  const pa = CanvasMathUtils && CanvasMathUtils.anchorFor
                    ? CanvasMathUtils.anchorFor(nodeA, 'right')
                    : { x: nodeA.x + nodeA.width, y: nodeA.y + nodeA.height / 2 };
                  const pb = CanvasMathUtils && CanvasMathUtils.anchorFor
                    ? CanvasMathUtils.anchorFor(nodeB, 'left')
                    : { x: nodeB.x, y: nodeB.y + nodeB.height / 2 };
                  const d = CanvasMathUtils && CanvasMathUtils.calculateBezierPath
                    ? CanvasMathUtils.calculateBezierPath(pa, pb)
                    : `M ${pa.x} ${pa.y} L ${pb.x} ${pb.y}`;
                  const isEdgeSelected = selectedIds.has(e.id);
                  return h('path', {
                    key: e.id,
                    d,
                    fill: 'none',
                    stroke: isEdgeSelected ? '#f97316' : '#10b981',
                    strokeWidth: isEdgeSelected ? 3 : 2,
                    strokeDasharray: '6 4',
                    opacity: 0.8,
                    style: { pointerEvents: 'stroke', cursor: 'pointer' },
                    onPointerDown: (ev) => {
                      ev.stopPropagation();
                      setSelectedIds(new Set([e.id]));
                    }
                  });
                }).filter(Boolean),

                // 3.1c 连线拖拽临时线 (CANVAS-M2 2.4)
                connectDrag ? (() => {
                  const srcNode = connectDrag.from.type === 'panel'
                    ? panels.find(x => x.id === connectDrag.from.id)
                    : canvasItems.find(x => x.id === connectDrag.from.id);
                  if (!srcNode) return null;
                  const box = { x: srcNode.x, y: srcNode.y, width: srcNode.width || 280, height: srcNode.height || (srcNode.type === 'image' ? 320 : 140) };
                  const pa = CanvasMathUtils && CanvasMathUtils.anchorFor
                    ? CanvasMathUtils.anchorFor(box, 'right')
                    : { x: box.x + box.width, y: box.y + box.height / 2 };
                  return h('path', {
                    key: 'connect_drag_tmp',
                    d: `M ${pa.x} ${pa.y} L ${connectDrag.x} ${connectDrag.y}`,
                    fill: 'none',
                    stroke: '#10b981',
                    strokeWidth: 2,
                    strokeDasharray: '4 4',
                    opacity: 0.9,
                    pointerEvents: 'none'
                  });
                })() : null
              ].filter(Boolean)),

              // 3.2 角色资产库锚点卡
              h('div', {
                id: 'winetoken-canvas-char-deck',
                style: {
                  position: 'absolute',
                  left: '40px',
                  top: '60px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '16px'
                }
              }, characters.map(c => h('div', {
                key: c.id,
                style: {
                  width: '220px',
                  padding: '14px',
                  borderRadius: '10px',
                  backgroundColor: theme.bgCard,
                  border: `1px solid ${theme.borderSubtle}`,
                  boxShadow: '0 10px 25px rgba(0, 0, 0, 0.2)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px'
                }
              }, [
                h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } }, [
                  h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } }, [
                    h(Icon, { name: 'user', size: 14 }),
                    h('input', {
                      value: c.name,
                      onChange: (e) => {
                        const val = e.target.value;
                        setCharacters(prev => prev.map(x => x.id === c.id ? { ...x, name: val } : x));
                      },
                      style: {
                        background: 'transparent',
                        border: 'none',
                        color: theme.textPrimary,
                        fontSize: '13px',
                        fontWeight: 600,
                        width: '95px'
                      }
                    })
                  ]),
                  h('div', { style: { display: 'flex', alignItems: 'center', gap: '4px' } }, [
                    // 为该角色快捷添加专属分镜
                    h('button', {
                      type: 'button',
                      onClick: () => handleAddPanel('2:3', 'CU', '特写', c.id),
                      title: `为【${c.name}】添加专属分镜`,
                      style: {
                        background: 'transparent',
                        border: '1px solid rgba(6, 182, 212, 0.4)',
                        color: '#06b6d4',
                        borderRadius: '3px',
                        padding: '1px 5px',
                        fontSize: '10px',
                        cursor: 'pointer',
                        fontWeight: '500'
                      }
                    }, '+添分镜'),
                    // 删除角色 (仅当角色总数大于 1 时允许删除，防止无角色)
                    characters.length > 1 && h('button', {
                      type: 'button',
                      onClick: () => {
                        if (confirm(`确认删除角色【${c.name}】？该角色的已有分镜将自动移交给主角。`)) {
                          handleDeleteCharacter(c.id);
                        }
                      },
                      title: `删除【${c.name}】`,
                      style: {
                        background: 'transparent',
                        border: `1px solid ${theme.borderSubtle}`,
                        color: theme.textMuted,
                        borderRadius: '3px',
                        padding: '1px 5px',
                        fontSize: '10px',
                        cursor: 'pointer'
                      },
                      onMouseEnter: (e) => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.borderColor = '#ef4444'; },
                      onMouseLeave: (e) => { e.currentTarget.style.color = theme.textMuted; e.currentTarget.style.borderColor = theme.borderSubtle; }
                    }, '删除')
                  ])
                ]),

                h('div', {
                  onClick: () => {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = 'image/png,image/jpeg,image/webp';
                    input.onchange = (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = (evt) => {
                        const b64 = evt.target?.result;
                        if (b64) {
                          setCharacters(prev => prev.map(x => x.id === c.id ? { ...x, avatar: b64 } : x));
                        }
                      };
                      reader.readAsDataURL(file);
                    };
                    input.click();
                  },
                  title: '点击上传主角定妆照 (PNG/JPG/WEBP)',
                  style: {
                    height: '100px',
                    borderRadius: '6px',
                    backgroundColor: theme.isDark ? '#181b22' : '#f1f5f9',
                    border: `1px dashed ${c.avatar ? '#06b6d4' : theme.borderSubtle}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: theme.textMuted,
                    fontSize: '11px',
                    position: 'relative',
                    cursor: 'pointer',
                    overflow: 'hidden'
                  }
                }, [
                  c.avatar
                    ? h('div', { style: { position: 'relative', width: '100%', height: '100%' } }, [
                        h('img', { src: c.avatar, style: { width: '100%', height: '100%', objectFit: 'cover' } }),
                        h('button', {
                          type: 'button',
                          onClick: (e) => {
                            e.stopPropagation();
                            setCharacters(prev => prev.map(x => x.id === c.id ? { ...x, avatar: '' } : x));
                          },
                          title: '清除定妆照',
                          style: {
                            position: 'absolute',
                            top: '4px',
                            right: '4px',
                            background: 'rgba(0, 0, 0, 0.65)',
                            color: '#ffffff',
                            border: 'none',
                            borderRadius: '4px',
                            padding: '2px 5px',
                            fontSize: '10px',
                            cursor: 'pointer'
                          }
                        }, '清除')
                      ])
                    : h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' } }, [
                        h(Icon, { name: 'camera', size: 16 }),
                        h('span', {}, '上传主角定妆照')
                      ])
                ]),

                h('textarea', {
                  value: c.dna,
                  onChange: (e) => {
                    const val = e.target.value;
                    setCharacters(prev => prev.map(x => x.id === c.id ? { ...x, dna: val } : x));
                  },
                  placeholder: '输入角色固定外貌特征 DNA 标签...',
                  rows: 2,
                  style: {
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '6px',
                    fontSize: '11px',
                    borderRadius: '4px',
                    backgroundColor: theme.isDark ? '#141720' : '#ffffff',
                    border: `1px solid ${theme.borderSubtle}`,
                    color: theme.textSecondary,
                    resize: 'none',
                    lineHeight: '1.4'
                  }
                })
              ]))),

              // 3.25 通用画布节点 (CANVAS-M2 2.2/2.3 / LibTV 规格): 生成图/视频/文本对象, 节点即生成器
              h('div', { id: 'winetoken-canvas-items-area' }, canvasItems.map(item => {
                const isItemSelected = selectedIds.has(item.id);
                const itemData = item.data || {}; // 脏工程兜底: 新增节点字段一律经此访问
                const nodeTags = Array.isArray(itemData.tags) ? itemData.tags : [];
                const isTagMatched = tagFilter === '全部' || nodeTags.includes(tagFilter);
                const tagOpacity = isTagMatched ? 1 : 0.28;
                const tagBoxShadow = (tagFilter !== '全部' && isTagMatched)
                  ? '0 0 0 2px #06b6d4, 0 10px 24px rgba(6, 182, 212, 0.45)'
                  : (isItemSelected
                    ? '0 0 0 2px rgba(6, 182, 212, 0.45), 0 10px 24px rgba(0, 0, 0, 0.25)'
                    : '0 10px 24px rgba(0, 0, 0, 0.22)');

                const itemW = Math.max(item.width || 240, item.type === 'video' ? 330 : (item.type === 'image' ? 290 : 240));
                const itemH = Math.max(item.height || 320, item.type === 'video' ? 470 : (item.type === 'image' ? 460 : 160));

                const isItemOnScreen = (CanvasMathUtils && CanvasMathUtils.isIntersectingAABB)
                  ? CanvasMathUtils.isIntersectingAABB({ x: item.x, y: item.y, width: itemW, height: itemH }, viewWorldBox)
                  : true;

                // 引用边分析与上游生成上下文采集 (纯函数)
                const projectSnapshot = { characters, panels, canvasItems, edges, groups };
                const itemCtx = CanvasNodeUtils && CanvasNodeUtils.buildGenerationContext
                  ? CanvasNodeUtils.buildGenerationContext(projectSnapshot, item.id)
                  : { prompt: '', referenceImages: [], params: {}, mode: 'default' };

                let displaySrc = itemData.url || '';
                if (displaySrc.startsWith('asset:') && canvasAssetsDriver) {
                  try { displaySrc = canvasAssetsDriver.readAsDataUrl(displaySrc.slice(6)); }
                  catch (_) { displaySrc = ''; }
                }

                // 计价数据 (明码标价，来自真实 Manifest，不许编造)
                let priceBadge = '';
                if (item.type === 'image') {
                  const chosenImgModel = (itemData.params?.model) || canvasModel || WineTokenManifestManager.getFreeImageModel() || 'sensenova-u1.5-lite';
                  const modelObj = availableImageModels.find(m => m.id === chosenImgModel) || { id: chosenImgModel };
                  const pInfo = CanvasPricingUtils
                    ? CanvasPricingUtils.calculateImagePrice(modelObj, { count: itemData.params?.count || 1, isVip, isSvip, isSuper })
                    : { priceText: '' };
                  priceBadge = CanvasPricingUtils ? CanvasPricingUtils.formatPriceBadge(pInfo.priceText) : '';
                } else if (item.type === 'video') {
                  const chosenVidModel = (itemData.params?.model) || (availableVideoModels[0]?.id) || 'MiniMax-H3';
                  const modelObj = availableVideoModels.find(m => m.id === chosenVidModel) || { id: chosenVidModel };
                  const pInfo = CanvasPricingUtils
                    ? CanvasPricingUtils.calculateVideoPrice(modelObj, { duration: itemData.params?.duration || 5, isVip, isSvip, isSuper })
                    : { priceText: '' };
                  priceBadge = CanvasPricingUtils ? CanvasPricingUtils.formatPriceBadge(pInfo.priceText) : '';
                }

                return h('div', {
                  key: item.id,
                  'data-node-id': item.id,
                  'data-node-type': 'item',
                  onPointerDown: (e) => beginObjectDrag(e, 'item', item),
                  style: {
                    position: 'absolute',
                    left: `${item.x}px`,
                    top: `${item.y}px`,
                    width: `${itemW}px`,
                    height: `${itemH}px`,
                    backgroundColor: theme.bgCard,
                    border: `1px solid ${isItemSelected ? '#06b6d4' : theme.borderSubtle}`,
                    borderRadius: '10px',
                    boxShadow: tagBoxShadow,
                    opacity: tagOpacity,
                    overflow: 'hidden',
                    display: isItemOnScreen ? 'flex' : 'none',
                    flexDirection: 'column',
                    zIndex: isItemSelected ? 30 : 10
                  }
                }, [
                  // 1. 节点顶栏: 名称内联编辑 / 标签 / 连线手柄 / 删除
                  h('div', {
                    style: {
                      padding: '5px 10px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '6px',
                      borderBottom: `1px solid ${theme.borderSubtle}`,
                      backgroundColor: theme.isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)',
                      cursor: 'grab',
                      userSelect: 'none'
                    }
                  }, [
                    // 资产命名内联编辑 (S2)
                    h('input', {
                      value: itemData.name || (item.type === 'image' ? '图片节点' : (item.type === 'video' ? '视频节点' : '文本便签')),
                      onPointerDown: (ev) => ev.stopPropagation(),
                      onChange: (ev) => {
                        const val = ev.target.value;
                        setCanvasItems(prev => prev.map(x => x.id === item.id ? { ...x, data: { ...x.data, name: val } } : x));
                      },
                      style: {
                        background: 'transparent', border: 'none', outline: 'none', color: theme.textPrimary,
                        fontSize: '11px', fontWeight: 600, flex: 1, minWidth: '60px', overflow: 'hidden', textOverflow: 'ellipsis'
                      }
                    }),
                    // S3 节点标签徽标集
                    h('div', { style: { display: 'flex', gap: '3px', alignItems: 'center' } }, [
                      nodeTags.map(tLabel => {
                        const tDef = (CanvasPromptUtils?.CANVAS_TAGS || []).find(t => t.label === tLabel) || { color: '#06b6d4', bg: 'rgba(6,182,212,0.15)', label: tLabel };
                        return h('span', {
                          key: tLabel,
                          onClick: (ev) => { ev.stopPropagation(); toggleNodeTag(item.id, 'item', tLabel); },
                          title: '点击移除该标签',
                          style: {
                            fontSize: '9px', color: tDef.color, backgroundColor: tDef.bg, border: `1px solid ${tDef.color}`,
                            padding: '1px 4px', borderRadius: '4px', cursor: 'pointer', whiteSpace: 'nowrap'
                          }
                        }, tLabel);
                      }),
                      h('button', {
                        type: 'button',
                        title: '设置该节点标签与自定义关键词 (S3)',
                        onPointerDown: (ev) => ev.stopPropagation(),
                        onClick: (ev) => {
                          ev.stopPropagation();
                          setTagPicker(prev => (prev && prev.nodeId === item.id) ? null : { nodeId: item.id, nodeType: 'item' });
                        },
                        style: {
                          background: 'none', border: `1px solid ${theme.borderSubtle}`, borderRadius: '4px',
                          color: theme.textSecondary, cursor: 'pointer', fontSize: '9px', padding: '1px 3px'
                        }
                      }, '+标签')
                    ]),
                    // 连线锚点 (拖出连线)
                    h('div', {
                      onPointerDown: (ev) => beginConnectDrag(ev, 'item', item.id),
                      title: '拖出连线到目标节点 (作为参考图/生成输入)',
                      style: { width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#10b981', border: '1.5px solid #ffffff', boxShadow: '0 0 5px rgba(16, 185, 129, 0.6)', cursor: 'crosshair', flexShrink: 0 }
                    }),
                    h('button', {
                      type: 'button',
                      title: '删除该节点',
                      onPointerDown: (ev) => ev.stopPropagation(),
                      onClick: () => {
                        if (canvasHistoryManager) canvasHistoryManager.pushState(snapshotState());
                        setCanvasItems(prev => prev.filter(x => x.id !== item.id));
                        setEdges(prev => prev.filter(x => x.from.id !== item.id && x.to.id !== item.id));
                        setSelectedIds(prev => {
                          const n = new Set(prev);
                          n.delete(item.id);
                          return n;
                        });
                      },
                      style: { background: 'none', border: 'none', color: theme.textMuted, cursor: 'pointer', fontSize: '12px', lineHeight: 1, flexShrink: 0 }
                    }, '×')
                  ]),

                  // S3 标签快速点选悬浮浮层
                  (tagPicker && tagPicker.nodeId === item.id) ? h('div', {
                    onPointerDown: (ev) => ev.stopPropagation(),
                    onClick: (ev) => ev.stopPropagation(),
                    style: {
                      padding: '8px', borderBottom: `1px solid ${theme.borderSubtle}`,
                      backgroundColor: theme.popoverBg, display: 'flex', flexDirection: 'column', gap: '6px'
                    }
                  }, [
                    h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '4px' } }, (CanvasPromptUtils?.CANVAS_TAGS || []).map(t => {
                      const isTagged = nodeTags.includes(t.label);
                      return h('button', {
                        key: t.id,
                        type: 'button',
                        onClick: () => toggleNodeTag(item.id, 'item', t.label),
                        style: {
                          border: `1px solid ${t.color}`,
                          backgroundColor: isTagged ? t.color : t.bg,
                          color: isTagged ? '#ffffff' : t.color,
                          fontSize: '9.5px', padding: '2px 5px', borderRadius: '4px', cursor: 'pointer'
                        }
                      }, t.label);
                    })),
                    h('input', {
                      placeholder: '输入关键词按回车添加...',
                      onKeyDown: (ev) => {
                        if (ev.key === 'Enter') {
                          ev.stopPropagation();
                          addCustomKeyword(item.id, 'item', ev.target.value);
                          ev.target.value = '';
                        }
                      },
                      style: {
                        fontSize: '10px', padding: '3px 6px', border: `1px solid ${theme.borderSubtle}`,
                        borderRadius: '4px', backgroundColor: theme.bgInput, color: theme.textPrimary, outline: 'none'
                      }
                    })
                  ]) : null,

                  // =================== 图片节点 (LibTV 生成层核心) ===================
                  item.type === 'image' ? [
                    // S4 图像后处理工具条 (有产物图时展现: 裁剪/存资产/派生)
                    displaySrc ? h('div', {
                      style: {
                        display: 'flex', alignItems: 'center', gap: '3px', padding: '3px 8px',
                        borderBottom: `1px solid ${theme.borderSubtle}`, overflowX: 'auto', scrollbarWidth: 'none',
                        backgroundColor: theme.isDark ? 'rgba(0,0,0,0.18)' : 'rgba(0,0,0,0.02)'
                      }
                    }, [
                      h('button', {
                        type: 'button', onClick: () => setCropModal({ itemId: item.id, url: displaySrc, assetKey: itemData.assetKey }),
                        title: '本地裁剪生成新资产 (S4)',
                        style: { background: 'none', border: `1px solid ${theme.borderSubtle}`, borderRadius: '3px', color: theme.textSecondary, fontSize: '9.5px', padding: '1px 4px', cursor: 'pointer', whiteSpace: 'nowrap' }
                      }, '裁剪'),
                      h('button', {
                        type: 'button', onClick: () => setSaveAssetModal({ itemId: item.id, assetKey: itemData.assetKey, url: displaySrc, name: itemData.name || '图片资产', category: '自定义', description: itemData.prompt || '', tags: itemData.tags || [] }),
                        title: '命名分类保存进资产库 (S1/S2)',
                        style: { background: 'none', border: `1px solid ${theme.borderSubtle}`, borderRadius: '3px', color: '#10b981', fontSize: '9.5px', padding: '1px 4px', cursor: 'pointer', whiteSpace: 'nowrap' }
                      }, '存为资产'),
                      h('div', { style: { width: '1px', height: '12px', backgroundColor: theme.borderSubtle, margin: '0 1px' } }),
                      [
                        { id: 'hd', label: '高清' },
                        { id: 'repaint', label: '重绘' },
                        { id: 'panorama', label: '全景' },
                        { id: 'multi_angle', label: '多机位' },
                        { id: 'relight', label: '重打光' },
                        { id: 'layer_split', label: '图层拆分' }
                      ].map(act => h('button', {
                        key: act.id,
                        type: 'button',
                        onClick: () => handleDeriveItem(item, act.id),
                        title: `基于当前图派生生成: ${act.label} (自动建立上游连线)`,
                        style: { background: 'none', border: `1px solid ${theme.borderSubtle}`, borderRadius: '3px', color: '#06b6d4', fontSize: '9.5px', padding: '1px 4px', cursor: 'pointer', whiteSpace: 'nowrap' }
                      }, act.label))
                    ]) : null,

                    // 模型与预设选择行 (模型只能来自线上 Manifest / 预设来自 16 预设库)
                    h('div', {
                      style: {
                        padding: '4px 8px', borderBottom: `1px solid ${theme.borderSubtle}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px'
                      }
                    }, [
                      h('select', {
                        value: itemData.params?.model || canvasModel || 'sensenova-u1.5-lite',
                        onPointerDown: (ev) => ev.stopPropagation(),
                        onChange: (e) => {
                          const val = e.target.value;
                          setCanvasItems(prev => prev.map(x => x.id === item.id ? { ...x, data: { ...x.data, params: { ...(x.data?.params || {}), model: val } } } : x));
                        },
                        title: '选择生成模型 (以线上 Manifest 为准)',
                        style: {
                          flex: 1, background: theme.bgInput, border: `1px solid ${theme.borderSubtle}`,
                          color: theme.textPrimary, fontSize: '10.5px', borderRadius: '4px', padding: '2px 4px', outline: 'none', cursor: 'pointer'
                        }
                      }, availableImageModels.map(m => {
                        const isFree = m.price === 0 || (m.tag && m.tag.includes('限免'));
                        const pTxt = isFree ? '限免' : (m.price != null ? `¥${m.price}` : '');
                        return h('option', { key: m.id, value: m.id }, `${m.name} ${m.tag ? '[' + m.tag + ']' : ''} ${pTxt ? '(' + pTxt + ')' : ''}`);
                      })),
                      h('button', {
                        type: 'button',
                        onClick: () => setPresetModal({ targetItemId: item.id }),
                        title: '套用 16 个专业预设库 (调度/宫格/视图/质感)',
                        style: {
                          background: 'none', border: `1px solid ${theme.borderSubtle}`, borderRadius: '4px',
                          color: '#06b6d4', fontSize: '10.5px', padding: '2px 6px', cursor: 'pointer', flexShrink: 0
                        }
                      }, '预设')
                    ]),

                    // 提示词输入区域
                    h('textarea', {
                      value: itemData.prompt || '',
                      onPointerDown: (ev) => ev.stopPropagation(),
                      onChange: (e) => {
                        const val = e.target.value;
                        setCanvasItems(prev => prev.map(x => x.id === item.id ? { ...x, data: { ...x.data, prompt: val } } : x));
                      },
                      placeholder: '输入该节点的生图提示词 (上游文本节点将自动追加)...',
                      style: {
                        height: '52px', resize: 'none', border: 'none', borderBottom: `1px solid ${theme.borderSubtle}`,
                        padding: '6px 8px', fontSize: '11px', backgroundColor: 'transparent',
                        color: theme.textPrimary, outline: 'none', boxSizing: 'border-box', lineHeight: 1.4
                      }
                    }),

                    // 参数控制行: 比例 / 画质 / 张数 / 上游参考图角标
                    h('div', {
                      style: {
                        padding: '4px 8px', borderBottom: `1px solid ${theme.borderSubtle}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px', flexWrap: 'nowrap', overflowX: 'auto', scrollbarWidth: 'none'
                      }
                    }, [
                      h('select', {
                        value: itemData.params?.aspectRatio || '16:9',
                        onPointerDown: (ev) => ev.stopPropagation(),
                        onChange: (e) => {
                          const val = e.target.value;
                          setCanvasItems(prev => prev.map(x => x.id === item.id ? { ...x, data: { ...x.data, params: { ...(x.data?.params || {}), aspectRatio: val } } } : x));
                        },
                        title: '画面比例',
                        style: { background: theme.bgInput, border: `1px solid ${theme.borderSubtle}`, color: theme.textPrimary, fontSize: '10px', borderRadius: '4px', padding: '1px 3px', cursor: 'pointer' }
                      }, [
                        { val: '1:1', label: '1:1 正方' },
                        { val: '16:9', label: '16:9 横屏' },
                        { val: '9:16', label: '9:16 竖屏' },
                        { val: '4:3', label: '4:3 宽屏' },
                        { val: '3:4', label: '3:4 竖屏' }
                      ].map(opt => h('option', { key: opt.val, value: opt.val }, opt.label))),
                      h('select', {
                        value: itemData.params?.quality || 'standard',
                        onPointerDown: (ev) => ev.stopPropagation(),
                        onChange: (e) => {
                          const val = e.target.value;
                          setCanvasItems(prev => prev.map(x => x.id === item.id ? { ...x, data: { ...x.data, params: { ...(x.data?.params || {}), quality: val } } } : x));
                        },
                        title: '画质档位',
                        style: { background: theme.bgInput, border: `1px solid ${theme.borderSubtle}`, color: theme.textPrimary, fontSize: '10px', borderRadius: '4px', padding: '1px 3px', cursor: 'pointer' }
                      }, [
                        { val: 'standard', label: '标准 1K' },
                        { val: '2k', label: '2K 高清' },
                        { val: '4k', label: '4K 超清' }
                      ].map(opt => h('option', { key: opt.val, value: opt.val }, opt.label))),
                      h('select', {
                        value: String(itemData.params?.count || 1),
                        onPointerDown: (ev) => ev.stopPropagation(),
                        onChange: (e) => {
                          const val = Number(e.target.value) || 1;
                          setCanvasItems(prev => prev.map(x => x.id === item.id ? { ...x, data: { ...x.data, params: { ...(x.data?.params || {}), count: val } } } : x));
                        },
                        title: '出图张数',
                        style: { background: theme.bgInput, border: `1px solid ${theme.borderSubtle}`, color: theme.textPrimary, fontSize: '10px', borderRadius: '4px', padding: '1px 3px', cursor: 'pointer' }
                      }, [1, 2, 4].map(n => h('option', { key: n, value: String(n) }, `${n}张`))),
                      itemCtx.referenceImages.length > 0 ? h('span', {
                        title: '上游连线汇入的参考图',
                        style: { fontSize: '9px', color: '#06b6d4', padding: '1px 4px', border: '1px solid rgba(6,182,212,0.3)', borderRadius: '3px', whiteSpace: 'nowrap' }
                      }, `参考图×${itemCtx.referenceImages.length}`) : null
                    ]),

                    // 图像渲染展示区域 (双击灯箱全屏 / 双击上传)
                    h('div', {
                      style: { flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#000', overflow: 'hidden', position: 'relative' }
                    }, [
                      displaySrc ? h('img', {
                        src: displaySrc,
                        draggable: false,
                        onDoubleClick: () => setLightboxUrl(displaySrc),
                        title: '双击查看 1:1 点对点点全屏预览',
                        style: { width: '100%', height: '100%', objectFit: 'contain', imageRendering: '-webkit-optimize-contrast', cursor: 'zoom-in' }
                      }) : (
                        itemData.generating ? h('div', {
                          style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', color: '#06b6d4', fontSize: '11px' }
                        }, [
                          h(Icon, { name: 'spinner', size: 18, style: { animation: 'wt-spin 1s linear infinite' } }),
                          h('span', {}, 'AI 渲染生成中…')
                        ]) : h('div', {
                          onDoubleClick: () => {
                            const input = document.createElement('input');
                            input.type = 'file';
                            input.accept = 'image/png,image/jpeg,image/webp';
                            input.onchange = () => {
                              const f = input.files && input.files[0];
                              if (!f) return;
                              const reader = new FileReader();
                              reader.onload = () => {
                                const dUrl = String(reader.result);
                                let aKey = '';
                                if (canvasAssetsDriver) {
                                  try { const saved = canvasAssetsDriver.saveDataUrl(dUrl); aKey = saved.assetKey; } catch (_) {}
                                }
                                setCanvasItems(prev => prev.map(x => x.id === item.id ? { ...x, data: { ...x.data, url: aKey ? `asset:${aKey}` : dUrl, assetKey: aKey } } : x));
                              };
                              reader.readAsDataURL(f);
                            };
                            input.click();
                          },
                          style: { color: theme.textMuted, fontSize: '11px', textAlign: 'center', padding: '10px', cursor: 'pointer' }
                        }, itemData.error ? `错误: ${itemData.error}` : '双击上传本地参考图 / 或连线汇入')
                      )
                    ]),

                    // 底部生成与明码标价行 (LIBTV_FULL_PARITY_BRIEF §3.2.5)
                    h('div', {
                      style: {
                        padding: '6px 10px', borderTop: `1px solid ${theme.borderSubtle}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        backgroundColor: theme.isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)'
                      }
                    }, [
                      h('div', { style: { fontSize: '10px', color: theme.textMuted } }, itemData.error ? '生成异常' : (displaySrc ? '已就绪' : '待生成')),
                      h('button', {
                        type: 'button',
                        disabled: itemData.generating,
                        onClick: () => handleGenerateItem(item.id),
                        title: `按当前节点参数及上游连线输入生成 ${priceBadge}`,
                        style: {
                          backgroundColor: itemData.generating ? theme.borderSubtle : '#06b6d4',
                          border: 'none', borderRadius: '5px', color: '#ffffff',
                          fontSize: '11px', fontWeight: 600, padding: '4px 10px', cursor: itemData.generating ? 'not-allowed' : 'pointer'
                        }
                      }, itemData.generating ? '生成中...' : (displaySrc ? `重跑 ${priceBadge}` : `生成 ${priceBadge}`))
                    ])
                  ] : (item.type === 'video' ? (() => {
                    const chosenNodeModel = itemData.params?.model || (availableVideoModels[0]?.id) || 'MiniMax-H3';
                    const is2KNode = /minimax-h3-2k/i.test(chosenNodeModel);
                    const isH3Node = !is2KNode && /minimax/i.test(chosenNodeModel);
                    const nodeModelObj = availableVideoModels.find(m => m.id === chosenNodeModel);
                    const nodeDurationOpts = is2KNode
                      ? [5, 6, 10, 15]
                      : ((nodeModelObj?.durations && nodeModelObj.durations.length)
                          ? nodeModelObj.durations.map(d => typeof d === 'object' ? d.val : d)
                          : [4, 5, 6, 10, 15]);

                    let nodeResolutionOpts;
                    let effectiveResolution;
                    if (is2KNode) {
                      nodeResolutionOpts = [{ val: '2K', label: '2K' }];
                      effectiveResolution = '2K';
                    } else if (isH3Node) {
                      nodeResolutionOpts = [{ val: '720P', label: '720P' }];
                      effectiveResolution = '720P';
                    } else {
                      nodeResolutionOpts = [
                        { val: '720P', label: '720P' },
                        { val: '1080P', label: '1080P' }
                      ];
                      effectiveResolution = itemData.params?.resolution === '1080P' ? '1080P' : '720P';
                    }
                    const effectiveDuration = (is2KNode && itemData.params?.duration === 4)
                      ? 5
                      : (itemData.params?.duration || 5);

                    const resolveNodeSize = (res, aspect) => {
                      const isVert = (aspect === '9:16');
                      if (res === '2K') return isVert ? '1440x2560' : '2560x1440';
                      if (res === '1080P') return isVert ? '1080x1920' : '1920x1080';
                      return isVert ? '720x1280' : '1280x720';
                    };

                    return [
                      // =================== 视频节点 (LibTV 规格 + 全能参考) ===================
                      // 参考模式角标与模型行
                      h('div', {
                        style: {
                          padding: '5px 8px', borderBottom: `1px solid ${theme.borderSubtle}`,
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px'
                        }
                      }, [
                        h('span', {
                          title: itemCtx.mode === 'multi_reference' ? '多张上游图片连线汇入，已开启全能多图参考模式' : '视频参考模式',
                          style: {
                            fontSize: '9.5px', color: itemCtx.mode === 'multi_reference' ? '#10b981' : '#06b6d4',
                            border: `1px solid ${itemCtx.mode === 'multi_reference' ? 'rgba(16,185,129,0.4)' : 'rgba(6,182,212,0.3)'}`,
                            padding: '1px 5px', borderRadius: '4px', whiteSpace: 'nowrap', fontWeight: 600
                          }
                        }, itemCtx.mode === 'multi_reference' ? `全能参考(${itemCtx.multiReferenceCount}图)` : (itemCtx.mode === 'single_reference' ? '首帧参考' : '文生视频')),
                        h('select', {
                          value: chosenNodeModel,
                          onPointerDown: (ev) => ev.stopPropagation(),
                          onChange: (e) => {
                            const val = e.target.value;
                            const nextIs2K = /minimax-h3-2k/i.test(val);
                            const nextIsH3 = !nextIs2K && /minimax/i.test(val);
                            let nextRes = itemData.params?.resolution || '720P';
                            let nextDuration = itemData.params?.duration || 5;
                            if (nextIs2K) {
                              nextRes = '2K';
                              if (nextDuration === 4) nextDuration = 5;
                            } else if (nextIsH3 && nextRes === '1080P') {
                              nextRes = '720P';
                            }
                            const nextSize = resolveNodeSize(nextRes, itemData.params?.aspectRatio || '16:9');
                            setCanvasItems(prev => prev.map(x => x.id === item.id ? { ...x, data: { ...x.data, params: { ...(x.data?.params || {}), model: val, resolution: nextRes, duration: nextDuration, size: nextSize } } } : x));
                          },
                          title: '选择视频模型 (以线上 Manifest 为准)',
                          style: {
                            flex: 1, background: theme.bgInput, border: `1px solid ${theme.borderSubtle}`,
                            color: theme.textPrimary, fontSize: '10.5px', borderRadius: '4px', padding: '2px 4px', outline: 'none', cursor: 'pointer'
                          }
                        }, availableVideoModels.map(m => h('option', { key: m.id, value: m.id }, `${m.name} [${m.tag || '推荐'}]`)))
                      ]),

                      // 视频提示词
                      h('textarea', {
                        value: itemData.prompt || '',
                        onPointerDown: (ev) => ev.stopPropagation(),
                        onChange: (e) => {
                          const val = e.target.value;
                          setCanvasItems(prev => prev.map(x => x.id === item.id ? { ...x, data: { ...x.data, prompt: val } } : x));
                        },
                        placeholder: '输入该节点的视频动态与运镜提示词...',
                        style: {
                          height: '52px', resize: 'none', border: 'none', borderBottom: `1px solid ${theme.borderSubtle}`,
                          padding: '6px 8px', fontSize: '11px', backgroundColor: 'transparent',
                          color: theme.textPrimary, outline: 'none', boxSizing: 'border-box', lineHeight: 1.4
                        }
                      }),

                      // 视频参数控制行: 时长 / 分辨率 / 比例 / 音频 / 数量
                      h('div', {
                        style: {
                          padding: '4px 8px', borderBottom: `1px solid ${theme.borderSubtle}`,
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px', overflowX: 'auto', scrollbarWidth: 'none'
                        }
                      }, [
                        h('select', {
                          value: String(effectiveDuration),
                          onPointerDown: (ev) => ev.stopPropagation(),
                          onChange: (e) => {
                            const val = Number(e.target.value) || 5;
                            setCanvasItems(prev => prev.map(x => x.id === item.id ? { ...x, data: { ...x.data, params: { ...(x.data?.params || {}), duration: val } } } : x));
                          },
                          title: '生成时长',
                          style: { background: theme.bgInput, border: `1px solid ${theme.borderSubtle}`, color: theme.textPrimary, fontSize: '10px', borderRadius: '4px', padding: '1px 3px', cursor: 'pointer' }
                        }, nodeDurationOpts.map(d => h('option', { key: d, value: String(d) }, `${d}秒`))),
                        h('select', {
                          value: effectiveResolution,
                          onPointerDown: (ev) => ev.stopPropagation(),
                          onChange: (e) => {
                            const val = e.target.value;
                            const curAspect = itemData.params?.aspectRatio || '16:9';
                            setCanvasItems(prev => prev.map(x => x.id === item.id ? { ...x, data: { ...x.data, params: { ...(x.data?.params || {}), resolution: val, size: resolveNodeSize(val, curAspect) } } } : x));
                          },
                          title: '分辨率',
                          style: { background: theme.bgInput, border: `1px solid ${theme.borderSubtle}`, color: theme.textPrimary, fontSize: '10px', borderRadius: '4px', padding: '1px 3px', cursor: 'pointer' }
                        }, nodeResolutionOpts.map(opt => h('option', { key: opt.val, value: opt.val }, opt.label))),
                        h('select', {
                          value: itemData.params?.aspectRatio || '16:9',
                          onPointerDown: (ev) => ev.stopPropagation(),
                          onChange: (e) => {
                            const val = e.target.value;
                            setCanvasItems(prev => prev.map(x => x.id === item.id ? { ...x, data: { ...x.data, params: { ...(x.data?.params || {}), aspectRatio: val, size: resolveNodeSize(effectiveResolution, val) } } } : x));
                          },
                          title: '视频比例',
                          style: { background: theme.bgInput, border: `1px solid ${theme.borderSubtle}`, color: theme.textPrimary, fontSize: '10px', borderRadius: '4px', padding: '1px 3px', cursor: 'pointer' }
                        }, [
                          { val: '16:9', label: '16:9 横屏' },
                          { val: '9:16', label: '9:16 竖屏' }
                        ].map(opt => h('option', { key: opt.val, value: opt.val }, opt.label))),
                        h('button', {
                          type: 'button',
                          onClick: () => {
                            const nextAudio = !itemData.params?.generateAudio;
                            setCanvasItems(prev => prev.map(x => x.id === item.id ? { ...x, data: { ...x.data, params: { ...(x.data?.params || {}), generateAudio: nextAudio } } } : x));
                          },
                          title: '音频开关 (按模型能力支持)',
                          style: {
                            background: itemData.params?.generateAudio ? '#06b6d4' : theme.bgInput,
                            color: itemData.params?.generateAudio ? '#ffffff' : theme.textMuted,
                            border: `1px solid ${theme.borderSubtle}`, borderRadius: '4px', fontSize: '9.5px', padding: '1px 4px', cursor: 'pointer'
                          }
                        }, itemData.params?.generateAudio ? '音频:开' : '音频:关')
                      ]),

                      // 视频播放与轮询渲染区域
                      h('div', {
                        style: { flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#000', overflow: 'hidden', position: 'relative' }
                      }, [
                        (() => {
                          const vState = itemData.videoState || { status: 'idle' };
                          let videoSrc = itemData.url || '';
                          if (videoSrc.startsWith('asset:') && canvasAssetsDriver) {
                            try { videoSrc = canvasAssetsDriver.readAsDataUrl(videoSrc.slice(6)); } catch (_) {}
                          }
                          if (videoSrc) {
                            return h('video', {
                              src: videoSrc, controls: true, loop: true,
                              onPointerDown: (ev) => ev.stopPropagation(),
                              style: { width: '100%', height: '100%', objectFit: 'contain' }
                            });
                          }
                          const busy = ['submitting', 'polling'].includes(vState.status);
                          return h('div', {
                            style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', color: theme.textMuted, fontSize: '11px', textAlign: 'center', padding: '12px' }
                          }, [
                            busy ? h(Icon, { name: 'spinner', size: 18, style: { animation: 'wt-spin 1s linear infinite', color: '#06b6d4' } }) : null,
                            h('div', {}, busy ? `视频生成中 (第 ${vState.attempt || 1} 次轮询 / 300秒)` : (vState.error || '连线多张图片后点击下方「生成视频」')),
                            busy ? h('button', {
                              type: 'button', onClick: () => handleCancelVideoItem(item.id),
                              style: { background: 'none', border: `1px solid ${theme.borderSubtle}`, borderRadius: '4px', color: theme.textMuted, cursor: 'pointer', fontSize: '10px', padding: '2px 8px', marginTop: '4px' }
                            }, '取消轮询') : null
                          ]);
                        })()
                      ]),

                      // 视频底部明码标价行
                      h('div', {
                        style: {
                          padding: '6px 10px', borderTop: `1px solid ${theme.borderSubtle}`,
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          backgroundColor: theme.isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)'
                        }
                      }, [
                        h('div', { style: { fontSize: '10px', color: theme.textMuted } }, itemData.videoState?.status === 'succeeded' ? '已完成' : '待渲染'),
                        h('button', {
                          type: 'button',
                          disabled: ['submitting', 'polling'].includes(itemData.videoState?.status),
                          onClick: () => handleGenerateVideoItem(item.id),
                          title: `按当前参数生成视频 ${priceBadge}`,
                          style: {
                            backgroundColor: ['submitting', 'polling'].includes(itemData.videoState?.status) ? theme.borderSubtle : '#06b6d4',
                            border: 'none', borderRadius: '5px', color: '#ffffff',
                            fontSize: '11px', fontWeight: 600, padding: '4px 10px',
                            cursor: ['submitting', 'polling'].includes(itemData.videoState?.status) ? 'not-allowed' : 'pointer'
                          }
                        }, ['submitting', 'polling'].includes(itemData.videoState?.status) ? '渲染中...' : (displaySrc ? `重跑视频 ${priceBadge}` : `生成视频 ${priceBadge}`))
                      ])
                    ];
                  })() : [
                    // =================== 文本便签节点 ===================
                    h('textarea', {
                      value: itemData.text || '',
                      onPointerDown: (ev) => ev.stopPropagation(),
                      onChange: (ev) => setCanvasItems(prev => prev.map(x => x.id === item.id ? { ...x, data: { ...x.data, text: ev.target.value } } : x)),
                      placeholder: '输入文本便签内容 (连入下游节点将作为补充提示词)...',
                      style: { flex: 1, resize: 'none', border: 'none', outline: 'none', background: 'transparent', color: theme.textPrimary, fontSize: '12px', padding: '8px 10px', fontFamily: 'inherit', minHeight: 0 }
                    })
                  ])
                ]);
              })),

              // 3.3 分镜格卡片群
              h('div', {
                id: 'winetoken-canvas-panels-area'
              }, panels.map(p => {
                const char = characters.find(c => c.id === p.characterId);
                const isCandidate = Boolean(p.stagingCandidateUrl);
                const displayUrl = p.stagingCandidateUrl || p.imageUrl;
                const isSelected = selectedIds.has(p.id);
                // S3 标签高亮筛选
                const pTags = Array.isArray(p.tags) ? p.tags : [];
                const isPTagMatched = tagFilter === '全部' || pTags.includes(tagFilter);
                const pTagOpacity = isPTagMatched ? 1 : 0.28;
                const pBoxShadow = (tagFilter !== '全部' && isPTagMatched)
                  ? '0 0 0 2px #06b6d4, 0 12px 28px rgba(6, 182, 212, 0.45)'
                  : (isSelected
                    ? '0 0 0 2px rgba(6, 182, 212, 0.45), 0 12px 28px rgba(0, 0, 0, 0.25)'
                    : (isCandidate
                      ? '0 12px 30px rgba(245, 158, 11, 0.25)'
                      : '0 12px 28px rgba(0, 0, 0, 0.25)'));

                // CANVAS-M3 3.4: AABB 视口剔除, 离屏节点不进渲染树
                const isOnScreen = (CanvasMathUtils && CanvasMathUtils.isIntersectingAABB)
                  ? CanvasMathUtils.isIntersectingAABB({ x: p.x, y: p.y, width: p.width || 280, height: p.height || 420 }, viewWorldBox)
                  : true;

                return h('div', {
                  key: p.id,
                  'data-node-id': p.id,
                  'data-node-type': 'panel',
                  style: {
                    position: 'absolute',
                    left: `${p.x}px`,
                    top: `${p.y}px`,
                    width: `${p.width}px`,
                    backgroundColor: theme.bgCard,
                    border: `1px solid ${isCandidate ? '#f59e0b' : (isSelected ? '#06b6d4' : theme.borderSubtle)}`,
                    borderRadius: '10px',
                    boxShadow: pBoxShadow,
                    opacity: pTagOpacity,
                    overflow: 'hidden',
                    display: isOnScreen ? 'flex' : 'none',
                    flexDirection: 'column'
                  }
                }, [
                  // 镜号与景别顶栏 (带自由拖拽手柄与 8px 磁吸对齐 CANVAS-03)
                  h('div', {
                    style: {
                      padding: '8px 12px',
                      borderBottom: `1px solid ${theme.borderSubtle}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      backgroundColor: theme.isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)',
                      cursor: 'grab',
                      userSelect: 'none'
                    },
                    onPointerDown: (e) => beginObjectDrag(e, 'panel', p)
                  }, [
                    h('div', { style: { display: 'flex', alignItems: 'center', gap: '5px' } }, [
                      h('span', { style: { fontSize: '12px', fontWeight: 700, color: theme.textPrimary } }, `#${p.num}`),
                      h('span', {
                        style: {
                          fontSize: '10px',
                          color: '#06b6d4',
                          border: '1px solid rgba(6, 182, 212, 0.3)',
                          padding: '1px 4px',
                          borderRadius: '3px'
                        }
                      }, p.shotLabel),
                      // 动态角色切换下拉菜单 (解耦角色绑定死锁)
                      h('select', {
                        value: p.characterId,
                        onChange: (e) => {
                          const newCharId = e.target.value;
                          setPanels(prev => prev.map(x => x.id === p.id ? { ...x, characterId: newCharId } : x));
                        },
                        title: '切换该分镜所属角色 (实时继承外貌DNA与拓扑连线)',
                        style: {
                          fontSize: '10.5px',
                          color: theme.textPrimary,
                          backgroundColor: theme.isDark ? '#27272a' : '#f4f4f5',
                          border: `1px solid ${theme.borderSubtle}`,
                          padding: '1px 4px',
                          borderRadius: '3px',
                          cursor: 'pointer',
                          outline: 'none',
                          maxWidth: '92px'
                        }
                      }, characters.map(c => h('option', {
                        key: c.id,
                        value: c.id,
                        style: { background: theme.bgSidebar, color: theme.textPrimary }
                      }, c.name)))
                    ]),
                    h('div', { style: { display: 'flex', alignItems: 'center', gap: '5px' } }, [
                      // S3 分镜标签
                      pTags.map(tLabel => {
                        const tDef = (CanvasPromptUtils?.CANVAS_TAGS || []).find(t => t.label === tLabel) || { color: '#06b6d4', bg: 'rgba(6,182,212,0.15)', label: tLabel };
                        return h('span', {
                          key: tLabel,
                          onClick: (ev) => { ev.stopPropagation(); toggleNodeTag(p.id, 'panel', tLabel); },
                          title: '点击移除标签',
                          style: { fontSize: '9px', color: tDef.color, backgroundColor: tDef.bg, border: `1px solid ${tDef.color}`, padding: '1px 4px', borderRadius: '4px', cursor: 'pointer' }
                        }, tLabel);
                      }),
                      h('button', {
                        type: 'button',
                        title: '设置该分镜标签与关键词 (S3)',
                        onPointerDown: (ev) => ev.stopPropagation(),
                        onClick: (ev) => {
                          ev.stopPropagation();
                          setTagPicker(prev => (prev && prev.nodeId === p.id) ? null : { nodeId: p.id, nodeType: 'panel' });
                        },
                        style: { background: 'none', border: `1px solid ${theme.borderSubtle}`, borderRadius: '4px', color: theme.textSecondary, cursor: 'pointer', fontSize: '9px', padding: '1px 3px' }
                      }, '+标签'),
                      // 连线锚点 (拖出连线到目标节点) CANVAS-M2 2.4
                      h('div', {
                        onPointerDown: (ev) => beginConnectDrag(ev, 'panel', p.id),
                        title: '拖出连线到目标节点',
                        style: { width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#10b981', border: '1.5px solid #ffffff', boxShadow: '0 0 5px rgba(16, 185, 129, 0.6)', cursor: 'crosshair', flexShrink: 0 }
                      }),
                      h('button', {
                        type: 'button',
                        title: '删除分镜卡片 (支持 Ctrl+Z 撤销 CANVAS-04)',
                        onClick: () => {
                          if (typeof confirm !== 'undefined' && !confirm(`确定要删除分镜 #${p.num} 及其关联画面吗？此操作可按 Ctrl+Z 撤销。`)) {
                            return;
                          }
                          if (canvasHistoryManager) {
                            canvasHistoryManager.pushState(snapshotState());
                          }
                          setPanels(prev => prev.filter(x => x.id !== p.id));
                          setEdges(prev => prev.filter(x => x.from.id !== p.id && x.to.id !== p.id));
                        },
                        style: { background: 'none', border: 'none', color: theme.textMuted, cursor: 'pointer', fontSize: '11px' }
                      }, '删除')
                    ])
                  ]),

                  // S3 标签快速点选悬浮浮层
                  (tagPicker && tagPicker.nodeId === p.id) ? h('div', {
                    onPointerDown: (ev) => ev.stopPropagation(),
                    onClick: (ev) => ev.stopPropagation(),
                    style: { padding: '8px', borderBottom: `1px solid ${theme.borderSubtle}`, backgroundColor: theme.popoverBg, display: 'flex', flexDirection: 'column', gap: '6px' }
                  }, [
                    h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '4px' } }, (CanvasPromptUtils?.CANVAS_TAGS || []).map(t => {
                      const isTagged = pTags.includes(t.label);
                      return h('button', {
                        key: t.id,
                        type: 'button',
                        onClick: () => toggleNodeTag(p.id, 'panel', t.label),
                        style: { border: `1px solid ${t.color}`, backgroundColor: isTagged ? t.color : t.bg, color: isTagged ? '#ffffff' : t.color, fontSize: '9.5px', padding: '2px 5px', borderRadius: '4px', cursor: 'pointer' }
                      }, t.label);
                    })),
                    h('input', {
                      placeholder: '输入关键词按回车添加...',
                      onKeyDown: (ev) => {
                        if (ev.key === 'Enter') {
                          ev.stopPropagation();
                          addCustomKeyword(p.id, 'panel', ev.target.value);
                          ev.target.value = '';
                        }
                      },
                      style: { fontSize: '10px', padding: '3px 6px', border: `1px solid ${theme.borderSubtle}`, borderRadius: '4px', backgroundColor: theme.bgInput, color: theme.textPrimary, outline: 'none' }
                    })
                  ]) : null,

                  // 画面展示区 (支持 InvokeAI 幽灵暂存层 + 亚像素高清渲染)
                  h('div', {
                    onPointerDown: (e) => {
                      // 点击画面区选中该分镜; Shift+点击加选/减选 (控件按钮除外) CANVAS-M1 1.4
                      if (e.target.tagName === 'BUTTON' || e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;
                      e.stopPropagation();
                      if (connectMode) {
                        handleConnectNodeClick('panel', p.id);
                        return;
                      }
                      if (e.shiftKey) {
                        toggleSelectId(p.id);
                        return;
                      }
                      if (!selectedIds.has(p.id) || selectedIds.size !== 1) {
                        setSelectedIds(new Set([p.id]));
                      }
                    },
                    style: {
                      width: '100%',
                      height: `${p.height}px`,
                      backgroundColor: theme.isDark ? '#0f1219' : '#f1f5f9',
                      position: 'relative',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      overflow: 'hidden'
                    }
                  }, [
                    displayUrl
                      ? h('img', {
                          src: displayUrl,
                          title: '双击查看 100% 原始高清大图 (无损点对点细节)',
                          onDoubleClick: () => setLightboxUrl(displayUrl),
                          style: {
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                            filter: isCandidate ? 'brightness(0.95)' : 'none',
                            imageRendering: '-webkit-optimize-contrast',
                            cursor: 'zoom-in'
                          }
                        })
                      : h('div', {
                          style: {
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: '6px',
                            color: theme.textMuted,
                            fontSize: '11.5px',
                            padding: '20px',
                            textAlign: 'center'
                          }
                        }, [
                          h(Icon, { name: p.isGenerating ? 'spinner' : 'image', size: 24, style: p.isGenerating ? { animation: 'spin 1s linear infinite' } : {} }),
                          h('span', {}, p.isGenerating ? '正在 4K 极速直出...' : '等待绘制')
                        ]),

                    // 幽灵暂存候选浮层
                    isCandidate && h('div', {
                      style: {
                        position: 'absolute',
                        bottom: '10px',
                        left: '10px',
                        right: '10px',
                        padding: '6px 10px',
                        borderRadius: '6px',
                        backgroundColor: 'rgba(17, 24, 39, 0.92)',
                        backdropFilter: 'blur(8px)',
                        border: '1px solid rgba(245, 158, 11, 0.4)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between'
                      }
                    }, [
                      h('span', { style: { fontSize: '11px', color: '#f59e0b', fontWeight: 600 } }, '候选成果'),
                      h('div', { style: { display: 'flex', gap: '6px' } }, [
                        h('button', {
                          type: 'button',
                          onClick: () => handleDiscardStaging(p.id),
                          style: {
                            padding: '3px 8px',
                            fontSize: '11px',
                            borderRadius: '4px',
                            border: '1px solid #4b5563',
                            backgroundColor: 'transparent',
                            color: '#9ca3af',
                            cursor: 'pointer'
                          }
                        }, '放弃'),
                        h('button', {
                          type: 'button',
                          onClick: () => handleAcceptStaging(p.id),
                          style: {
                            padding: '3px 8px',
                            fontSize: '11px',
                            borderRadius: '4px',
                            border: 'none',
                            backgroundColor: '#22c55e',
                            color: '#ffffff',
                            fontWeight: 600,
                            cursor: 'pointer'
                          }
                        }, '保留')
                      ])
                    ])
                  ]),

                  // 分镜提示词与台词输入区
                  h('div', {
                    style: { padding: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }
                  }, [
                    h('input', {
                      value: p.prompt,
                      onChange: (e) => {
                        const val = e.target.value;
                        setPanels(prev => prev.map(x => x.id === p.id ? { ...x, prompt: val } : x));
                      },
                      placeholder: '画面场景与镜头语言描述...',
                      style: {
                        width: '100%',
                        boxSizing: 'border-box',
                        padding: '5px 8px',
                        fontSize: '11px',
                        borderRadius: '4px',
                        backgroundColor: theme.isDark ? '#141720' : '#ffffff',
                        border: `1px solid ${theme.borderSubtle}`,
                        color: theme.textPrimary
                      }
                    }),

                    h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } }, [
                      h(Icon, { name: 'messageSquare', size: 12 }),
                      h('input', {
                        value: p.dialogue,
                        onChange: (e) => {
                          const val = e.target.value;
                          setPanels(prev => prev.map(x => x.id === p.id ? { ...x, dialogue: val } : x));
                        },
                        placeholder: '角色对白台词 (自动生成对白气泡)...',
                        style: {
                          flex: 1,
                          boxSizing: 'border-box',
                          padding: '4px 6px',
                          fontSize: '11px',
                          borderRadius: '4px',
                          backgroundColor: theme.isDark ? '#141720' : '#ffffff',
                          border: `1px solid ${theme.borderSubtle}`,
                          color: theme.textPrimary
                        }
                      })
                    ]),

                    h('button', {
                      type: 'button',
                      disabled: p.isGenerating,
                      onClick: () => handleGeneratePanel(p.id),
                      style: {
                        padding: '6px 10px',
                        borderRadius: '5px',
                        border: 'none',
                        backgroundColor: p.isGenerating ? '#4b5563' : theme.btnPrimaryBg,
                        color: theme.btnPrimaryText,
                        fontSize: '11.5px',
                        fontWeight: 600,
                        cursor: p.isGenerating ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px'
                      }
                    }, [
                      h(Icon, { name: p.isGenerating ? 'spinner' : 'sparkles', size: 12, style: p.isGenerating ? { animation: 'spin 1s linear infinite' } : {} }),
                      h('span', {}, p.isGenerating ? '正在全力绘制...' : (p.imageUrl ? '重新绘制' : '立即绘制分镜'))
                    ])
                  ])
                ]);
              }))
            ]),

            // 4. 全屏高清无损原图灯箱 (Lightbox - 消除缩放插值模糊，点对点呈现 4K/原图细节)
            lightboxUrl && h('div', {
              style: {
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'rgba(0, 0, 0, 0.9)',
                backdropFilter: 'blur(12px)',
                zIndex: 9999999,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '24px',
                boxSizing: 'border-box',
                cursor: 'zoom-out'
              },
              onClick: () => setLightboxUrl(null)
            }, [
              h('div', {
                style: {
                  position: 'absolute',
                  top: '16px',
                  right: '24px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  zIndex: 2
                },
                onClick: (e) => e.stopPropagation()
              }, [
                h('span', { style: { color: 'rgba(255, 255, 255, 0.7)', fontSize: '12px' } }, '1:1 点对点高清原图 (单击任意空白处关闭)'),
                h('button', {
                  type: 'button',
                  onClick: () => setLightboxUrl(null),
                  style: {
                    background: 'rgba(255, 255, 255, 0.12)',
                    border: '1px solid rgba(255, 255, 255, 0.25)',
                    color: '#ffffff',
                    borderRadius: '6px',
                    padding: '5px 12px',
                    fontSize: '12px',
                    cursor: 'pointer',
                    fontWeight: '500'
                  }
                }, '关闭预览')
              ]),
              h('img', {
                src: lightboxUrl,
                style: {
                  maxWidth: '92vw',
                  maxHeight: '88vh',
                  objectFit: 'contain',
                  borderRadius: '8px',
                  boxShadow: '0 24px 70px rgba(0, 0, 0, 0.85)',
                  imageRendering: '-webkit-optimize-contrast'
                },
                onClick: (e) => e.stopPropagation()
              })
            ])
          ]);
        }

        const CanvasWorkspace = LegacyCanvasWorkspace;

        // ==========================================
        // 5.1 React Flow 漫剧画布工作台挂接 (v2.5.1)
        // ==========================================
        let createReactFlowWorkspace = null;
        let initXyFlow = null;
        try {
          const rfMod = require('./canvas-reactflow.js');
          if (rfMod && typeof rfMod.createReactFlowWorkspace === 'function') {
            createReactFlowWorkspace = rfMod.createReactFlowWorkspace;
          }
        } catch (_) {}
        try {
          initXyFlow = require('./vendor/xyflow.factory.cjs');
        } catch (_) {}

        let ReactFlowWorkspace = null;
        if (typeof createReactFlowWorkspace === 'function' && typeof initXyFlow === 'function') {
          try {
            const built = createReactFlowWorkspace({
              React,
              ReactDOM: (typeof window !== 'undefined' ? window.ReactDOM : null),
              initXyFlow,
              canvasProjectStore,
              canvasStorageDriver,
              canvasHistoryManager,
              canvasAssetsDriver,
              assetLibraryStore,
              CanvasPricingUtils,
              CanvasNodeUtils,
              CanvasPromptUtils,
              CanvasVideoUtils,
              CanvasExportUtils
            });
            if (typeof built === 'function') {
              ReactFlowWorkspace = built;
            }
          } catch (_) {}
        }

        // ==========================================
        // 6. 创作工坊主工作台 (StudioPage)
        // ==========================================
        function StudioPage() {
          const theme = useTheme();
          const [mode, setMode] = React.useState('image'); // 'image' | 'video' | 'canvas'
          const [showTutorial, setShowTutorial] = React.useState(false);
          // 初始模型从 manifest 可用清单动态取首个，避免写死已下架 ID 造成首帧闪错
          const [selectedImageModel, setSelectedImageModel] = React.useState(() => (WineTokenManifestManager.getImageModels()[0] || {}).id || 'sensenova-u1.5-lite');
          const [selectedVideoModel, setSelectedVideoModel] = React.useState(() => (WineTokenManifestManager.getVideoModels()[0] || {}).id || 'grok-imagine-video-1.5');
          const selectedModel = mode === 'image' ? selectedImageModel : selectedVideoModel;
          const setSelectedModel = (mId) => {
            if (mode === 'image') setSelectedImageModel(mId);
            else if (mode === 'video') setSelectedVideoModel(mId);
          };
          const [prompt, setPrompt] = React.useState('');
          const [size, setSize] = React.useState('1024x1024');
          const [count, setCount] = React.useState(1);
          const [duration, setDuration] = React.useState(5); // 视频生成时长 (秒数)
          // 多参考图槽位架构 (支持 1~5 张，每个拥有唯一编号、别名与拖拽代号)
          const [referenceSlots, setReferenceSlots] = React.useState([]); // [ { id, index, name, dataUrl, size } ]
          const [editingSlotId, setEditingSlotId] = React.useState(null);
          const [editingSlotName, setEditingSlotName] = React.useState('');
          const promptRef = React.useRef(null);
          const [isGenerating, setIsGenerating] = React.useState(false);
          const [statusMsg, setStatusMsg] = React.useState('');
          const [resultImages, setResultImages] = React.useState([]);
          const [activeImage, setActiveImage] = React.useState(null);
          const [copyFeedback, setCopyFeedback] = React.useState(false);
          const [showStudioPopover, setShowStudioPopover] = React.useState(false);
          const [savingId, setSavingId] = React.useState(null);
          const [fileToast, setFileToast] = React.useState('');
          const fileInputRef = React.useRef(null);
          // 首帧独立槽位 (视频模式专用：语义在 UI 层定死，模型按显式字段识别开场画面，不再猜图)
          // 尾帧已下线 (2026-11-25 站长决定)：上游中转接口不支持 last_frame，工坊不再提供尾帧。
          const [firstFrame, setFirstFrame] = React.useState(null);  // { id, name, dataUrl, size }
          const firstFrameInputRef = React.useRef(null);

          const [history, setHistory] = React.useState(() => {
            let localList = [];
            try {
              const saved = localStorage.getItem('WINETOKEN_STUDIO_HISTORY');
              if (saved) localList = JSON.parse(saved);
            } catch (_) {}

            // 双向持久化：同步读取 ~/.dsh/storages/winetoken_studio_history.json
            try {
              const fs = require('fs');
              const path = require('path');
              const os = require('os');
              const file = path.join(os.homedir(), '.dsh', 'storages', 'winetoken_studio_history.json');
              if (fs.existsSync(file)) {
                const diskList = JSON.parse(fs.readFileSync(file, 'utf8'));
                if (Array.isArray(diskList) && diskList.length > 0) {
                  const map = new Map();
                  diskList.forEach(item => map.set(item.id || item.url, item));
                  localList.forEach(item => map.set(item.id || item.url, item));
                  return Array.from(map.values()).sort((a, b) => ((b.createdAt || 0) - (a.createdAt || 0))).slice(0, 60);
                }
              }
            } catch (_) {}

            return localList;
          });

          // 监听余额与会员身份变化
          const [billing, setBilling] = React.useState({ ...billingState });
          React.useEffect(() => {
            const listener = (b) => setBilling(b);
            listeners.add(listener);
            return () => listeners.delete(listener);
          }, []);

          // 判断用户当前是否拥有 VIP / SVIP / SUPER 会员特权 (SUPER/SVIP 8折，VIP 9折，100% 对齐数据库 GroupRatio)
          const isSuper = Boolean(billing.isSuper || billing.userGroup === 'super' || billing.subGroup === 'super');
          const isVip = Boolean(billing.hasSubscription) || isSuper;
          const isSvip = isSuper || (isVip && (billing.subGroup === 'svip' || !billing.subGroup)); // Super 和 SVIP 享受同等 8 折特惠
          const discountRatio = (isSuper || isSvip) ? 0.8 : (billing.subGroup === 'vip' ? 0.9 : 1.0);

          // 价格解析引擎：根据用户是否有 VIP/SVIP 动态输出对应真实价格
          const getModelEffectivePrice = (m) => {
            if (!m || m.price == null) return null;
            if (m.price === 0) return 0;
            if (!isVip) return m.price;
            if (m.vipPrice != null && isSvip) return m.vipPrice;
            return Number((m.price * discountRatio).toFixed(3));
          };

          // 生图与视频模型列表 (优先消费 WineTokenManifestManager 动态数据，断网时使用本地持久化缓存与静态兜底)
          const [manifestSnapshot, setManifestSnapshot] = React.useState(() => WineTokenManifestManager.getSnapshot());
          React.useEffect(() => {
            const unsub = WineTokenManifestManager.subscribe(next => setManifestSnapshot(next));
            return unsub;
          }, []);

          const IMAGE_MODELS = manifestSnapshot.imageModels;
          const VIDEO_MODELS = manifestSnapshot.videoModels;

          try {
            window.IMAGE_MODELS = IMAGE_MODELS;
            window.VIDEO_MODELS = VIDEO_MODELS;
          } catch (_) {}

          // 当前模型与可用分辨率/时长联动
          const currentModels = mode === 'image' ? IMAGE_MODELS : VIDEO_MODELS;
          const currentModelObj = currentModels.find(m => m.id === selectedModel) || currentModels[0];
          const availableResolutions = currentModelObj.resolutions || [];
          const availableDurations = currentModelObj.durations || [{ val: 5, label: '5 秒' }];

          // 当可用模型列表变化或模式切换时，自动纠偏当前选中的模型
          React.useEffect(() => {
            if (currentModels && currentModels.length > 0) {
              const exists = currentModels.some(m => m.id === selectedModel);
              if (!exists) {
                setSelectedModel(currentModels[0].id);
              }
            }
          }, [currentModels, selectedModel]);

          // 当切换模型或模式时，自动确保选中的分辨率在当前模型支持列表内
          React.useEffect(() => {
            if (availableResolutions.length > 0 && !availableResolutions.some(r => r.val === size)) {
              setSize(availableResolutions[0].val);
            }
          }, [selectedModel, mode]);

          // 当切换视频模型时，自动确保选中的时长在当前模型支持列表内
          React.useEffect(() => {
            if (mode === 'video' && availableDurations.length > 0 && !availableDurations.some(d => d.val === duration)) {
              setDuration(availableDurations[0].val);
            }
          }, [selectedModel, mode]);

          // 灵感快捷预设标签
          const INSPIRATION_CHIPS = [
            { label: '8K摄影写实', text: '，8K摄影画质，超精细微距特写，真实自然光照，虚化背景，哈苏中画幅质感' },
            { label: '未来赛博朋克', text: '，赛博朋克风格，雨夜潮湿街道，霓虹灯光晕，全息投影与机械细节' },
            { label: '电影质感光影', text: '，35mm电影胶片质感，丁达尔光线，颗粒感，冷暖对比色调，情绪故事氛围' },
            { label: '二次元动漫', text: '，新海诚画风，唯美动漫插画，梦幻天空云朵，细腻光影轮廓，纯净唯美' },
            { label: '3D粘土微缩', text: '，3D微缩粘土风格，移轴摄影，圆润童趣，温暖柔和棚拍布光' }
          ];

          // 动态单次预估花费 (跟是否有 VIP / SVIP 强绑定)
          const currentImgModel = IMAGE_MODELS.find(m => m.id === selectedModel) || IMAGE_MODELS[0];
          const effectiveSinglePrice = getModelEffectivePrice(currentModelObj);
          const effectiveSecPrice = isVip
            ? (isSvip && currentModelObj.vipPricePerSecond != null
                ? currentModelObj.vipPricePerSecond
                : Number(((currentModelObj.pricePerSecond || 0.15) * discountRatio).toFixed(3)))
            : (currentModelObj.pricePerSecond || 0.15);
          const currentUnit = currentModelObj.unit || (mode === 'image' ? '张' : '秒');
          const estCost = mode === 'image'
            ? ((effectiveSinglePrice || 0) * count)
            : (effectiveSecPrice * duration);

          // 添加文件到参考图槽位 (支持多张，最大 5 张)
          const addFilesToSlots = (files, callback) => {
            if (!files || files.length === 0) return;
            const validFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
            if (validFiles.length === 0) {
              alert('请选择有效的图片文件 (PNG, JPG, WebP)');
              return;
            }
            const currentLen = referenceSlots.length;
            if (currentLen >= 5) {
              alert('最多支持添加 5 张参考图');
              return;
            }
            const allowedCount = 5 - currentLen;
            const toProcess = validFiles.slice(0, allowedCount);

            toProcess.forEach((file, i) => {
              if (file.size > 15 * 1024 * 1024) {
                alert(`图片 ${file.name} 超过 15MB，已跳过`);
                return;
              }
              const reader = new FileReader();
              reader.onload = (ev) => {
                const cleanName = file.name.replace(/\.[^/.]+$/, '').slice(0, 10) || `图${currentLen + i + 1}`;
                const newSlot = {
                  id: 'slot_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                  index: currentLen + i + 1,
                  name: cleanName,
                  dataUrl: ev.target.result,
                  size: (file.size / 1024).toFixed(1) + ' KB'
                };
                setReferenceSlots(prev => {
                  const next = [...prev, newSlot].slice(0, 5);
                  return next.map((s, idx) => ({ ...s, index: idx + 1 }));
                });
                if (callback) callback(newSlot);
              };
              reader.readAsDataURL(file);
            });
          };

          // 文件选择事件处理
          const handleFileChange = (e) => {
            addFilesToSlots(e.target.files);
            if (e.target) e.target.value = '';
          };

          // 视频首帧 / 尾帧专用装载器 (单槽位，重复上传直接覆盖，杜绝多图歧义)
          const loadImageFileToFrame = (file, setter) => {
            if (!file) return;
            if (!file.type || !file.type.startsWith('image/')) {
              alert('请选择有效的图片文件 (PNG, JPG, WebP)');
              return;
            }
            if (file.size > 15 * 1024 * 1024) {
              alert(`图片 ${file.name} 超过 15MB，已跳过`);
              return;
            }
            const reader = new FileReader();
            reader.onload = (ev) => {
              setter({
                id: 'frame_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                name: file.name.replace(/\.[^/.]+$/, '').slice(0, 10) || '画面帧',
                dataUrl: ev.target.result,
                size: (file.size / 1024).toFixed(1) + ' KB'
              });
            };
            reader.readAsDataURL(file);
          };

          const handleFirstFrameChange = (e) => {
            loadImageFileToFrame(e.target.files && e.target.files[0], setFirstFrame);
            if (e.target) e.target.value = '';
          };

          // 模式切换时的首尾帧与多参考图槽位双向迁移 (旧创作素材无缝升级，不丢图)
          const frameMigrationRef = React.useRef(mode);
          React.useEffect(() => {
            if (frameMigrationRef.current === mode) return;
            const prevMode = frameMigrationRef.current;
            frameMigrationRef.current = mode;
            if (prevMode === 'image' && mode === 'video') {
              setFirstFrame(prev => prev || (referenceSlots[0] ? {
                id: 'frame_' + Date.now() + '_f',
                name: referenceSlots[0].name,
                dataUrl: referenceSlots[0].dataUrl,
                size: referenceSlots[0].size
              } : null));
            } else if (prevMode === 'video' && mode === 'image') {
              setReferenceSlots(prev => {
                if (prev.length > 0) return prev;
                return [firstFrame].filter(Boolean).map((f, i) => ({ ...f, index: i + 1 }));
              });
            }
          }, [mode]);

          // 视频画面帧槽位卡片 (首帧 / 尾帧共用渲染：独立上传、独立删除、语义固定)
          const renderFrameCard = (title, frame, setter, inputRef, emptyText, accentColor, hint) => h('div', {
            key: title,
            onDragOver: (e) => { e.preventDefault(); e.stopPropagation(); },
            onDrop: (e) => {
              e.preventDefault();
              e.stopPropagation();
              if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
                loadImageFileToFrame(e.dataTransfer.files[0], setter);
              }
            },
            style: {
              flex: 1,
              minWidth: 0,
              background: theme.bgInput,
              border: `1px solid ${frame ? theme.borderStrong : theme.borderSubtle}`,
              borderLeft: `3px solid ${accentColor}`,
              borderRadius: '7px',
              padding: '8px',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              transition: 'all 0.15s ease'
            }
          }, [
            h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } }, [
              h('span', { style: { fontSize: '11.5px', fontWeight: '600', color: accentColor } }, title),
              frame ? h('button', {
                type: 'button',
                title: '移除该画面帧',
                onClick: () => setter(null),
                style: {
                  background: 'transparent', border: 'none', color: theme.textMuted,
                  cursor: 'pointer', padding: '2px', borderRadius: '4px', display: 'flex'
                },
                onMouseEnter: (e) => { e.currentTarget.style.color = '#ef4444'; },
                onMouseLeave: (e) => { e.currentTarget.style.color = theme.textMuted; }
              }, h(Icon, { name: 'close', size: 12 })) : h('span', { style: { fontSize: '10px', color: theme.textMuted } }, '未设置')
            ]),
            frame ? h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, [
              h('img', {
                src: frame.dataUrl,
                alt: frame.name,
                style: {
                  width: '44px', height: '44px', objectFit: 'cover', borderRadius: '5px',
                  border: `1px solid ${theme.borderSubtle}`, display: 'block', flexShrink: 0
                }
              }),
              h('div', { style: { flex: 1, minWidth: 0 } }, [
                h('div', { style: { fontSize: '11px', color: theme.textSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, frame.name),
                h('div', { style: { fontSize: '10px', color: theme.textMuted, marginTop: '1px' } }, frame.size)
              ]),
              h('button', {
                type: 'button',
                title: '更换该画面帧',
                onClick: () => inputRef.current && inputRef.current.click(),
                style: {
                  padding: '3px 7px', borderRadius: '4px', background: theme.chipNormalBg,
                  border: `1px solid ${theme.borderSubtle}`, color: theme.textSecondary,
                  fontSize: '10.5px', cursor: 'pointer', flexShrink: 0
                }
              }, '更换')
            ]) : h('div', {
              onClick: () => inputRef.current && inputRef.current.click(),
              style: {
                border: `1px dashed ${theme.borderStrong}`,
                borderRadius: '5px',
                padding: '10px 8px',
                textAlign: 'center',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '3px',
                transition: 'all 0.15s ease'
              },
              onMouseEnter: (e) => { e.currentTarget.style.borderColor = theme.textPrimary; },
              onMouseLeave: (e) => { e.currentTarget.style.borderColor = theme.borderStrong; }
            }, [
              h(Icon, { name: 'upload', size: 13, style: { color: theme.textSecondary } }),
              h('span', { style: { fontSize: '10px', color: theme.textMuted } }, emptyText)
            ]),
            h('div', { style: { fontSize: '10px', color: theme.textMuted, lineHeight: '1.4' } }, hint)
          ]);

          // 拖拽上传到参考图栏
          const handleDropFile = (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (e.dataTransfer?.files) {
              addFilesToSlots(e.dataTransfer.files);
            }
          };

          // 提示词光标位置插入代号药丸标签
          const insertTokenAtCursor = (tokenText) => {
            const textarea = promptRef.current;
            if (!textarea) {
              setPrompt(p => p.trim() ? p.trim() + ' ' + tokenText : tokenText);
              return;
            }
            let pos = textarea.selectionStart;
            if (pos == null || pos === textarea.value.length) {
              pos = textarea.value.length;
            }
            const before = textarea.value.slice(0, pos);
            const after = textarea.value.slice(pos);
            const nextVal = before + tokenText + after;
            setPrompt(nextVal);
            setTimeout(() => {
              textarea.focus();
              const nextPos = pos + tokenText.length;
              textarea.setSelectionRange(nextPos, nextPos);
            }, 20);
          };

          // 多图提示词语义解耦编译器
          const compilePromptWithSlots = (rawPrompt, slots) => {
            const trimmed = rawPrompt.trim();
            if (!trimmed) return 'High quality photographic generation';
            if (!slots || slots.length === 0) return trimmed;

            // 检查是否包含 @[图1:别名] 或 @[图1] 代号
            const hasTag = /@\[图(\d+)(?::([^\]]+))?\]/.test(trimmed);
            if (hasTag) {
              const slotAnchors = slots.map(s => `[Ref ${s.index}: ${s.name}]`).join(', ');
              return `${trimmed} (Semantic Multi-Subject Disentanglement: strictly preserve distinct visual traits, identities and environment attributes according to assigned references ${slotAnchors} without attribute bleeding or character blending.)`;
            }
            return trimmed;
          };

          // 发起生图 / 生视频请求 (彻底根除 invalid n 并支持并发自动分批发包)
          // Grok Imagine 协议适配：xAI 生图原生协议没有 size 参数（用固定档 aspect_ratio），
          // 视频 resolution 仅接受 480p/720p/1080p —— 非法参数会被上游以 400 拒绝
          const handleGenerate = async () => {
            const hasVideoFrame = Boolean(firstFrame && firstFrame.dataUrl);
            if (!prompt.trim() && referenceSlots.length === 0 && (mode !== 'video' || !hasVideoFrame)) {
              alert('请输入画面描述提示词 (Prompt)，或上传参考图片');
              return;
            }
            const key = getKey();
            if (!key) {
              alert('未检测到 API Key，请在上方或下方状态栏中配置');
              return;
            }

            // 垫图改图模型支持性前置拦截: 当前仅 sensenova 与 gpt-image 支持 edits
            if (mode === 'image' && referenceSlots.length > 0) {
              const check = validateImageModelSupport(selectedModel, true);
              if (!check.supported) {
                alert(check.error);
                return;
              }
            }

            setIsGenerating(true);
            const actionName = mode === 'image'
              ? (referenceSlots.length > 0 ? '多参考图垫图绘制' : '画面绘制')
              : (hasVideoFrame
                  ? '首帧图生视频渲染'
                  : '视频生成');
            setStatusMsg(`AI 正在进行${actionName}，请稍候...`);

            try {
              if (mode === 'image') {
                const finalPrompt = compilePromptWithSlots(prompt, referenceSlots);
                const singleNOnly = Boolean(currentImgModel.singleNOnly);

                const requestSingleBatch = async (nVal) => {
                  return await sendImageRequest({
                    baseUrl: BASE_URL,
                    apiKey: key,
                    model: selectedModel,
                    prompt: finalPrompt,
                    size: size,
                    n: nVal,
                    referenceSlots: referenceSlots
                  });
                };

                // 前置可用额度与余额校验，杜绝透支双花 (BILLING-03)
                const totalEstCost = estCost * count;
                const currentWallet = billingState?.walletCNY || 0;
                const currentSubRemain = Math.max(0, (billingState?.subTotalCNY || 0) - (billingState?.subUsedCNY || 0));
                const totalAvailable = currentWallet + currentSubRemain;
                if (totalAvailable < totalEstCost && totalAvailable > 0) {
                  throw new Error(`账户总可用额度 (¥${formatCNY(totalAvailable)}) 不足以支付本次渲染预估消耗 (¥${formatCNY(totalEstCost)})，已为您中止发包。`);
                }

                let generatedData = [];
                if (count > 1) {
                  // 所有生图模型在选多张时，采用受控并发 (Limit=2)，彻底杜绝上游 API "invalid n" 与并发击穿
                  setStatusMsg(`AI 正在按序并发绘制第 1~${count} 张画面，请稍候...`);
                  const results = [];
                  for (let i = 0; i < count; i += 2) {
                    const batchSize = Math.min(2, count - i);
                    const batchTasks = Array.from({ length: batchSize }, () => requestSingleBatch(1));
                    const batchRes = await Promise.all(batchTasks);
                    results.push(...batchRes);
                  }
                  for (const r of results) {
                    if (r && r.data && Array.isArray(r.data)) generatedData.push(...r.data);
                  }
                } else {
                  const singleResp = await requestSingleBatch(1);
                  if (singleResp && singleResp.data && Array.isArray(singleResp.data)) {
                    generatedData = singleResp.data;
                  }
                }

                if (generatedData.length > 0) {
                  const newItems = generatedData.map(d => createStudioHistoryItem({
                    url: d.url || (d.b64_json ? 'data:image/png;base64,' + d.b64_json : ''),
                    prompt: prompt.trim(),
                    model: selectedModel,
                    size: size,
                    hasRef: referenceSlots.length > 0,
                    type: 'image'
                  })).filter(x => !!x.url);

                  setResultImages(newItems);
                  if (newItems.length > 0) setActiveImage(newItems[0]);

                  const nextHist = [...newItems, ...history].slice(0, 40);
                  setHistory(nextHist);
                  try {
                    localStorage.setItem('WINETOKEN_STUDIO_HISTORY', JSON.stringify(nextHist));
                    const fs = require('fs');
                    const path = require('path');
                    const os = require('os');
                    const file = path.join(os.homedir(), '.dsh', 'storages', 'winetoken_studio_history.json');
                    fs.writeFileSync(file, JSON.stringify(nextHist, null, 2), 'utf8');
                  } catch (_) {}

                  updateBilling();
                }
              } else {
                // 真实视频网络调用与长轮询 (彻底终结假存根 BILLING-01, BILLING-05)
                setStatusMsg(`AI 正在向云端提交视频渲染任务 (${selectedModel}, ${duration}秒)...`);
                // Grok Imagine 视频族：xAI 仅接受 480p/720p/1080p，768P 会被上游 400 拒绝
                const isGrokVideo = /grok-imagine-video/i.test(selectedModel || '');
                let resolution;
                if (/minimax-h3-2k/i.test(selectedModel || '')) {
                  resolution = '2K';
                } else if (/minimax/i.test(selectedModel || '')) {
                  resolution = '768P';
                } else if (isGrokVideo) {
                  resolution = (size && size.includes('1080')) ? '1080P' : '720P';
                } else if (/^muse-video$/i.test(selectedModel || '')) {
                  resolution = '720P';
                } else {
                  resolution = (size && (size.includes('2K') || size.startsWith('2560') || size.startsWith('1440')))
                    ? '2K'
                    : ((size && size.includes('1080')) ? '1080P' : '768P');
                }
                const videoPayload = {
                  model: selectedModel || 'MiniMax-H3',
                  prompt: prompt.trim(),
                  seconds: duration || 5,
                  duration: duration || 5,
                  resolution
                };
                if (/^muse-video$/i.test(videoPayload.model)) {
                  // Muse 走 sora 协议: seconds 必须字符串, 画幅靠 size 表达
                  videoPayload.seconds = String(duration || 5);
                  videoPayload.size = size || '1280x720';
                }
                // 首帧独立槽位：按模型族选择上行字段，交给 New-API 内置插件显式映射帧角色
                // (hailuo → metadata.first_frame_image；xai → image)。尾帧已下线，绝不下发 last_frame。
                const frameFirstUrl = firstFrame && firstFrame.dataUrl ? firstFrame.dataUrl : '';
                if (/minimax|hailuo/i.test(videoPayload.model)) {
                  if (frameFirstUrl) {
                    videoPayload.image = frameFirstUrl;
                    videoPayload.metadata = { first_frame_image: frameFirstUrl };
                  }
                } else {
                  if (frameFirstUrl) {
                    videoPayload.image = frameFirstUrl;
                    videoPayload.image_url = frameFirstUrl;
                  }
                }

                const endpoints = CanvasVideoUtils
                  ? CanvasVideoUtils.resolveVideoEndpoints(BASE_URL, videoPayload.model)
                  : (() => {
                      const clean = (BASE_URL || '').trim().replace(/\/+$/, '');
                      const v1 = clean.endsWith('/v1') ? clean : `${clean}/v1`;
                      const isMiniMax = /minimax|hailuo/i.test(videoPayload.model || '') || /^muse-video$/i.test(videoPayload.model || '');
                      return isMiniMax ? {
                        submitUrl: `${v1}/videos`,
                        pollUrl: (id) => `${v1}/videos/${id}`,
                        contentUrl: (id) => `${v1}/videos/${id}/content`
                      } : {
                        submitUrl: `${v1}/videos/generations`,
                        pollUrl: (id) => `${v1}/videos/generations/${id}`,
                        contentUrl: (id) => `${v1}/videos/generations/${id}`
                      };
                    })();
                const submitUrl = endpoints.submitUrl;
                const submitRes = await fetch(submitUrl, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${key}`
                  },
                  body: JSON.stringify(videoPayload)
                });

                if (!submitRes.ok) {
                  const errText = await submitRes.text().catch(() => '');
                  let msg = `HTTP ${submitRes.status}`;
                  try {
                    const parsed = JSON.parse(errText);
                    msg = parsed.error?.message || msg;
                  } catch (_) {
                    if (errText) msg = errText.slice(0, 100);
                  }
                  throw new Error(`创建视频任务失败: ${msg}`);
                }

                const submitData = await submitRes.json();
                let finalVideoUrl = submitData.url || (submitData.data && submitData.data[0] && submitData.data[0].url);

                if (!finalVideoUrl) {
                  const taskId = submitData.task_id || submitData.id || (submitData.data && submitData.data.id);
                  if (!taskId) throw new Error('视频接口未返回任务 ID 或直接视频链接');

                  const pollUrl = endpoints.pollUrl(taskId);
                  const maxAttempts = 100;
                  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                    setStatusMsg(`视频正在加速渲染中 (${attempt * 3}秒 / 最长300秒)...`);
                    await new Promise(r => setTimeout(r, 3000));

                    try {
                      const pollRes = await fetch(pollUrl, {
                        headers: { 'Authorization': `Bearer ${key}` }
                      });
                      if (!pollRes.ok) continue;
                      const pollData = await pollRes.json();
                      const status = (pollData.status || pollData.state || '').toLowerCase();
                      if (status === 'succeeded' || status === 'success' || status === 'completed') {
                        finalVideoUrl = pollData.url || (pollData.data && pollData.data[0] && pollData.data[0].url) || (pollData.output && pollData.output.url);
                        if (!finalVideoUrl && endpoints.contentUrl) {
                          // 站点轮询响应不回传成片 URL: 带鉴权到内容端点取流, 转 data URL 供内嵌播放与历史保存
                          const contentRes = await fetch(endpoints.contentUrl(taskId), {
                            headers: { 'Authorization': `Bearer ${key}` }
                          });
                          if (contentRes.ok) {
                            const blob = await contentRes.blob();
                            finalVideoUrl = await new Promise((resolve, reject) => {
                              const reader = new FileReader();
                              reader.onload = () => resolve(reader.result);
                              reader.onerror = () => reject(new Error('视频读取失败'));
                              reader.readAsDataURL(blob);
                            });
                          }
                        }
                        if (finalVideoUrl) break;
                      }
                      if (status === 'failed' || status === 'error') {
                        throw new Error(pollData.error?.message || pollData.message || '视频渲染失败');
                      }
                    } catch (pollErr) {
                      if (pollErr.message && pollErr.message.includes('视频渲染失败')) throw pollErr;
                    }
                  }
                }

                if (!finalVideoUrl) {
                  throw new Error('视频生成已提交但轮询超时，稍后可在创作工坊历史中核对');
                }

                const videoItem = createStudioHistoryItem({
                  url: finalVideoUrl,
                  prompt: prompt.trim(),
                  model: selectedModel,
                  size: size,
                  duration: duration,
                  type: 'video'
                });

                setResultImages([videoItem]);
                setActiveImage(videoItem);

                const nextHist = [videoItem, ...history].slice(0, 40);
                setHistory(nextHist);
                try {
                  localStorage.setItem('WINETOKEN_STUDIO_HISTORY', JSON.stringify(nextHist));
                  const fs = require('fs');
                  const path = require('path');
                  const os = require('os');
                  const file = path.join(os.homedir(), '.dsh', 'storages', 'winetoken_studio_history.json');
                  fs.writeFileSync(file, JSON.stringify(nextHist, null, 2), 'utf8');
                } catch (_) {}

                updateBilling();
              }
            } catch (e) {
              alert('生成失败: ' + e.message);
            } finally {
              setIsGenerating(false);
              setStatusMsg('');
            }
          };

          // 以系统原生默认应用直接打开本地媒体文件 (如果尚未下载，自动秒级保存至本地后直接以文件形式打开)
          const handleOpenMediaFile = async (item) => {
            if (!item || !item.url) return;
            try {
              if (item.localPath && WineTokenFileUtil.fileExists(item.localPath)) {
                WineTokenFileUtil.openFile(item.localPath);
                return;
              }
              setFileToast('正在以本地文件形式打开...');
              const ext = WineTokenFileUtil.inferExtension(item.url, item.type);
              const fileName = `WineToken_${Date.now()}${ext}`;
              const localPath = await WineTokenFileUtil.saveMedia(item.url, fileName, item.type);
              item.localPath = localPath;
              setHistory(prev => {
                const next = updateHistoryLocalPath(prev, item, localPath);
                try {
                  localStorage.setItem('WINETOKEN_STUDIO_HISTORY', JSON.stringify(next));
                  const fs = require('fs');
                  const path = require('path');
                  const os = require('os');
                  const historyFile = path.join(os.homedir(), '.dsh', 'storages', 'winetoken_studio_history.json');
                  fs.writeFileSync(historyFile, JSON.stringify(next.slice(0, 60), null, 2), 'utf8');
                } catch (_) {}
                return next;
              });
              WineTokenFileUtil.openFile(localPath);
              setFileToast('已在系统默认应用中打开');
              setTimeout(() => setFileToast(''), 3000);
            } catch (err) {
              alert('以文件形式打开失败: ' + err.message);
              setFileToast('');
            }
          };

          // 保存媒体到本地用户指定路径，并在资源管理器中直接定位选中该文件 (支持用户自由选择盘符与目录)
          const handleSaveMediaToLocal = async (item) => {
            if (!item || !item.url) return;
            try {
              if (item.localPath && WineTokenFileUtil.fileExists(item.localPath)) {
                WineTokenFileUtil.revealFile(item.localPath);
                setFileToast('已在文件夹中高亮定位文件');
                setTimeout(() => setFileToast(''), 3000);
                return;
              }

              const ext = WineTokenFileUtil.inferExtension(item.url, item.type);
              const defaultName = `WineToken_${Date.now()}${ext}`;

              // 弹出 Windows 原生另存为对话框，用户自由挑选存放路径、盘符与文件名
              const targetPath = await WineTokenFileUtil.promptSaveLocation({
                title: item.type === 'video' ? '另存为视频' : '另存为图片',
                defaultName,
                type: item.type || 'image',
                ext
              });

              if (!targetPath) {
                // 用户点击取消，静默退出
                return;
              }

              setSavingId(item.id || item.url);
              setFileToast('正在写入本地磁盘...');

              const localPath = await WineTokenFileUtil.writeMediaToFile(item.url, targetPath);
              item.localPath = localPath;
              setHistory(prev => {
                const next = updateHistoryLocalPath(prev, item, localPath);
                try {
                  localStorage.setItem('WINETOKEN_STUDIO_HISTORY', JSON.stringify(next));
                  const fs = require('fs');
                  const path = require('path');
                  const os = require('os');
                  const historyFile = path.join(os.homedir(), '.dsh', 'storages', 'winetoken_studio_history.json');
                  fs.writeFileSync(historyFile, JSON.stringify(next.slice(0, 60), null, 2), 'utf8');
                } catch (_) {}
                return next;
              });
              setFileToast('保存成功，已在文件夹中高亮定位');
              setTimeout(() => setFileToast(''), 3000);
              WineTokenFileUtil.revealFile(localPath);
            } catch (err) {
              alert('保存到本地失败: ' + err.message);
              setFileToast('');
            } finally {
              setSavingId(null);
            }
          };

          // 打开媒体保存根目录 Pictures/WineToken
          const handleOpenSaveFolder = () => {
            const ok = WineTokenFileUtil.openFolder();
            if (!ok) alert('无法打开本地存储目录');
          };

          // 复制 Prompt 并反馈
          const copyPromptText = (text) => {
            if (!text) return;
            try {
              navigator.clipboard.writeText(text);
              setCopyFeedback(true);
              setTimeout(() => setCopyFeedback(false), 2000);
            } catch (_) {}
          };

          return h('div', {
            style: {
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              background: theme.bgMain,
              color: theme.textPrimary,
              fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
              overflow: 'hidden'
            }
          }, [
            // 隐藏的参考图片选择框
            h('input', {
              type: 'file',
              ref: fileInputRef,
              accept: 'image/png,image/jpeg,image/webp',
              style: { display: 'none' },
              onChange: handleFileChange
            }),

            // 1. 顶部 Header 栏 (黑白自适应)
            h('header', {
              style: {
                height: '52px',
                padding: '0 20px',
                borderBottom: `1px solid ${theme.borderSubtle}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexShrink: 0,
                background: theme.bgHeader
              }
            }, [
              // 左侧品牌标识
              h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } }, [
                h('div', {
                  style: {
                    width: '28px',
                    height: '28px',
                    borderRadius: '6px',
                    background: theme.isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)',
                    border: `1px solid ${theme.borderSubtle}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: theme.textPrimary
                  }
                }, h(Icon, { name: 'palette', size: 15 })),
                h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [
                  h('span', { style: { fontWeight: '600', fontSize: '13px', letterSpacing: '-0.2px', color: theme.textPrimary } }, '创作工坊'),
                  h('span', {
                    style: {
                      fontSize: '10px',
                      background: theme.isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.06)',
                      border: `1px solid ${theme.borderSubtle}`,
                      color: theme.textSecondary,
                      padding: '1px 5px',
                      borderRadius: '4px',
                      letterSpacing: '0.4px',
                      fontWeight: '500'
                    }
                  }, 'STUDIO')
                ])
              ]),

              // 中间 Segmented Control 模式切换 (黑白自适应)
              h('div', {
                style: {
                  display: 'flex',
                  background: theme.chipNormalBg,
                  borderRadius: '7px',
                  padding: '3px',
                  border: `1px solid ${theme.borderSubtle}`
                }
              }, [
                h('button', {
                  type: 'button',
                  style: {
                    padding: '4px 14px',
                    borderRadius: '5px',
                    border: 'none',
                    fontSize: '12px',
                    fontWeight: mode === 'image' ? '600' : '400',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    background: mode === 'image' ? theme.chipActiveBg : 'transparent',
                    color: mode === 'image' ? theme.chipActiveText : theme.textMuted,
                    boxShadow: mode === 'image' ? (theme.isDark ? '0 1px 3px rgba(0,0,0,0.4)' : '0 1px 3px rgba(0,0,0,0.1)') : 'none',
                    transition: 'all 0.15s ease'
                  },
                  onClick: () => setMode('image')
                }, [
                  h(Icon, { name: 'camera', size: 14 }),
                  h('span', {}, '图像工坊')
                ]),
                h('button', {
                  type: 'button',
                  style: {
                    padding: '4px 14px',
                    borderRadius: '5px',
                    border: 'none',
                    fontSize: '12px',
                    fontWeight: mode === 'video' ? '600' : '400',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    background: mode === 'video' ? theme.chipActiveBg : 'transparent',
                    color: mode === 'video' ? theme.chipActiveText : theme.textMuted,
                    boxShadow: mode === 'video' ? (theme.isDark ? '0 1px 3px rgba(0,0,0,0.4)' : '0 1px 3px rgba(0,0,0,0.1)') : 'none',
                    transition: 'all 0.15s ease'
                  },
                  onClick: () => setMode('video')
                }, [
                  h(Icon, { name: 'video', size: 14 }),
                  h('span', {}, '视频工坊')
                ]),
                h('button', {
                  type: 'button',
                  style: {
                    padding: '4px 14px',
                    borderRadius: '5px',
                    border: 'none',
                    fontSize: '12px',
                    fontWeight: mode === 'canvas' ? '600' : '400',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    background: mode === 'canvas' ? theme.chipActiveBg : 'transparent',
                    color: mode === 'canvas' ? theme.chipActiveText : theme.textMuted,
                    boxShadow: mode === 'canvas' ? (theme.isDark ? '0 1px 3px rgba(0,0,0,0.4)' : '0 1px 3px rgba(0,0,0,0.1)') : 'none',
                    transition: 'all 0.15s ease'
                  },
                  onClick: () => {
                    setMode('canvas');
                    if (!CanvasStorage.getTutorialDismissed()) {
                      setShowTutorial(true);
                    }
                  }
                }, [
                  h(Icon, { name: 'canvas', size: 14 }),
                  h('span', {}, '漫剧画布')
                ])
              ]),

              // 右侧资产指示（点击弹出账户与密钥管理中心）与返回对话
              h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } }, [
                h('div', { style: { position: 'relative' } }, [
                  h('div', {
                    style: {
                      fontSize: '12px',
                      padding: '4px 10px',
                      background: theme.chipNormalBg,
                      borderRadius: '6px',
                      border: `1px solid ${theme.borderSubtle}`,
                      color: theme.textSecondary,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      cursor: 'pointer',
                      userSelect: 'none'
                    },
                    onClick: (e) => {
                      e.stopPropagation();
                      setShowStudioPopover(v => !v);
                    }
                  }, [
                    h(Icon, { name: (billing.isSuper || billing.hasSubscription) ? 'crown' : 'wallet', size: 13, style: { opacity: 0.9, color: billing.isSuper ? (theme.isDark ? '#06b6d4' : '#0891b2') : (billing.hasSubscription ? (theme.isDark ? '#f59e0b' : '#d97706') : 'inherit') } }),
                    h('span', { style: { color: theme.textPrimary, fontWeight: '500' } }, billing.pillText)
                  ]),
                  showStudioPopover && h(WineTokenAccountPopover, {
                    positionTop: true,
                    onClose: () => setShowStudioPopover(false)
                  })
                ]),
                mode === 'canvas' && h('button', {
                  type: 'button',
                  style: {
                    background: 'transparent',
                    border: `1px solid ${theme.borderStrong}`,
                    color: theme.textSecondary,
                    borderRadius: '6px',
                    padding: '4px 10px',
                    fontSize: '12px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    transition: 'all 0.15s ease'
                  },
                  onMouseEnter: (e) => { e.currentTarget.style.color = theme.textPrimary; e.currentTarget.style.borderColor = theme.textPrimary; },
                  onMouseLeave: (e) => { e.currentTarget.style.color = theme.textSecondary; e.currentTarget.style.borderColor = theme.borderStrong; },
                  onClick: () => setShowTutorial(true)
                }, [
                  h(Icon, { name: 'help', size: 13 }),
                  h('span', {}, '画布教程')
                ]),
                h('button', {
                  type: 'button',
                  style: {
                    background: 'transparent',
                    border: `1px solid ${theme.borderStrong}`,
                    color: theme.textSecondary,
                    borderRadius: '6px',
                    padding: '4px 10px',
                    fontSize: '12px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    transition: 'all 0.15s ease'
                  },
                  onMouseEnter: (e) => { e.currentTarget.style.color = theme.textPrimary; e.currentTarget.style.borderColor = theme.textPrimary; },
                  onMouseLeave: (e) => { e.currentTarget.style.color = theme.textSecondary; e.currentTarget.style.borderColor = theme.borderStrong; },
                  onClick: () => {
                    if (window.__dsh_layout_selectPanel) {
                      window.__dsh_layout_selectPanel(null);
                    }
                  }
                }, [
                  h(Icon, { name: 'arrowLeft', size: 13 }),
                  h('span', {}, '返回对话')
                ])
              ])
            ]),

            // 2. 主体工作台 (双层容器常驻保活，彻底杜绝切 Tab 销毁 React 局部状态 CANVAS-01)
            h('div', {
              style: {
                flex: 1,
                display: mode === 'canvas' ? 'flex' : 'none',
                flexDirection: 'column',
                overflow: 'hidden'
              }
            }, [
              h((function() {
                const canvasEngine = (typeof window !== 'undefined' && window.localStorage && window.localStorage.getItem('WINETOKEN_CANVAS_ENGINE')) || 'reactflow';
                return (canvasEngine === 'legacy' || !ReactFlowWorkspace) ? LegacyCanvasWorkspace : ReactFlowWorkspace;
              })(), {
                theme,
                isVip,
                isSvip,
                isSuper,
                onOpenTutorial: () => setShowTutorial(true)
              })
            ]),
            h('div', {
              style: {
                flex: 1,
                display: mode === 'canvas' ? 'none' : 'grid',
                gridTemplateColumns: '360px 1fr',
                overflow: 'hidden'
              }
            }, [
              // 左侧：专业配置控制台 (自适应)
              h('div', {
                style: {
                  padding: '20px 22px',
                  background: theme.bgSidebar,
                  borderRight: `1px solid ${theme.borderSubtle}`,
                  overflowY: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '18px'
                }
              }, [
                // 1. 基底模型选择 (价格根据 VIP 身份自适应)
                h('div', {}, [
                  h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' } }, [
                    h('label', { style: { fontSize: '12px', fontWeight: '500', color: theme.textSecondary } }, '基底模型'),
                    h('div', { style: { display: 'flex', alignItems: 'center', gap: '5px' } }, [
                      mode === 'image' ? (
                        effectiveSinglePrice === 0 ? h('span', { style: { fontSize: '11px', color: '#22c55e', fontWeight: '500' } }, '限免直出') : (
                          effectiveSinglePrice != null ? [
                            isVip ? h('span', {
                              style: {
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '3px',
                                fontSize: '11px',
                                color: '#22c55e',
                                fontWeight: '600'
                              }
                            }, [
                              h(Icon, { name: 'crown', size: 12 }),
                              h('span', {}, `${isSuper ? 'SUPER' : (isSvip ? 'SVIP' : 'VIP')} ¥${formatCNY(effectiveSinglePrice)}/张`)
                            ]) : h('span', { style: { fontSize: '11px', color: theme.textSecondary } }, `¥${formatCNY(effectiveSinglePrice)}/张`),
                            isVip && currentModelObj.vipPrice != null && currentModelObj.price > currentModelObj.vipPrice && h('span', {
                              style: {
                                fontSize: '10px',
                                color: theme.textMuted,
                                textDecoration: 'line-through'
                              }
                            }, `原¥${formatCNY(currentModelObj.price)}`)
                          ] : h('span', { style: { fontSize: '11px', color: theme.textSecondary } }, (isVip && currentModelObj.vipPriceText) ? currentModelObj.vipPriceText : (currentModelObj.priceText || ''))
                        )
                      ) : (
                        // 视频模式下：动态按当前所选秒数计算展示 (SVIP 8折，VIP 9折)
                        [
                          isVip ? h('span', {
                            style: {
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '3px',
                              fontSize: '11px',
                              color: '#22c55e',
                              fontWeight: '600'
                            }
                          }, [
                            h(Icon, { name: 'crown', size: 12 }),
                            h('span', {}, `${isSuper ? 'SUPER' : (isSvip ? 'SVIP' : 'VIP')} ¥${formatCNY(estCost)}/${duration}秒 (¥${formatCNY(effectiveSecPrice)}/秒)`)
                          ]) : h('span', { style: { fontSize: '11px', color: theme.textSecondary } }, `¥${formatCNY(estCost)}/${duration}秒 (¥${formatCNY(effectiveSecPrice)}/秒)`),
                          isVip && currentModelObj.pricePerSecond && (currentModelObj.pricePerSecond > effectiveSecPrice) && h('span', {
                            style: {
                              fontSize: '10px',
                              color: theme.textMuted,
                              textDecoration: 'line-through'
                            }
                          }, `原¥${formatCNY(currentModelObj.pricePerSecond * duration)}`)
                        ]
                      )
                    ])
                  ]),
                  h('div', {
                    style: {
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '7px',
                      marginBottom: '8px'
                    }
                  }, currentModels.map(m => {
                    const isSelected = selectedModel === m.id;
                    let priceDisplay = '';
                    let isItemFree = false;
                    if (mode === 'image') {
                      const effP = getModelEffectivePrice(m);
                      isItemFree = effP === 0 || (m.tag && m.tag.includes('限免'));
                      if (effP != null) {
                        if (effP === 0) priceDisplay = '限免 ¥0.00';
                        else if (isVip && m.vipPrice != null) priceDisplay = `${isSuper ? 'SUPER' : (isSvip ? 'SVIP' : 'VIP')} ¥${formatCNY(effP)}/张`;
                        else priceDisplay = `¥${formatCNY(effP)}/张`;
                      } else {
                        priceDisplay = (isVip && m.vipPriceText) ? m.vipPriceText : m.priceText;
                      }
                    } else {
                      const secP = isVip
                        ? (isSvip && m.vipPricePerSecond != null
                            ? m.vipPricePerSecond
                            : Number(((m.pricePerSecond || 0.15) * discountRatio).toFixed(3)))
                        : (m.pricePerSecond || 0.15);
                      isItemFree = secP === 0 || (m.tag && m.tag.includes('限免'));
                      priceDisplay = isItemFree
                        ? '限免 ¥0.00'
                        : (isVip ? `${isSuper ? 'SUPER' : (isSvip ? 'SVIP' : 'VIP')} ¥${formatCNY(secP)}/秒` : `¥${formatCNY(secP)}/秒`);
                    }

                    return h('div', {
                      key: m.id,
                      onClick: () => setSelectedModel(m.id),
                      style: {
                        padding: '9px 12px',
                        borderRadius: '8px',
                        border: isSelected
                          ? (theme.isDark ? '1.5px solid #38bdf8' : '1.5px solid #0284c7')
                          : `1px solid ${theme.borderSubtle}`,
                        backgroundColor: isSelected
                          ? (theme.isDark ? 'rgba(56, 189, 248, 0.10)' : 'rgba(2, 132, 199, 0.06)')
                          : theme.bgInput,
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px',
                        transition: 'all 0.15s ease',
                        boxShadow: isSelected
                          ? (theme.isDark ? '0 0 10px rgba(56, 189, 248, 0.12)' : '0 2px 8px rgba(2, 132, 199, 0.08)')
                          : 'none'
                      }
                    }, [
                      // 首行：左侧完整全称 + Tag徽章；右侧生效价格
                      h('div', {
                        style: {
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '8px'
                        }
                      }, [
                        h('div', {
                          style: {
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            minWidth: 0,
                            flex: 1
                          }
                        }, [
                          h('span', {
                            style: {
                              fontSize: '12px',
                              fontWeight: isSelected ? '700' : '600',
                              color: isSelected ? (theme.isDark ? '#38bdf8' : '#0284c7') : theme.textPrimary,
                              whiteSpace: 'nowrap'
                            }
                          }, m.name),
                          m.tag && h('span', {
                            style: {
                              fontSize: '9.5px',
                              fontWeight: 500,
                              padding: '1.5px 5.5px',
                              borderRadius: '4px',
                              backgroundColor: isSelected
                                ? 'rgba(6, 182, 212, 0.2)'
                                : (theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)'),
                              color: isSelected ? '#06b6d4' : theme.textMuted,
                              flexShrink: 0
                            }
                          }, m.tag)
                        ]),
                        h('div', {
                          style: {
                            flexShrink: 0,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px'
                          }
                        }, [
                          h('span', {
                            style: {
                              fontSize: '11px',
                              fontWeight: '600',
                              color: isSelected
                                ? (theme.isDark ? '#38bdf8' : '#0284c7')
                                : (isItemFree ? '#22c55e' : (isVip ? (theme.isDark ? '#38bdf8' : '#0284c7') : theme.textPrimary)),
                              fontFamily: 'monospace'
                            }
                          }, priceDisplay)
                        ])
                      ]),
                      // 次行：模型特性说明 (清晰呈现模型特点，杜绝盲选)
                      m.desc && h('div', {
                        style: {
                          fontSize: '10.5px',
                          color: isSelected ? (theme.isDark ? '#cbd5e1' : '#475569') : theme.textMuted,
                          lineHeight: '1.35',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }
                      }, m.desc)
                    ]);
                  }))
                ]),

                // 2. 多参考图槽位管理组件 (支持 1~5 张参考图、命名别名、拖拽与精准光标插入)
                h('div', {}, [
                  h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' } }, [
                    h('div', { style: { display: 'flex', alignItems: 'center', gap: '5px' } }, [
                      h('label', { style: { fontSize: '12px', fontWeight: '500', color: theme.textSecondary } },
                        mode === 'image' ? `参考图库 (${referenceSlots.length}/5)` : '视频画面帧 (首帧)'
                      ),
                      mode === 'image' && referenceSlots.length > 0 && h('span', { style: { fontSize: '10.5px', color: theme.textMuted } }, '可拖拽至输入框')
                    ]),
                    h('span', { style: { fontSize: '11px', color: (mode === 'video' ? Boolean(firstFrame) : referenceSlots.length > 0) ? '#22c55e' : theme.textMuted } },
                      mode === 'video'
                        ? (firstFrame ? '首帧驱动 · 模型明确识别开场画面' : '可选')
                        : (referenceSlots.length > 0 ? `已启用 ${referenceSlots.length} 张垫图` : '可选')
                    )
                  ]),

                  // 隐藏的多选文件输入框
                  h('input', {
                    ref: fileInputRef,
                    type: 'file',
                    accept: 'image/png,image/jpeg,image/webp,image/gif',
                    multiple: true,
                    style: { display: 'none' },
                    onChange: handleFileChange
                  }),

                  // 首帧专用隐藏文件输入框 (视频模式)
                  h('input', {
                    ref: firstFrameInputRef,
                    type: 'file',
                    accept: 'image/png,image/jpeg,image/webp,image/gif',
                    style: { display: 'none' },
                    onChange: handleFirstFrameChange
                  }),

                  // 视频模式：首帧独立槽位 (语义在 UI 层固定，模型按显式字段识别帧角色；尾帧已下线)
                  mode === 'video' ? h('div', {
                    style: {
                      display: 'flex',
                      gap: '8px',
                      alignItems: 'stretch'
                    }
                  }, [
                    renderFrameCard('首帧 · 开场画面', firstFrame, setFirstFrame, firstFrameInputRef, '上传开场画面', '#22c55e', '视频将以此画面开场 (推荐与成片比例一致)')
                  ]) : referenceSlots.length > 0 ? h('div', {
                    style: {
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px'
                    }
                  }, [
                    // 槽位卡片列表
                    referenceSlots.map((slot) => {
                      const isEditing = editingSlotId === slot.id;
                      return h('div', {
                        key: slot.id,
                        style: {
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          background: theme.bgInput,
                          border: `1px solid ${theme.borderStrong}`,
                          borderRadius: '7px',
                          padding: '6px 8px',
                          position: 'relative'
                        }
                      }, [
                        // 可拖拽缩略图
                        h('div', {
                          draggable: true,
                          title: '按住拖入提示词光标处',
                          onDragStart: (e) => {
                            e.dataTransfer.setData('application/winetoken-ref', JSON.stringify({ index: slot.index, name: slot.name }));
                            e.dataTransfer.setData('text/plain', ` @[图${slot.index}:${slot.name}] `);
                            e.dataTransfer.effectAllowed = 'copy';
                          },
                          style: {
                            position: 'relative',
                            cursor: 'grab',
                            flexShrink: 0
                          }
                        }, [
                          h('img', {
                            src: slot.dataUrl,
                            alt: slot.name,
                            style: {
                              width: '38px',
                              height: '38px',
                              objectFit: 'cover',
                              borderRadius: '5px',
                              border: `1px solid ${theme.borderSubtle}`,
                              display: 'block'
                            }
                          }),
                          h('div', {
                            style: {
                              position: 'absolute',
                              bottom: '0',
                              left: '0',
                              right: '0',
                              background: 'rgba(0,0,0,0.65)',
                              color: '#ffffff',
                              fontSize: '9px',
                              textAlign: 'center',
                              lineHeight: '13px',
                              borderBottomLeftRadius: '5px',
                              borderBottomRightRadius: '5px',
                              fontWeight: '600'
                            }
                          }, `图${slot.index}`)
                        ]),

                        // 别名与规格展示
                        h('div', { style: { flex: 1, minWidth: 0 } }, [
                          isEditing ? h('input', {
                            autoFocus: true,
                            value: editingSlotName,
                            onChange: (e) => setEditingSlotName(e.target.value),
                            onBlur: () => {
                              const newName = editingSlotName.trim() || `图${slot.index}`;
                              setReferenceSlots(prev => prev.map(s => s.id === slot.id ? { ...s, name: newName } : s));
                              setEditingSlotId(null);
                            },
                            onKeyDown: (e) => {
                              if (e.key === 'Enter') {
                                const newName = editingSlotName.trim() || `图${slot.index}`;
                                setReferenceSlots(prev => prev.map(s => s.id === slot.id ? { ...s, name: newName } : s));
                                setEditingSlotId(null);
                              } else if (e.key === 'Escape') {
                                setEditingSlotId(null);
                              }
                            },
                            style: {
                              width: '100%',
                              padding: '2px 5px',
                              borderRadius: '4px',
                              background: theme.bgSidebar,
                              border: `1px solid ${theme.textPrimary}`,
                              color: theme.textPrimary,
                              fontSize: '11.5px',
                              outline: 'none',
                              boxSizing: 'border-box'
                            }
                          }) : h('div', {
                            title: '点击可修改别名',
                            onClick: () => {
                              setEditingSlotId(slot.id);
                              setEditingSlotName(slot.name);
                            },
                            style: {
                              fontSize: '12px',
                              color: theme.textPrimary,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px'
                            }
                          }, [
                            h('span', { style: { fontWeight: '500' } }, slot.name),
                            h(Icon, { name: 'edit', size: 10, style: { opacity: 0.6 } })
                          ]),
                          h('div', { style: { fontSize: '10.5px', color: theme.textMuted, marginTop: '2px' } }, slot.size)
                        ]),

                        // 快捷引用到提示词按钮
                        h('button', {
                          type: 'button',
                          title: '在提示词光标处插入该图代号',
                          onClick: () => insertTokenAtCursor(` @[图${slot.index}:${slot.name}] `),
                          style: {
                            padding: '3px 7px',
                            borderRadius: '4px',
                            background: theme.chipNormalBg,
                            border: `1px solid ${theme.borderSubtle}`,
                            color: theme.textSecondary,
                            fontSize: '11px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '3px',
                            flexShrink: 0
                          }
                        }, [
                          h(Icon, { name: 'tag', size: 10 }),
                          h('span', {}, '引用')
                        ]),

                        // 删除槽位按钮
                        h('button', {
                          type: 'button',
                          title: '删除该参考图',
                          onClick: () => {
                            setReferenceSlots(prev => {
                              const remaining = prev.filter(s => s.id !== slot.id);
                              return remaining.map((s, idx) => ({ ...s, index: idx + 1 }));
                            });
                          },
                          style: {
                            background: 'transparent',
                            border: 'none',
                            color: theme.textMuted,
                            cursor: 'pointer',
                            padding: '4px',
                            borderRadius: '4px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0
                          },
                          onMouseEnter: (e) => { e.currentTarget.style.color = '#ef4444'; },
                          onMouseLeave: (e) => { e.currentTarget.style.color = theme.textMuted; }
                        }, h(Icon, { name: 'close', size: 13 }))
                      ]);
                    }),

                    // 添加更多槽位按钮 (若少于 5 张)
                    referenceSlots.length < 5 && h('button', {
                      type: 'button',
                      onClick: () => fileInputRef.current?.click(),
                      style: {
                        padding: '6px 10px',
                        borderRadius: '6px',
                        border: `1px dashed ${theme.borderStrong}`,
                        background: 'transparent',
                        color: theme.textSecondary,
                        fontSize: '11.5px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '5px',
                        transition: 'all 0.15s ease'
                      },
                      onMouseEnter: (e) => { e.currentTarget.style.borderColor = theme.textPrimary; e.currentTarget.style.color = theme.textPrimary; },
                      onMouseLeave: (e) => { e.currentTarget.style.borderColor = theme.borderStrong; e.currentTarget.style.color = theme.textSecondary; }
                    }, [
                      h(Icon, { name: 'plus', size: 12 }),
                      h('span', {}, `添加参考图 (${referenceSlots.length}/5)`)
                    ])
                  ]) : h('div', {
                    onClick: () => fileInputRef.current?.click(),
                    onDragOver: (e) => { e.preventDefault(); e.stopPropagation(); },
                    onDrop: handleDropFile,
                    style: {
                      border: `1px dashed ${theme.borderStrong}`,
                      background: theme.chipNormalBg,
                      borderRadius: '7px',
                      padding: '12px 14px',
                      textAlign: 'center',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '4px',
                      transition: 'all 0.15s ease'
                    },
                    onMouseEnter: (e) => { e.currentTarget.style.borderColor = theme.textPrimary; },
                    onMouseLeave: (e) => { e.currentTarget.style.borderColor = theme.borderStrong; }
                  }, [
                    h(Icon, { name: 'upload', size: 16, style: { color: theme.textSecondary } }),
                    h('span', { style: { fontSize: '11.5px', color: theme.textSecondary } }, '点击或拖拽上传参考图 (最多5张)'),
                    h('span', { style: { fontSize: '10.5px', color: theme.textMuted } }, '支持多角色人物与场景垫图、拖拽指代')
                  ])
                ]),

                // 3. 画面提示词 Prompt 与灵感标签 (支持光标拖拽参考图放置)
                h('div', {}, [
                  h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' } }, [
                    h('label', { style: { fontSize: '12px', fontWeight: '500', color: theme.textSecondary } }, '画面描述 (Prompt)'),
                    h('button', {
                      type: 'button',
                      style: {
                        background: 'transparent',
                        border: 'none',
                        color: theme.textSecondary,
                        fontSize: '11px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '0'
                      },
                      onMouseEnter: (e) => { e.currentTarget.style.color = theme.textPrimary; },
                      onMouseLeave: (e) => { e.currentTarget.style.color = theme.textSecondary; },
                      onClick: () => setPrompt('中景 华星学校 @[图3:场景]，ljw @[图1:人物] 带着水球跑向 710 @[图2:人物]，操场阳光明媚嬉戏打闹，哈苏真实自然光影摄影')
                    }, [
                      h(Icon, { name: 'sparkles', size: 12 }),
                      h('span', {}, '填入精选多图示例')
                    ])
                  ]),
                  h('textarea', {
                    ref: promptRef,
                    rows: 3,
                    value: prompt,
                    onChange: (e) => setPrompt(e.target.value),
                    onDragOver: (e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'copy';
                    },
                    onDrop: (e) => {
                      e.preventDefault();
                      let insertText = '';
                      const rawSlot = e.dataTransfer.getData('application/winetoken-ref');
                      if (rawSlot) {
                        try {
                          const slot = JSON.parse(rawSlot);
                          insertText = ` @[图${slot.index}:${slot.name}] `;
                        } catch (_) {}
                      }
                      if (!insertText) {
                        const text = e.dataTransfer.getData('text/plain');
                        if (text && text.includes('@[图')) insertText = text;
                      }
                      if (!insertText && e.dataTransfer.files?.length > 0) {
                        // 直接拖入新文件到 textarea，自动加入槽位并在光标处插入标签
                        addFilesToSlots(e.dataTransfer.files, (newSlot) => {
                          insertTokenAtCursor(` @[图${newSlot.index}:${newSlot.name}] `);
                        });
                        return;
                      }
                      if (insertText) {
                        insertTokenAtCursor(insertText);
                      }
                    },
                    placeholder: referenceSlots.length > 0
                      ? '输入提示词，可直接把上方参考图拖入此处光标位置，如：华星学校 @[图3:场景]，ljw @[图1:人物] 去找 710 @[图2:人物] 玩水球...'
                      : '详细描述画面主体、镜头构图、光影材质与氛围风格...',
                    style: {
                      width: '100%',
                      padding: '10px 12px',
                      borderRadius: '7px',
                      background: theme.bgInput,
                      border: `1px solid ${theme.borderStrong}`,
                      color: theme.textPrimary,
                      fontSize: '12.5px',
                      lineHeight: '1.5',
                      resize: 'none',
                      boxSizing: 'border-box',
                      outline: 'none'
                    },
                    onFocus: (e) => { e.target.style.borderColor = theme.textPrimary; },
                    onBlur: (e) => { e.target.style.borderColor = theme.borderStrong; }
                  }),
                  // 快捷灵感药丸标签
                  h('div', {
                    style: {
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '6px',
                      marginTop: '8px'
                    }
                  }, INSPIRATION_CHIPS.map(chip => h('button', {
                    key: chip.label,
                    type: 'button',
                    onClick: () => setPrompt(p => (p.trim() ? p.trim() + chip.text : chip.text.replace(/^[，,\s]+/, ''))),
                    style: {
                      padding: '3px 8px',
                      borderRadius: '12px',
                      border: `1px solid ${theme.borderSubtle}`,
                      background: theme.chipNormalBg,
                      color: theme.textSecondary,
                      fontSize: '11px',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease'
                    },
                    onMouseEnter: (e) => { e.currentTarget.style.color = theme.textPrimary; e.currentTarget.style.borderColor = theme.borderStrong; },
                    onMouseLeave: (e) => { e.currentTarget.style.color = theme.textSecondary; e.currentTarget.style.borderColor = theme.borderSubtle; }
                  }, '+ ' + chip.label)))
                ]),

                // 4. 当前模型专属支持的分辨率规格 (独立配置)
                availableResolutions.length > 0 && h('div', {}, [
                  h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' } }, [
                    h('label', { style: { fontSize: '12px', fontWeight: '500', color: theme.textSecondary } }, '输出分辨率'),
                    h('span', { style: { fontSize: '11px', color: theme.textMuted } }, size)
                  ]),
                  h('div', {
                    style: {
                      display: 'grid',
                      gridTemplateColumns: availableResolutions.length <= 3 ? `repeat(${availableResolutions.length}, 1fr)` : 'repeat(2, 1fr)',
                      gap: '8px'
                    }
                  }, availableResolutions.map(s => {
                    const active = size === s.val;
                    return h('button', {
                      key: s.val,
                      type: 'button',
                      onClick: () => setSize(s.val),
                      style: {
                        padding: '7px 4px',
                        borderRadius: '7px',
                        border: `1px solid ${active ? (theme.isDark ? 'rgba(255, 255, 255, 0.3)' : 'rgba(0, 0, 0, 0.3)') : theme.borderSubtle}`,
                        background: active ? theme.chipActiveBg : theme.chipNormalBg,
                        color: active ? theme.chipActiveText : theme.textMuted,
                        fontSize: '11px',
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '4px',
                        boxShadow: active ? (theme.isDark ? '0 1px 3px rgba(0,0,0,0.4)' : '0 1px 3px rgba(0,0,0,0.1)') : 'none',
                        transition: 'all 0.15s ease'
                      }
                    }, [
                      h(Icon, { name: s.icon, size: 15 }),
                      h('span', { style: { fontWeight: active ? '600' : '400' } }, s.label)
                    ]);
                  }))
                ]),

                // 5. 规格数量 / 视频时长控制
                mode === 'image' ? h('div', {}, [
                  h('label', { style: { fontSize: '12px', fontWeight: '500', color: theme.textSecondary, display: 'block', marginBottom: '8px' } }, '生成数量'),
                  h('div', {
                    style: {
                      display: 'flex',
                      background: theme.chipNormalBg,
                      borderRadius: '7px',
                      padding: '3px',
                      border: `1px solid ${theme.borderSubtle}`
                    }
                  }, [1, 2].map(n => {
                    const active = count === n;
                    return h('button', {
                      key: n,
                      type: 'button',
                      onClick: () => setCount(n),
                      style: {
                        flex: 1,
                        padding: '6px',
                        borderRadius: '5px',
                        border: 'none',
                        background: active ? theme.chipActiveBg : 'transparent',
                        color: active ? theme.chipActiveText : theme.textMuted,
                        fontWeight: active ? '600' : '400',
                        fontSize: '12px',
                        cursor: 'pointer',
                        boxShadow: active ? (theme.isDark ? '0 1px 3px rgba(0,0,0,0.4)' : '0 1px 3px rgba(0,0,0,0.1)') : 'none',
                        transition: 'all 0.15s ease'
                      }
                    }, `${n} 张`);
                  }))
                ]) : h('div', {}, [
                  h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' } }, [
                    h('label', { style: { fontSize: '12px', fontWeight: '500', color: theme.textSecondary } }, '生成时长 (秒数)'),
                    h('span', { style: { fontSize: '11px', color: '#22c55e', fontWeight: '500' } }, `${duration} 秒 · 预估 ¥${formatCNY(estCost)}`)
                  ]),
                  h('div', {
                    style: {
                      display: 'flex',
                      background: theme.chipNormalBg,
                      borderRadius: '7px',
                      padding: '3px',
                      border: `1px solid ${theme.borderSubtle}`,
                      gap: '4px'
                    }
                  }, (currentModelObj.durations || [{ val: 5, label: '5 秒', tag: '标配' }]).map(d => {
                    const active = duration === d.val;
                    return h('button', {
                      key: d.val,
                      type: 'button',
                      onClick: () => setDuration(d.val),
                      style: {
                        flex: 1,
                        padding: '6px 4px',
                        borderRadius: '5px',
                        border: 'none',
                        background: active ? theme.chipActiveBg : 'transparent',
                        color: active ? theme.chipActiveText : theme.textMuted,
                        fontWeight: active ? '600' : '400',
                        fontSize: '12px',
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '2px',
                        boxShadow: active ? (theme.isDark ? '0 1px 3px rgba(0,0,0,0.4)' : '0 1px 3px rgba(0,0,0,0.1)') : 'none',
                        transition: 'all 0.15s ease'
                      }
                    }, [
                      h('span', { style: { fontWeight: active ? '600' : '500' } }, d.label),
                      d.tag && h('span', { style: { fontSize: '9.5px', color: active ? theme.chipActiveText : theme.textMuted, opacity: active ? 1 : 0.7 } }, d.tag)
                    ]);
                  }))
                ]),

                // 6. 立即生成主操作按钮 (支持 VIP 身份特惠与扣费提示)
                h('div', { style: { marginTop: 'auto', paddingTop: '16px' } }, [
                  h('button', {
                    type: 'button',
                    disabled: isGenerating,
                    onClick: handleGenerate,
                    style: {
                      width: '100%',
                      padding: '11px 16px',
                      borderRadius: '7px',
                      border: 'none',
                      background: isGenerating ? theme.btnDisabledBg : theme.btnPrimaryBg,
                      color: isGenerating ? theme.btnDisabledText : theme.btnPrimaryText,
                      fontSize: '13px',
                      fontWeight: '600',
                      cursor: isGenerating ? 'not-allowed' : 'pointer',
                      boxShadow: isGenerating ? 'none' : (theme.isDark ? '0 2px 8px rgba(0,0,0,0.3)' : '0 2px 8px rgba(0,0,0,0.15)'),
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px',
                      transition: 'all 0.15s ease'
                    },
                    onMouseEnter: (e) => {
                      if (!isGenerating) {
                        e.currentTarget.style.opacity = '0.9';
                      }
                    },
                    onMouseLeave: (e) => {
                      if (!isGenerating) {
                        e.currentTarget.style.opacity = '1.0';
                      }
                    }
                  }, isGenerating ? [
                    h(Icon, { name: 'spinner', size: 15, style: { animation: 'spin 1s linear infinite' } }),
                    h('span', {}, statusMsg || 'AI 正在处理中...')
                  ] : [
                    h(Icon, { name: 'sparkles', size: 14 }),
                    h('span', {}, mode === 'image'
                      ? (referenceSlots.length > 0
                          ? `立即垫图生成 · 预估消耗 ¥${formatCNY(estCost)}${isVip ? ` (${isSuper ? 'SUPER' : (isSvip ? 'SVIP' : 'VIP')}优先扣套餐)` : ''}`
                          : `立即生成 · 预估消耗 ¥${formatCNY(estCost)}${isVip ? ` (${isSuper ? 'SUPER' : (isSvip ? 'SVIP' : 'VIP')}优先扣套餐)` : ''}`)
                      : (firstFrame
                          ? `提交首帧生视频 (${duration}秒) · 预估消耗 ¥${formatCNY(estCost)}${isVip ? ` (${isSuper ? 'SUPER' : (isSvip ? 'SVIP' : 'VIP')}优先扣套餐)` : ''}`
                          : `提交文生视频 (${duration}秒) · 预估消耗 ¥${formatCNY(estCost)}${isVip ? ` (${isSuper ? 'SUPER' : (isSvip ? 'SVIP' : 'VIP')}优先扣套餐)` : ''}`)
                    )
                  ])
                ])
              ]),

              // 右侧：多模态主画廊与展台 (方案 C：展台全量自适应黑白)
              h('div', {
                style: {
                  padding: '24px',
                  display: 'flex',
                  flexDirection: 'column',
                  background: theme.bgStage,
                  overflowY: 'auto',
                  gap: '20px'
                }
              }, [
                // 实时展示主区域 (自适应卡片背景)
                h('div', {
                  style: {
                    flex: 1,
                    minHeight: '400px',
                    background: theme.bgCard,
                    borderRadius: '10px',
                    border: `1px solid ${theme.borderSubtle}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    position: 'relative',
                    overflow: 'hidden'
                  }
                }, [
                  activeImage ? h('div', {
                    style: {
                      width: '100%',
                      height: '100%',
                      display: 'flex',
                      flexDirection: 'column',
                      padding: '16px 20px',
                      boxSizing: 'border-box',
                      overflow: 'hidden'
                    }
                  }, [
                    // 独立媒体舞台容器：自适应占据剩余全部垂直高度，支持视频/图像多模态，点击直接在系统原生应用中打开
                    h('div', {
                      style: {
                        flex: 1,
                        minHeight: 0,
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        overflow: 'hidden',
                        cursor: 'pointer'
                      },
                      title: '点击直接以本地文件形式在系统默认应用中打开查看',
                      onClick: () => handleOpenMediaFile(activeImage)
                    }, [
                      (activeImage.type === 'video' || (typeof activeImage.url === 'string' && activeImage.url.includes('.mp4')))
                        ? h('video', {
                            src: activeImage.url,
                            controls: true,
                            autoPlay: true,
                            loop: true,
                            style: {
                              maxWidth: '100%',
                              maxHeight: '100%',
                              borderRadius: '8px',
                              boxShadow: theme.isDark ? '0 12px 32px rgba(0, 0, 0, 0.65)' : '0 12px 32px rgba(0, 0, 0, 0.12)',
                              border: `1px solid ${theme.borderSubtle}`
                            }
                          })
                        : h('img', {
                            src: activeImage.url,
                            alt: activeImage.prompt,
                            style: {
                              maxWidth: '100%',
                              maxHeight: '100%',
                              objectFit: 'contain',
                              borderRadius: '8px',
                              boxShadow: theme.isDark ? '0 12px 32px rgba(0, 0, 0, 0.65)' : '0 12px 32px rgba(0, 0, 0, 0.12)',
                              border: `1px solid ${theme.borderSubtle}`,
                              imageRendering: '-webkit-optimize-contrast'
                            }
                          })
                    ]),
                    // 浮动悬停操作栏 (自适应)
                    h('div', {
                      style: {
                        flexShrink: 0,
                        marginTop: '12px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexWrap: 'wrap',
                        gap: '8px',
                        background: theme.floatingBarBg,
                        padding: '6px 12px',
                        borderRadius: '8px',
                        border: `1px solid ${theme.floatingBarBorder}`,
                        boxShadow: theme.isDark ? '0 8px 20px rgba(0,0,0,0.5)' : '0 8px 20px rgba(0,0,0,0.1)',
                        zIndex: 2,
                        position: 'relative'
                      }
                    }, [
                      // 1. 以本地文件直接打开
                      h('button', {
                        type: 'button',
                        onClick: () => handleOpenMediaFile(activeImage),
                        title: '在系统默认应用（照片/媒体播放器）中以本地文件形式打开',
                        style: {
                          padding: '5px 12px',
                          borderRadius: '5px',
                          background: theme.btnPrimaryBg,
                          border: 'none',
                          color: theme.btnPrimaryText,
                          fontSize: '12px',
                          fontWeight: '600',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px'
                        }
                      }, [
                        h(Icon, { name: 'externalLink', size: 13 }),
                        h('span', {}, '以文件打开')
                      ]),

                      // 2. 保存到本地 / 在文件夹中定位
                      h('button', {
                        type: 'button',
                        disabled: savingId === (activeImage.id || activeImage.url),
                        onClick: () => handleSaveMediaToLocal(activeImage),
                        title: (activeImage.localPath && WineTokenFileUtil.fileExists(activeImage.localPath))
                          ? '文件已保存，点击直接在文件资源管理器中高亮定位'
                          : '选择路径保存至本地（可自由指定盘符与文件名）',
                        style: {
                          padding: '5px 12px',
                          borderRadius: '5px',
                          background: theme.chipNormalBg,
                          border: `1px solid ${theme.borderStrong}`,
                          color: theme.textPrimary,
                          fontSize: '12px',
                          cursor: (savingId === (activeImage.id || activeImage.url)) ? 'wait' : 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px'
                        }
                      }, [
                        h(Icon, {
                          name: (activeImage.localPath && WineTokenFileUtil.fileExists(activeImage.localPath)) ? 'folder' : 'download',
                          size: 13
                        }),
                        h('span', {}, (savingId === (activeImage.id || activeImage.url))
                          ? '正在保存...'
                          : ((activeImage.localPath && WineTokenFileUtil.fileExists(activeImage.localPath))
                            ? '定位文件'
                            : (activeImage.type === 'video' ? '保存视频' : '保存原图')))
                      ]),

                      // 3. 打开存储根目录
                      h('button', {
                        type: 'button',
                        onClick: handleOpenSaveFolder,
                        title: '打开本地媒体保存文件夹 Pictures/WineToken',
                        style: {
                          padding: '5px 10px',
                          borderRadius: '5px',
                          background: theme.chipNormalBg,
                          border: `1px solid ${theme.borderStrong}`,
                          color: theme.textSecondary,
                          fontSize: '12px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '5px'
                        }
                      }, [
                        h(Icon, { name: 'folder', size: 13 }),
                        h('span', {}, '存储目录')
                      ]),

                      // 4. 操作状态 Toast 提示气泡
                      fileToast && h('div', {
                        style: {
                          position: 'absolute',
                          top: '-36px',
                          background: theme.isDark ? '#1f2937' : '#111827',
                          color: '#ffffff',
                          padding: '4px 10px',
                          borderRadius: '6px',
                          fontSize: '11px',
                          boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
                          pointerEvents: 'none',
                          zIndex: 10
                        }
                      }, fileToast),
                      h('button', {
                        type: 'button',
                        onClick: () => copyPromptText(activeImage.prompt),
                        style: {
                          padding: '5px 12px',
                          borderRadius: '5px',
                          background: theme.chipNormalBg,
                          border: `1px solid ${theme.borderStrong}`,
                          color: theme.textPrimary,
                          fontSize: '12px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px'
                        }
                      }, [
                        h(Icon, { name: copyFeedback ? 'check' : 'copy', size: 13, style: { color: copyFeedback ? '#22c55e' : 'currentColor' } }),
                        h('span', {}, copyFeedback ? '已复制！' : '复制提示词')
                      ]),
                      h('button', {
                        type: 'button',
                        onClick: () => {
                          setPrompt(activeImage.prompt);
                          setSelectedModel(activeImage.model);
                          if (activeImage.size) setSize(activeImage.size);
                        },
                        style: {
                          padding: '5px 12px',
                          borderRadius: '5px',
                          background: theme.chipNormalBg,
                          border: `1px solid ${theme.borderStrong}`,
                          color: theme.textPrimary,
                          fontSize: '12px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px'
                        }
                      }, [
                        h(Icon, { name: 'refresh', size: 13 }),
                        h('span', {}, '复用参数')
                      ]),

                      // 1. 进入对话探讨 (自动将工坊大图挂载为附件并切回主会话探讨)
                      h('button', {
                        type: 'button',
                        title: '将当前作品作为图片附件载入主会话，与 AI 展开专业美术探讨',
                        onClick: async () => {
                          if (!activeImage?.url) return;
                          try {
                            let file;
                            if (activeImage.url.startsWith('data:')) {
                              file = dataURLtoFile(activeImage.url, `winetoken_${Date.now()}.png`);
                            } else {
                              const blob = await fetch(activeImage.url).then(r => r.blob());
                              file = new File([blob], `winetoken_${Date.now()}.png`, { type: blob.type || 'image/png' });
                            }
                            if (!file) throw new Error('无法转换图片为标准文件');

                            // 查找并注入 Composer
                            const fileInput = document.querySelector('[data-composer-card] input[type="file"]')
                                           || document.querySelector('input[type="file"][hidden]');
                            if (fileInput) {
                              const dt = new DataTransfer();
                              dt.items.add(file);
                              fileInput.files = dt.files;
                              fileInput.dispatchEvent(new Event('change', { bubbles: true }));
                            } else {
                              const dt = new DataTransfer();
                              dt.items.add(file);
                              document.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
                            }

                            // 切换视图回主对话
                            if (window.__dsh_layout_selectPanel) {
                              window.__dsh_layout_selectPanel(null);
                            }

                            // 预置结构化探讨提示词
                            setTimeout(() => {
                              const editor = document.querySelector('[data-composer-card] [contenteditable="true"]')
                                          || document.querySelector('[data-composer-card] textarea');
                              if (editor) {
                                const promptTpl = `请针对我在创作工坊刚刚生成的这幅作品（模型: ${activeImage.model}，尺寸: ${activeImage.size || '1024x1024'}）：\n【原始提示词】: "${activeImage.prompt}"\n请从构图节奏、光影层次与细节表现做专业美术审阅，并为它构思一段背景故事设定。`;
                                editor.focus();
                                if (editor.tagName === 'TEXTAREA') {
                                  editor.value = promptTpl;
                                  editor.dispatchEvent(new Event('input', { bubbles: true }));
                                } else {
                                  document.execCommand('selectAll', false, null);
                                  document.execCommand('insertText', false, promptTpl);
                                }
                              }
                            }, 350);
                          } catch (err) {
                            alert('导入对话探讨失败: ' + err.message);
                          }
                        },
                        style: {
                          padding: '5px 12px',
                          borderRadius: '5px',
                          background: theme.chipNormalBg,
                          border: `1px solid ${theme.borderStrong}`,
                          color: theme.textPrimary,
                          fontSize: '12px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px'
                        }
                      }, [
                        h(Icon, { name: 'messageSquare', size: 13 }),
                        h('span', {}, '进入对话探讨')
                      ]),

                      // 2. 以此图垫图重构
                      h('button', {
                        type: 'button',
                        title: '将当前作品置入左侧参考图槽位，作为垫图继续重构或修改',
                        onClick: () => {
                          if (!activeImage?.url) return;
                          const newSlot = {
                            id: 'slot_' + Date.now(),
                            index: 1,
                            name: '垫图参考',
                            dataUrl: activeImage.url,
                            size: activeImage.size || '1024x1024'
                          };
                          setReferenceSlots([newSlot]);
                          setMode('image');
                          if (activeImage.prompt && !prompt.trim()) {
                            setPrompt(activeImage.prompt);
                          }
                          alert('已将当前作品载入为【参考图1 (垫图参考)】，可在左侧提示词中继续调整！');
                        },
                        style: {
                          padding: '5px 12px',
                          borderRadius: '5px',
                          background: theme.chipNormalBg,
                          border: `1px solid ${theme.borderStrong}`,
                          color: theme.textPrimary,
                          fontSize: '12px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px'
                        }
                      }, [
                        h(Icon, { name: 'palette', size: 13 }),
                        h('span', {}, '以此图垫图重构')
                      ]),

                      // 3. 复制图像 (支持直接在 DSH 对话框 Ctrl+V 粘贴)
                      h('button', {
                        type: 'button',
                        title: '复制图片到剪贴板，可直接在主对话框按 Ctrl+V 粘贴',
                        onClick: async () => {
                          if (!activeImage?.url) return;
                          try {
                            let blob;
                            if (activeImage.url.startsWith('data:')) {
                              const b64 = activeImage.url.split(',')[1];
                              const byteChars = atob(b64);
                              const byteNums = new Array(byteChars.length);
                              for (let i = 0; i < byteChars.length; i++) byteNums[i] = byteChars.charCodeAt(i);
                              blob = new Blob([new Uint8Array(byteNums)], { type: 'image/png' });
                            } else {
                              blob = await fetch(activeImage.url).then(r => r.blob());
                            }
                            if (typeof navigator !== 'undefined' && navigator.clipboard && window.ClipboardItem) {
                              await navigator.clipboard.write([
                                new ClipboardItem({ [blob.type || 'image/png']: blob })
                              ]);
                              alert('已复制图像到剪贴板！切回主对话框按 Ctrl + V 即可直接粘贴作为附件发送。');
                            } else {
                              throw new Error('当前环境不支持直接写入二进制图片剪贴板');
                            }
                          } catch (err) {
                            navigator.clipboard.writeText(activeImage.url);
                            alert('已复制图片直链到剪贴板！');
                          }
                        },
                        style: {
                          padding: '5px 12px',
                          borderRadius: '5px',
                          background: theme.chipNormalBg,
                          border: `1px solid ${theme.borderStrong}`,
                          color: theme.textPrimary,
                          fontSize: '12px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px'
                        }
                      }, [
                        h(Icon, { name: 'copy', size: 13 }),
                        h('span', {}, '复制图像 (可Ctrl+V)')
                      ]),

                      // 4. 复制 Markdown 引用
                      h('button', {
                        type: 'button',
                        title: '复制 Markdown 格式图片代码，可在任何文本框中引用',
                        onClick: () => {
                          if (!activeImage?.url) return;
                          const md = `![${(activeImage.prompt || 'image').slice(0, 30)}](${activeImage.url})`;
                          navigator.clipboard.writeText(md);
                          alert('已复制 Markdown 引用代码：\n' + md);
                        },
                        style: {
                          padding: '5px 12px',
                          borderRadius: '5px',
                          background: theme.chipNormalBg,
                          border: `1px solid ${theme.borderStrong}`,
                          color: theme.textPrimary,
                          fontSize: '12px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px'
                        }
                      }, [
                        h(Icon, { name: 'externalLink', size: 13 }),
                        h('span', {}, '复制 MD 引用')
                      ])
                    ])
                  ]) : h('div', {
                    style: {
                      textAlign: 'center',
                      color: theme.textMuted,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '12px',
                      maxWidth: '360px',
                      padding: '20px'
                    }
                  }, [
                    h('div', {
                      style: {
                        width: '64px',
                        height: '64px',
                        borderRadius: '16px',
                        background: theme.emptyBoxBg,
                        border: `1px solid ${theme.emptyBoxBorder}`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: theme.textMuted
                      }
                    }, h(Icon, { name: isGenerating ? 'spinner' : 'imageEmpty', size: 28, style: isGenerating ? { animation: 'spin 1s linear infinite' } : {} })),
                    h('div', {}, [
                      h('h4', { style: { margin: '0 0 6px 0', fontSize: '14px', fontWeight: '600', color: theme.textPrimary } },
                        isGenerating ? 'AI 正在全力渲染' : '创作就绪 (Ready)'
                      ),
                      h('p', { style: { margin: '0', fontSize: '12px', color: theme.textMuted, lineHeight: '1.5' } },
                        isGenerating ? (statusMsg || '请稍候片刻，正在生成高分辨率细节...') : (
                          mode === 'video'
                            ? (firstFrame
                                ? '已设置首帧画面，点击「提交生视频」即可开始渲染'
                                : '在左侧配置模型或上传首帧画面，点击「提交生视频」即可在此呈现成果')
                            : (referenceSlots.length > 0 ? `已选择 ${referenceSlots.length} 张参考图，点击「立即垫图生成」即可开始` : '在左侧配置模型或上传参考底图，点击「立即生成」即可在此呈现成果')
                        )
                      )
                    ])
                  ])
                ]),

                // 底部历史创作展台 (自适应)
                history.length > 0 && h('div', {
                  style: {
                    background: theme.bgCard,
                    borderRadius: '10px',
                    border: `1px solid ${theme.borderSubtle}`,
                    padding: '14px 16px'
                  }
                }, [
                  h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' } }, [
                    h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [
                      h('span', { style: { fontSize: '12px', color: theme.textPrimary, fontWeight: '600' } }, '创作历史'),
                      h('span', {
                        style: {
                          fontSize: '11px',
                          background: theme.chipNormalBg,
                          border: `1px solid ${theme.borderSubtle}`,
                          color: theme.textSecondary,
                          padding: '1px 6px',
                          borderRadius: '10px'
                        }
                      }, history.length)
                    ]),
                    h('button', {
                      type: 'button',
                      style: {
                        background: 'transparent',
                        border: 'none',
                        color: theme.textMuted,
                        fontSize: '11px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px'
                      },
                      onMouseEnter: (e) => { e.currentTarget.style.color = '#ef4444'; },
                      onMouseLeave: (e) => { e.currentTarget.style.color = theme.textMuted; },
                      onClick: () => {
                        if (confirm('确认清空本地创作历史？')) {
                          setHistory([]);
                          setActiveImage(null);
                          localStorage.removeItem('WINETOKEN_STUDIO_HISTORY');
                        }
                      }
                    }, [
                      h(Icon, { name: 'trash', size: 12 }),
                      h('span', {}, '清空')
                    ])
                  ]),
                  h('div', {
                    style: {
                      display: 'flex',
                      gap: '10px',
                      overflowX: 'auto',
                      paddingBottom: '4px'
                    }
                  }, history.map((item, idx) => {
                    const isSelected = activeImage?.url === item.url;
                    return h('div', {
                      key: idx,
                      onClick: () => setActiveImage(item),
                      onDoubleClick: () => handleOpenMediaFile(item),
                      title: `${item.prompt || ''}\n(单击选中展台，双击直接以文件打开)`,
                      style: {
                        width: '74px',
                        height: '74px',
                        flexShrink: 0,
                        borderRadius: '6px',
                        overflow: 'hidden',
                        cursor: 'pointer',
                        border: isSelected ? `2px solid ${theme.imgSelectedBorder}` : `1px solid ${theme.imgBorder}`,
                        boxShadow: isSelected ? (theme.isDark ? '0 0 10px rgba(255,255,255,0.2)' : '0 0 10px rgba(0,0,0,0.15)') : 'none',
                        transition: 'all 0.15s ease',
                        position: 'relative'
                      }
                    }, [
                      (item.type === 'video' || (typeof item.url === 'string' && item.url.includes('.mp4')))
                        ? h('div', {
                            style: {
                              width: '100%',
                              height: '100%',
                              background: theme.isDark ? '#111827' : '#f3f4f6',
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: theme.textSecondary
                            }
                          }, [
                            h(Icon, { name: 'video', size: 22 }),
                            h('span', { style: { fontSize: '9px', marginTop: '2px', fontWeight: '500' } }, '视频')
                          ])
                        : h('img', {
                            src: item.url,
                            alt: item.prompt,
                            style: { width: '100%', height: '100%', objectFit: 'cover' }
                          }),
                      item.hasRef && h('div', {
                        style: {
                          position: 'absolute',
                          top: '2px',
                          right: '2px',
                          background: 'rgba(0,0,0,0.7)',
                          color: '#22c55e',
                          fontSize: '9px',
                          padding: '1px 3px',
                          borderRadius: '3px'
                        }
                      }, '垫图')
                    ]);
                  }))
                ])
              ])
            ]),

            // 3. 画布新手引导层 (SVG evenodd 探照灯反向遮罩，可一键跳过与持久化记忆)
            h(CanvasOnboardingTutorial, {
              isOpen: showTutorial,
              onClose: () => setShowTutorial(false)
            })
          ]);
        }

        // 4. 底部状态栏组件 (WineTokenPill)
        function WineTokenPill() {
          const theme = useTheme();
          const [state, setState] = React.useState({ ...billingState });
          const [showPopover, setShowPopover] = React.useState(false);

          React.useEffect(() => {
            const listener = (b) => setState(b);
            listeners.add(listener);
            return () => listeners.delete(listener);
          }, []);

          // 冷启动新用户友好引导：未配置 Key 时延时 800ms 平滑弹出配置卡片 (单会话防打扰)
          React.useEffect(() => {
            const currentKey = WineTokenCredentialBridge.readKey();
            if (!currentKey) {
              let hasSeen = false;
              try {
                hasSeen = !!sessionStorage.getItem('WINETOKEN_ONBOARDING_SEEN');
              } catch (_) {}
              if (!hasSeen) {
                try {
                  sessionStorage.setItem('WINETOKEN_ONBOARDING_SEEN', '1');
                } catch (_) {}
                const timer = setTimeout(() => {
                  setShowPopover(true);
                }, 800);
                return () => clearTimeout(timer);
              }
            }
          }, []);

          let progressBar = null;
          if (state.hasSubscription) {
            const pct = state.subUsedPercent;
            const barColor = pct >= 90 ? '#ef4444' : (pct >= 75 ? '#f59e0b' : (theme.isDark ? '#ffffff' : '#111827'));

            progressBar = h('span', {
              style: {
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                marginLeft: '4px'
              }
            }, [
              h('span', { style: { opacity: 0.35 } }, '·'),
              h('span', {
                style: {
                  width: '32px',
                  height: '4px',
                  borderRadius: '2px',
                  background: theme.isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.1)',
                  display: 'inline-block',
                  overflow: 'hidden',
                  verticalAlign: 'middle'
                }
              }, h('span', {
                style: {
                  display: 'block',
                  width: `${pct}%`,
                  height: '100%',
                  background: barColor,
                  borderRadius: '2px',
                  transition: 'width 0.3s ease'
                }
              })),
              h('span', { style: { fontSize: '10px', opacity: 0.8, fontFamily: 'monospace' } }, `${pct}%`)
            ]);
          }

          return h('span', {
            className: 'hNGZaa_anchor',
            'data-composer-stat': 'winetoken-balance',
            style: { position: 'relative', display: 'inline-block' }
          }, [
            h('button', {
              type: 'button',
              className: 'hNGZaa_pill',
              style: {
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                userSelect: 'none'
              },
              onClick: (e) => {
                e.stopPropagation();
                setShowPopover((prev) => !prev);
              }
            }, [
              state.isSuper ? h('span', {
                style: {
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontWeight: '600',
                  letterSpacing: '-0.1px'
                }
              }, [
                h(Icon, { name: 'crown', size: 12, style: { color: '#06b6d4' } }),
                h('span', { style: { color: '#06b6d4', fontWeight: '700', letterSpacing: '0.4px' } }, 'SUPER'),
                h('span', { style: { opacity: 0.35, margin: '0 3px' } }, '·'),
                h('span', { style: { fontWeight: '500' } }, '钱包 ¥' + formatCNY(state.walletBalanceCNY))
              ]) : (state.pillText === '未配置 Key' ? h('span', {
                style: {
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontWeight: '500',
                  color: theme.isDark ? '#38bdf8' : '#0284c7'
                }
              }, [
                h(Icon, { name: 'keyIcon', size: 12 }),
                h('span', {}, '未配置 Key')
              ]) : h('span', {
                style: {
                  fontWeight: '500',
                  letterSpacing: '-0.1px'
                }
              }, state.pillText)),
              (!state.hasSubscription && !state.isSuper) && h('span', {
                style: {
                  opacity: 0.35,
                  margin: '0 4px'
                }
              }, '·'),
              (!state.hasSubscription && !state.isSuper) && h('span', {
                style: {
                  fontWeight: '500',
                  letterSpacing: '-0.1px'
                }
              }, state.usedText),
              (!state.isSuper) && progressBar
            ]),
            showPopover && h(WineTokenAccountPopover, {
              onClose: () => setShowPopover(false)
            })
          ]);
        }

        return {
          inject: ['slots', 'layout', 'remote'],
          apply(ctx) {
            // 暴露全局切换视图句柄
            if (typeof window !== 'undefined') {
              window.__dsh_layout_selectPanel = (panelId) => {
                try { ctx.layout.selectPanel(panelId); } catch (_) {}
              };
            }

            // 挂载 DSH 官方凭据 Remote 服务面 (ctx.remote.credentials.set/unset/describe)
            // 沙箱化桌面端保存密钥的唯一官方通道，写入即落盘 ~/.dsh/.credentials.yaml
            try {
              window.__winetoken_remote_credentials = (ctx.remote && ctx.remote.credentials) || null;
            } catch (_) {
              window.__winetoken_remote_credentials = null;
            }

            // 1. 状态栏余额与账户中心
            ctx.slots.inject('conversation.composer.dock', function* () {
              yield ctx.slots.register({
                name: 'conversation.composer.dock',
                id: 'winetoken-balance',
                order: 2
              }, WineTokenPill);
            });

            // 2. 方案 A：左侧导航栏项 (紧跟在自动化任务 order: 10 的下方)
            ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
              name: 'sidebar.panellist',
              id: 'winetoken-studio',
              order: 20,
              label: () => '创作工坊'
            }, StudioNavIcon));

            // 3. 注册主视图工作台
            ctx.slots.inject('main', function* () {
              yield ctx.slots.register({
                name: 'main',
                key: 'winetoken-studio'
              }, StudioPage);
            });
          }
        };
      }
    });
  }

  if (typeof module !== 'undefined') {
    module.exports = {
      updateBilling,
      validateImageModelSupport,
      buildImageRequest,
      sendImageRequest,
      createStudioHistoryItem,
      updateHistoryLocalPath,
      dataURLtoFile,
      snapAspectRatio
    };
  }
})();

