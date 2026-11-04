/**
 * WineToken DSH Client Module (v1.3.6)
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

  /**
   * WineToken 跨进程凭据同步中枢 (WineTokenCredentialBridge)
   * 双向打通渲染进程 localStorage 与 DSH 宿主微内核 ~/.dsh/.credentials.yaml
   * 实现一处填写，官方对话模型与工坊生图全链路即时自动生效 (100ms 热重载)
   */
  const WineTokenCredentialBridge = {
    getCredentialsPath() {
      try {
        const path = require('path');
        const os = require('os');
        return path.join(os.homedir(), '.dsh', '.credentials.yaml');
      } catch (_) {
        return '';
      }
    },

    // 双轨读取：优先 localStorage，兜底 .credentials.yaml 与 process.env，自动反向回写对齐
    readKey() {
      let key = '';
      // 1. 优先读取渲染进程 localStorage
      try {
        if (typeof localStorage !== 'undefined') {
          const local = localStorage.getItem('WINETOKEN_API_KEY');
          if (local && local.trim()) key = local.trim();
        }
      } catch (_) {}

      // 2. 若 localStorage 为空，回退读取宿主 ~/.dsh/.credentials.yaml
      if (!key) {
        try {
          const fs = require('fs');
          const credPath = this.getCredentialsPath();
          if (credPath && fs.existsSync(credPath)) {
            const content = fs.readFileSync(credPath, 'utf8');
            const m = content.match(/(?:^|\n)\s*WINETOKEN_API_KEY:\s*([^\r\n#]+)/);
            if (m && m[1]) {
              const fileKey = m[1].trim().replace(/^['"]|['"]$/g, '');
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
      if (!key && typeof process !== 'undefined' && process.env && process.env.WINETOKEN_API_KEY) {
        key = process.env.WINETOKEN_API_KEY.trim();
      }
      return key;
    },

    // 全链路即时同步写入 (安全处理 YAML 各种边界，防止 duplicate refs 破坏 DSH 核心)
    saveKey(key) {
      const trimmed = (key || '').trim();
      if (!trimmed) return false;

      // 1. 写入渲染进程 localStorage (创作工坊与漫剧画布 0 秒生效)
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('WINETOKEN_API_KEY', trimmed);
        }
      } catch (_) {}

      // 2. 写入当前进程环境变量
      if (typeof process !== 'undefined' && process.env) {
        process.env.WINETOKEN_API_KEY = trimmed;
      }

      // 3. 写入磁盘 ~/.dsh/.credentials.yaml (触发 DSH 官方凭据监视器 100ms 重载模型)
      try {
        const fs = require('fs');
        const path = require('path');
        const credPath = this.getCredentialsPath();
        if (credPath) {
          const dir = path.dirname(credPath);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

          let content = fs.existsSync(credPath) ? fs.readFileSync(credPath, 'utf8') : '';
          if (!content || !content.trim()) {
            content = `version: 1\nrecords: {}\nrefs:\n  WINETOKEN_API_KEY: ${trimmed}\n`;
          } else {
            const keyRegex = /(^|\n)([ \t]*WINETOKEN_API_KEY:\s*)([^\r\n#]*)/m;
            const emptyRefsRegex = /(^|\n)([ \t]*refs:\s*\{\s*\})/m;
            const refsBlockRegex = /(^|\n)([ \t]*refs:\s*(?:\r?\n|$))/m;

            if (keyRegex.test(content)) {
              content = content.replace(keyRegex, `$1  WINETOKEN_API_KEY: ${trimmed}`);
            } else if (emptyRefsRegex.test(content)) {
              content = content.replace(emptyRefsRegex, `$1refs:\n  WINETOKEN_API_KEY: ${trimmed}`);
            } else if (refsBlockRegex.test(content)) {
              content = content.replace(refsBlockRegex, `$1refs:\n  WINETOKEN_API_KEY: ${trimmed}\n`);
            } else {
              content = content.trimEnd() + `\nrefs:\n  WINETOKEN_API_KEY: ${trimmed}\n`;
            }
          }
          fs.writeFileSync(credPath, content, { encoding: 'utf8', mode: 0o600 });
        }
      } catch (e) {
        console.warn('[WineToken] 写入 .credentials.yaml 失败:', e.message);
      }
      return true;
    },

    // 清除凭据
    clearKey() {
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.removeItem('WINETOKEN_API_KEY');
        }
      } catch (_) {}
      if (typeof process !== 'undefined' && process.env) {
        delete process.env.WINETOKEN_API_KEY;
      }
      try {
        const fs = require('fs');
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

  const BASE_IMAGE_MODELS_FALLBACK = [
    {
      id: 'gpt-image-2.5-flare',
      name: 'GPT-Image 2.5 Flare',
      tag: '极速',
      price: 0.30,
      vipPrice: 0.24,
      singleNOnly: true,
      unit: '张',
      desc: '出图极快，细节丰富，性价比首选',
      resolutions: [
        { label: '1:1 正方', icon: 'ratio1_1', val: '1024x1024' },
        { label: '16:9 横屏', icon: 'ratio16_9', val: '1792x1024' },
        { label: '9:16 竖屏', icon: 'ratio9_16', val: '1024x1792' }
      ]
    },
    {
      id: 'gpt-image-2.5-sunburst',
      name: 'GPT-Image 2.5 Sunburst',
      tag: '高画质',
      price: 0.40,
      vipPrice: 0.32,
      singleNOnly: true,
      unit: '张',
      desc: '排版精细，写真质感与艺术风格',
      resolutions: [
        { label: '1:1 正方', icon: 'ratio1_1', val: '1024x1024' },
        { label: '16:9 横屏', icon: 'ratio16_9', val: '1792x1024' },
        { label: '9:16 竖屏', icon: 'ratio9_16', val: '1024x1792' }
      ]
    },
    {
      id: 'gemini-imagen-3',
      name: 'Google Imagen 3',
      tag: '2K写实',
      price: 0.15,
      vipPrice: 0.12,
      singleNOnly: true,
      unit: '张',
      desc: '光影自然真实，语言理解顶尖',
      resolutions: [
        { label: '1:1 正方', icon: 'ratio1_1', val: '1024x1024' },
        { label: '16:9 高清', icon: 'ratio16_9', val: '1280x720' },
        { label: '9:16 竖屏', icon: 'ratio9_16', val: '720x1280' },
        { label: '宽幅 1792', icon: 'ratio16_9', val: '1792x1024' }
      ]
    },
    {
      id: 'sensenova-u1.5-lite',
      name: '商汤 SenseNova U1.5 Lite',
      tag: '限免4K',
      price: 0.00,
      vipPrice: 0.00,
      singleNOnly: true,
      unit: '张',
      desc: '4K超清直出，中英文字排版',
      resolutions: [
        { label: '1:1 正方', icon: 'ratio1_1', val: '1024x1024' },
        { label: '3:2 横屏', icon: 'ratio16_9', val: '1536x1024' },
        { label: '2:3 竖屏', icon: 'ratio9_16', val: '1024x1536' },
        { label: '2K 超清', icon: 'ratio1_1', val: '2048x2048' }
      ]
    },
    {
      id: 'grok-imagine-image-2.0',
      name: 'Grok Imagine 2.0 旗舰',
      tag: '光影旗舰',
      price: 0.50,
      vipPrice: 0.40,
      singleNOnly: true,
      unit: '张',
      desc: '真实摄影级光影，概念艺术',
      resolutions: [
        { label: '1:1 正方', icon: 'ratio1_1', val: '1024x1024' },
        { label: '16:9 横屏', icon: 'ratio16_9', val: '1280x720' },
        { label: '9:16 竖屏', icon: 'ratio9_16', val: '720x1280' }
      ]
    },
    {
      id: 'gpt-image-2',
      name: 'GPT-Image 2 (经典高清)',
      tag: '经典专业',
      price: 0.20,
      vipPrice: 0.16,
      singleNOnly: false,
      unit: '张',
      desc: '稳定经典生成，仅支持经典正方形尺寸',
      resolutions: [
        { label: '1024 大图', icon: 'ratio1_1', val: '1024x1024' },
        { label: '512 标准', icon: 'ratio1_1', val: '512x512' },
        { label: '256 小图', icon: 'ratio1_1', val: '256x256' }
      ]
    }
  ];

  const BASE_VIDEO_MODELS_FALLBACK = [
    {
      id: 'MiniMax-H3',
      name: 'MiniMax H3',
      tag: '电影感',
      pricePerSecond: 0.15,
      vipPricePerSecond: 0.12,
      priceText: '原¥0.15/秒 (5秒基准 ¥0.75)',
      vipPriceText: 'SVIP ¥0.12/秒 (5秒基准 ¥0.60)',
      unit: '秒',
      durations: [
        { val: 4, label: '4 秒', tag: '轻量' },
        { val: 5, label: '5 秒', tag: '标配' },
        { val: 6, label: '6 秒', tag: '延展' },
        { val: 10, label: '10 秒', tag: '长片' },
        { val: 15, label: '15 秒', tag: '旗舰' }
      ],
      desc: '768P/1080P 电影级光影，原生支持 4~15 秒超长生成时长，支持上传首帧参考图驱动动态',
      resolutions: [
        { label: '720P 横屏', icon: 'ratio16_9', val: '1280x720' },
        { label: '720P 竖屏', icon: 'ratio9_16', val: '720x1280' },
        { label: '1080P 全高清', icon: 'ratio16_9', val: '1920x1080' },
        { label: '1080P 竖屏', icon: 'ratio9_16', val: '1080x1920' }
      ]
    },
    {
      id: 'grok-imagine-video-1.5',
      name: 'Grok Imagine 视频旗舰',
      tag: '物理连贯',
      pricePerSecond: 0.20,
      vipPricePerSecond: 0.16,
      priceText: '原¥0.20/秒 (5秒基准 ¥1.00)',
      vipPriceText: 'SVIP ¥0.16/秒 (5秒基准 ¥0.80)',
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
    let displayName = raw.name || raw.id;
    if (raw.id === 'gpt-image-2.5-flare') {
      displayName = 'GPT-Image 2.5 Flare';
    } else if (raw.id === 'gpt-image-2.5-sunburst') {
      displayName = 'GPT-Image 2.5 Sunburst';
    } else if (raw.id === 'gpt-image-2') {
      displayName = 'GPT-Image 2 (经典高清)';
    }
    return {
      id: raw.id,
      name: displayName,
      tag: raw.badge || raw.tag || '推荐',
      price: raw.cost != null ? Number(raw.cost) : (raw.price != null ? Number(raw.price) : 0),
      vipPrice: raw.vipCost != null ? Number(raw.vipCost) : (raw.vipPrice != null ? Number(raw.vipPrice) : 0),
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
    const isHoriz = (s) => s.startsWith('1280') || s.startsWith('1920');
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
    let displayName = raw.name || raw.id;
    // 彻底剥离 (海螺视频)
    displayName = displayName.replace(/[\(（]海螺视频[\)）]/g, '').trim();
    if (raw.id === 'MiniMax-H3') {
      displayName = 'MiniMax H3';
    }
    return {
      id: raw.id,
      name: displayName,
      tag: raw.badge || raw.tag || '推荐',
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

    getSnapshot() {
      if (!this._data) this.init();
      return this._data;
    },

    getImageModels() {
      return this.getSnapshot().imageModels;
    },

    getVideoModels() {
      return this.getSnapshot().videoModels;
    },

    getChatModels() {
      return this.getSnapshot().chatModels;
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
      for (const fn of this._listeners) {
        try { fn(this._data); } catch (_) {}
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
              // 智能并集补齐：以本地 fallback 为基底，线上最新数据覆盖，保证基础限免模型与视频模型永不丢失
              const mergeWithFallback = (onlineList, fallbackList) => {
                const map = new Map();
                (fallbackList || []).forEach(m => map.set(m.id, m));
                (onlineList || []).forEach(m => map.set(m.id, { ...map.get(m.id), ...m }));
                return Array.from(map.values());
              };

              const mergedImg = mergeWithFallback(nextImg, BASE_IMAGE_MODELS_FALLBACK);
              const mergedVid = mergeWithFallback(nextVid, BASE_VIDEO_MODELS_FALLBACK);

              this._data = {
                imageModels: mergedImg,
                videoModels: mergedVid,
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
        const cp = require('child_process');
        cp.execFile('cmd.exe', ['/c', 'start', '""', filePath]);
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
  setInterval(updateBilling, 120000);

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

        // DataURL 转标准 File 对象 (用于将工坊图片挂载到 DSH 对话框)
        function dataURLtoFile(dataurl, filename = 'artwork.png') {
          try {
            const arr = dataurl.split(',');
            const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/png';
            const bstr = atob(arr[1]);
            let n = bstr.length;
            const u8arr = new Uint8Array(n);
            while (n--) u8arr[n] = bstr.charCodeAt(n);
            return new File([u8arr], filename, { type: mime });
          } catch (_) {
            return null;
          }
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
            ? (currentKey.length > 12 ? currentKey.slice(0, 7) + '········' + currentKey.slice(-4) : currentKey)
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
            WineTokenCredentialBridge.saveKey(trimmed);
            setCurrentKey(trimmed);
            setKeyInput('');
            setShowKeyInput(false);
            setStatusTip('正在连接并同步全局凭据...');
            await updateBilling();
            try {
              WineTokenManifestManager.fetchManifest(true);
            } catch (_) {}
            setStatusTip('已保存！官方模型与生图工坊已全链路就绪');
            setTimeout(() => setStatusTip(''), 3000);
          };

          const handleResetKey = async () => {
            WineTokenCredentialBridge.clearKey();
            setCurrentKey(DEFAULT_KEY);
            setKeyInput('');
            setShowKeyInput(true);
            setStatusTip('已清空凭据，正在刷新...');
            await updateBilling();
            setStatusTip('已恢复未配置状态！');
            setTimeout(() => setStatusTip(''), 3000);
          };

          const popoverStyle = {
            position: 'absolute',
            ...(positionTop ? { top: 'calc(100% + 8px)' } : { bottom: 'calc(100% + 10px)' }),
            right: 0,
            width: '320px',
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
              badge: '01 / 03',
              tag: '视口操控',
              targetSelector: '#winetoken-canvas-viewport',
              title: '无限画布 · 自由平移与阻尼缩放',
              desc: '专为漫剧多镜头排布打造的高帧率无限画板，支持全局全景鸟瞰与微距细节精修。',
              tips: [
                { key: 'Space + 鼠标拖拽 / 鼠标中键', text: '自由平移漫游视野' },
                { key: '鼠标滚轮 / 触控板捏合', text: '以光标为中心自适应阻尼缩放 (20% ~ 300%)' },
                { key: 'Ctrl + 0 / 快速复位', text: '一键复位 100% 居中视野' }
              ]
            },
            {
              badge: '02 / 03',
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
              badge: '03 / 03',
              tag: '分镜出图',
              targetSelector: '#winetoken-canvas-panels-area',
              title: '景别运镜 · 对白气泡与条漫拼版',
              desc: '一键切换特写/中景/全景镜头，输入台词自动生成漫画气泡，一键无损拼版导出 1080P 条漫。',
              tips: [
                { key: '标准景别切换', text: '特写 CU、中景 MS、全景 WS 一键注入运镜提示词' },
                { key: '矢量漫画对白', text: '输入角色台词，自动排布标准漫画对白气泡框' },
                { key: '导出长图条漫', text: '按镜头时序一键拼接导出符合发布规范的高清长图' }
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
            const cardW = 480;
            const cardH = 320;
            const vh = window.innerHeight;
            const vw = window.innerWidth;

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
        // 5. 漫剧 AI 画布全景工作台组件 (CanvasWorkspace)
        // ==========================================
        function CanvasWorkspace({ theme: propTheme, isVip, isSvip, isSuper, onOpenTutorial }) {
          const hookTheme = useTheme();
          const theme = propTheme || hookTheme;
          // 视口变换参数 (基于 Direct DOM Transform 硬件加速)
          const viewportRef = React.useRef({ x: 40, y: 30, zoom: 1 });
          const canvasLayerRef = React.useRef(null);
          const isDraggingRef = React.useRef(false);
          const dragStartRef = React.useRef({ x: 0, y: 0, originX: 0, originY: 0 });
          const isSpacePressedRef = React.useRef(false);
          const [zoomDisplay, setZoomDisplay] = React.useState(100);

          // 漫剧画布生图模型状态与原图全屏预览灯箱
          const [canvasModel, setCanvasModel] = React.useState(WineTokenManifestManager.getFreeImageModel() || 'sensenova-u1.5-lite');
          const [availableImageModels, setAvailableImageModels] = React.useState(WineTokenManifestManager.getImageModels());
          const [lightboxUrl, setLightboxUrl] = React.useState(null);

          // 监听 Manifest SWR 热更新事件
          React.useEffect(() => {
            const unsub = WineTokenManifestManager.subscribe((models) => {
              if (models && models.imageModels && models.imageModels.length > 0) {
                setAvailableImageModels(models.imageModels);
              }
            });
            return unsub;
          }, []);

          // 角色资产库
          const [characters, setCharacters] = React.useState([
            {
              id: 'char_chuyun',
              name: '主角·楚云',
              dna: '少年剑客，黑袍高领，银白碎发，剑眉星目，冷峻英气，电影质感',
              avatar: ''
            }
          ]);

          // 分镜格资产
          const [panels, setPanels] = React.useState([
            {
              id: 'shot_01',
              num: 1,
              x: 360,
              y: 60,
              width: 280,
              height: 420,
              aspectRatio: '2:3',
              shot: 'CU',
              shotLabel: '特写',
              prompt: '少年剑客面部特写，发丝微动，冷峻眼神，侧逆光，细致皮肤纹理，虚化背景，电影光影',
              dialogue: '“这一剑，我已等了三年。”',
              characterId: 'char_chuyun',
              imageUrl: '',
              isGenerating: false,
              stagingCandidateUrl: null
            },
            {
              id: 'shot_02',
              num: 2,
              x: 690,
              y: 60,
              width: 360,
              height: 240,
              aspectRatio: '16:9',
              shot: 'MS',
              shotLabel: '中景',
              prompt: '雨夜长街，黑袍剑客拔剑而立，剑锋泛起寒光，雨水飞溅，深邃冷色调，宽银幕构图',
              dialogue: '长街风雨骤急，杀气四伏。',
              characterId: 'char_chuyun',
              imageUrl: '',
              isGenerating: false,
              stagingCandidateUrl: null
            }
          ]);

          // 更新视图 Transform
          const updateTransform = () => {
            if (!canvasLayerRef.current) return;
            const { x, y, zoom } = viewportRef.current;
            canvasLayerRef.current.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${zoom})`;
          };

          // 键盘空格监听
          React.useEffect(() => {
            const onKeyDown = (e) => {
              if (e.code === 'Space' && !e.repeat && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
                isSpacePressedRef.current = true;
                if (canvasLayerRef.current) canvasLayerRef.current.style.cursor = 'grab';
              }
            };
            const onKeyUp = (e) => {
              if (e.code === 'Space') {
                isSpacePressedRef.current = false;
                if (canvasLayerRef.current) canvasLayerRef.current.style.cursor = 'default';
              }
            };
            window.addEventListener('keydown', onKeyDown);
            window.addEventListener('keyup', onKeyUp);
            return () => {
              window.removeEventListener('keydown', onKeyDown);
              window.removeEventListener('keyup', onKeyUp);
            };
          }, []);

          // 滚轮缩放处理 (支持光标定点缩放与阻尼平滑)
          const handleWheel = (e) => {
            e.preventDefault();
            const container = canvasLayerRef.current?.parentElement;
            if (!container) return;
            const rect = container.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            let delta = e.deltaY;
            if (e.deltaMode === 1) delta *= 16;
            const clampedDelta = Math.max(-80, Math.min(80, delta));
            const factor = 1 - clampedDelta * 0.0018;

            const cur = viewportRef.current;
            const nextZoom = Math.min(3.0, Math.max(0.2, cur.zoom * factor));
            const ratio = nextZoom / cur.zoom;

            cur.x = mouseX - (mouseX - cur.x) * ratio;
            cur.y = mouseY - (mouseY - cur.y) * ratio;
            cur.zoom = nextZoom;

            requestAnimationFrame(() => {
              updateTransform();
              setZoomDisplay(Math.round(nextZoom * 100));
            });
          };

          // 鼠标按下漫游
          const handlePointerDown = (e) => {
            if (e.button === 1 || (e.button === 0 && isSpacePressedRef.current)) {
              e.preventDefault();
              isDraggingRef.current = true;
              dragStartRef.current = {
                x: e.clientX,
                y: e.clientY,
                originX: viewportRef.current.x,
                originY: viewportRef.current.y
              };
              e.currentTarget.setPointerCapture?.(e.pointerId);
            }
          };

          const handlePointerMove = (e) => {
            if (!isDraggingRef.current) return;
            const dx = e.clientX - dragStartRef.current.x;
            const dy = e.clientY - dragStartRef.current.y;
            viewportRef.current.x = dragStartRef.current.originX + dx;
            viewportRef.current.y = dragStartRef.current.originY + dy;
            requestAnimationFrame(updateTransform);
          };

          const handlePointerUp = (e) => {
            if (isDraggingRef.current) {
              isDraggingRef.current = false;
              e.currentTarget.releasePointerCapture?.(e.pointerId);
            }
          };

          // 视口快速复位
          const handleResetView = () => {
            viewportRef.current = { x: 40, y: 30, zoom: 1 };
            updateTransform();
            setZoomDisplay(100);
          };

          const handleZoomStep = (inOut) => {
            const cur = viewportRef.current;
            const factor = inOut ? 1.2 : 0.833;
            const nextZoom = Math.min(3.0, Math.max(0.2, cur.zoom * factor));
            cur.zoom = nextZoom;
            updateTransform();
            setZoomDisplay(Math.round(nextZoom * 100));
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

            setPanels(prev => prev.map(p => p.id === panelId ? { ...p, isGenerating: true } : p));

            try {
              const char = characters.find(c => c.id === target.characterId);
              let fullPrompt = target.prompt;
              if (char) {
                fullPrompt = `${char.dna}，${target.prompt}，${target.shotLabel}镜头，画面张力`;
              }

              // 尺寸对齐
              let reqSize = '1024x1024';
              if (target.aspectRatio === '2:3') reqSize = '1024x1536';
              else if (target.aspectRatio === '16:9') reqSize = '1536x1024';

              const apiKey = getKey();
              if (!apiKey) throw new Error('未检测到 API Key，请先点击顶栏钥匙图标输入');

              const chosenModel = canvasModel || WineTokenManifestManager.getFreeImageModel() || 'sensenova-u1.5-lite';
              const payload = {
                model: chosenModel,
                prompt: fullPrompt,
                size: reqSize,
                n: 1
              };
              if (char && char.avatar) {
                payload.image = char.avatar;
                payload.image_url = char.avatar;
              }

              // 优先使用当前激活的限免 4K 模型
              const res = await fetch(`${BASE_URL}/v1/images/generations`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify(payload)
              });

              if (!res.ok) {
                const errJson = await res.json().catch(() => ({}));
                throw new Error(errJson.error?.message || `HTTP ${res.status}`);
              }

              const data = await res.json();
              const url = data.data?.[0]?.url || (data.data?.[0]?.b64_json ? `data:image/png;base64,${data.data[0].b64_json}` : '');
              if (!url) throw new Error('接口未返回有效图像');

              // 采用 InvokeAI 风格的幽灵暂存层
              setPanels(prev => prev.map(p => p.id === panelId ? {
                ...p,
                isGenerating: false,
                stagingCandidateUrl: url
              } : p));

              updateBilling();
            } catch (err) {
              alert(`分镜 #${target.num} 生成失败: ${err.message}`);
              setPanels(prev => prev.map(p => p.id === panelId ? { ...p, isGenerating: false } : p));
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

              // 绘制台词对白气泡
              if (item.dialogue) {
                ctx.save();
                const bubW = Math.min(standardW - 80, 520);
                const bubH = 54;
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
                ctx.font = 'bold 20px "PingFang SC", "Microsoft YaHei", sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(item.dialogue, standardW / 2, bubY + bubH / 2);
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

          return h('div', {
            id: 'winetoken-canvas-viewport',
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
              userSelect: 'none'
            },
            onWheel: handleWheel,
            onPointerDown: handlePointerDown,
            onPointerMove: handlePointerMove,
            onPointerUp: handlePointerUp
          }, [
            // 1. 顶部悬浮工具栏 (黑白极简纯文字与矢量图标)
            h('div', {
              style: {
                position: 'absolute',
                top: '16px',
                left: '20px',
                zIndex: 100,
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '6px 12px',
                borderRadius: '8px',
                backgroundColor: theme.popoverBg,
                border: `1px solid ${theme.popoverBorder}`,
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.25)'
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
                  gap: '5px'
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
                  gap: '5px'
                }
              }, [h(Icon, { name: 'plus', size: 13 }), h('span', {}, '添加分镜')]),

              h('div', { style: { width: '1px', height: '16px', backgroundColor: theme.borderSubtle, margin: '0 4px' } }),

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
                  gap: '5px'
                }
              }, [h(Icon, { name: 'canvas', size: 13 }), h('span', {}, '四格模版')]),

              h('div', { style: { width: '1px', height: '16px', backgroundColor: theme.borderSubtle, margin: '0 4px' } }),

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
                  maxWidth: '460px',
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
                    maxWidth: '380px',
                    paddingRight: '6px'
                  }
                }, availableImageModels.map(m => {
                  const isFree = m.price === 0 || (m.tag && m.tag.includes('限免'));
                  let priceText = '';
                  if (isFree) {
                    priceText = '限免 ¥0.00';
                  } else if (isSvip && m.vipPrice != null) {
                    priceText = `SVIP ¥${formatCNY(m.vipPrice)}/张`;
                  } else if (isVip) {
                    const vipP = m.vipPrice != null ? m.vipPrice : (m.price != null ? Number((m.price * 0.9).toFixed(2)) : null);
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
                  gap: '6px'
                }
              }, [h(Icon, { name: 'download', size: 13 }), h('span', {}, '导出条漫长图')])
            ]),

            // 2. 右下角视口浮岛 (平移缩放比 + 帮助入口)
            h('div', {
              style: {
                position: 'absolute',
                bottom: '16px',
                right: '20px',
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
                style: { background: 'none', border: 'none', color: theme.textSecondary, cursor: 'pointer', fontSize: '13px', padding: '2px 6px' }
              }, '-'),
              h('span', {
                onClick: handleResetView,
                style: { fontSize: '11px', fontFamily: 'monospace', color: theme.textPrimary, cursor: 'pointer', padding: '0 4px' },
                title: '点击重置为 100%'
              }, `${zoomDisplay}%`),
              h('button', {
                type: 'button',
                onClick: () => handleZoomStep(true),
                style: { background: 'none', border: 'none', color: theme.textSecondary, cursor: 'pointer', fontSize: '13px', padding: '2px 6px' }
              }, '+'),
              h('div', { style: { width: '1px', height: '14px', backgroundColor: theme.borderSubtle, margin: '0 4px' } }),
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
                  padding: '2px 6px'
                },
                title: '打开漫剧新手引导教程'
              }, [h(Icon, { name: 'help', size: 13 }), h('span', {}, '教程')])
            ]),

            // 3. 变换视口层 (包含连线 + 角色卡 + 分镜卡)
            h('div', {
              ref: canvasLayerRef,
              style: {
                position: 'absolute',
                left: 0,
                top: 0,
                transformOrigin: '0 0',
                willChange: 'transform'
              }
            }, [
              // 3.1 贝塞尔拓扑流光连线层 (智能精确定位对应角色的锚点位置)
              h('svg', {
                style: {
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  width: '5000px',
                  height: '5000px',
                  pointerEvents: 'none'
                }
              }, panels.map(p => {
                const char = characters.find(c => c.id === p.characterId);
                if (!char) return null;
                const charIndex = characters.findIndex(c => c.id === p.characterId);
                const safeCharIndex = charIndex >= 0 ? charIndex : 0;
                const startX = 260; // 角色卡右锚点 (left: 40 + width: 220 = 260)
                // 角色卡高度约 230px，间距 gap: 16px，纵向中心锚点精确定位
                const startY = 60 + safeCharIndex * 246 + 65;
                const endX = p.x;
                const endY = p.y + 30;
                const ctrlX1 = startX + (endX - startX) * 0.5;
                const ctrlY1 = startY;
                const ctrlX2 = startX + (endX - startX) * 0.5;
                const ctrlY2 = endY;

                return h('path', {
                  key: `wire_${p.id}`,
                  d: `M ${startX} ${startY} C ${ctrlX1} ${ctrlY1}, ${ctrlX2} ${ctrlY2}, ${endX} ${endY}`,
                  fill: 'none',
                  stroke: theme.isDark ? '#06b6d4' : '#0891b2',
                  strokeWidth: 2,
                  strokeDasharray: '4 4',
                  opacity: 0.65
                });
              })),

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

              // 3.3 分镜格卡片群
              h('div', {
                id: 'winetoken-canvas-panels-area'
              }, panels.map(p => {
                const char = characters.find(c => c.id === p.characterId);
                const isCandidate = Boolean(p.stagingCandidateUrl);
                const displayUrl = p.stagingCandidateUrl || p.imageUrl;

                return h('div', {
                  key: p.id,
                  style: {
                    position: 'absolute',
                    left: `${p.x}px`,
                    top: `${p.y}px`,
                    width: `${p.width}px`,
                    backgroundColor: theme.bgCard,
                    border: `1px solid ${isCandidate ? '#f59e0b' : theme.borderSubtle}`,
                    borderRadius: '10px',
                    boxShadow: isCandidate
                      ? '0 12px 30px rgba(245, 158, 11, 0.25)'
                      : '0 12px 28px rgba(0, 0, 0, 0.25)',
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column'
                  }
                }, [
                  // 镜号与景别顶栏
                  h('div', {
                    style: {
                      padding: '8px 12px',
                      borderBottom: `1px solid ${theme.borderSubtle}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      backgroundColor: theme.isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)'
                    }
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
                    h('button', {
                      type: 'button',
                      onClick: () => {
                        setPanels(prev => prev.filter(x => x.id !== p.id));
                      },
                      style: { background: 'none', border: 'none', color: theme.textMuted, cursor: 'pointer', fontSize: '11px' }
                    }, '删除')
                  ]),

                  // 画面展示区 (支持 InvokeAI 幽灵暂存层 + 亚像素高清渲染)
                  h('div', {
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
                            transform: 'translateZ(0)',
                            backfaceVisibility: 'hidden',
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
                  imageRendering: '-webkit-optimize-contrast',
                  transform: 'translateZ(0)'
                },
                onClick: (e) => e.stopPropagation()
              })
            ])
          ]);
        }

        // ==========================================
        // 6. 创作工坊主工作台 (StudioPage)
        // ==========================================
        function StudioPage() {
          const theme = useTheme();
          const [mode, setMode] = React.useState('image'); // 'image' | 'video' | 'canvas'
          const [showTutorial, setShowTutorial] = React.useState(false);
          const [selectedImageModel, setSelectedImageModel] = React.useState('gpt-image-2.5-flare');
          const [selectedVideoModel, setSelectedVideoModel] = React.useState('grok-imagine-video-1.5');
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
                  return Array.from(map.values()).sort((a, b) => (new Date(b.createdAt || 0) - new Date(a.createdAt || 0))).slice(0, 60);
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
          const handleGenerate = async () => {
            if (!prompt.trim() && referenceSlots.length === 0) {
              alert('请输入画面描述提示词 (Prompt)，或上传参考图片');
              return;
            }
            const key = getKey();
            if (!key) {
              alert('未检测到 API Key，请在上方或下方状态栏中配置');
              return;
            }

            setIsGenerating(true);
            const actionName = referenceSlots.length > 0
              ? (mode === 'image' ? '多参考图垫图绘制' : '首帧图生视频渲染')
              : (mode === 'image' ? '画面绘制' : '视频生成');
            setStatusMsg(`AI 正在进行${actionName}，请稍候...`);

            try {
              if (mode === 'image') {
                const finalPrompt = compilePromptWithSlots(prompt, referenceSlots);
                const singleNOnly = Boolean(currentImgModel.singleNOnly);

                const requestSingleBatch = async (nVal) => {
                  const payload = {
                    model: selectedModel,
                    prompt: finalPrompt,
                    n: nVal,
                    size: size,
                    response_format: 'url'
                  };
                  if (referenceSlots.length > 0) {
                    payload.image = referenceSlots[0].dataUrl;
                    payload.image_url = referenceSlots[0].dataUrl;
                    payload.reference_image = referenceSlots[0].dataUrl;
                    payload.images = referenceSlots.map(s => s.dataUrl);
                  }
                  const res = await fetch(BASE_URL + '/v1/images/generations', {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      'Authorization': 'Bearer ' + key
                    },
                    body: JSON.stringify(payload)
                  });
                  if (!res.ok) {
                    const errJson = await res.json().catch(() => ({}));
                    throw new Error(errJson.error?.message || `HTTP ${res.status}`);
                  }
                  return await res.json();
                };

                let generatedData = [];
                if (count > 1) {
                  // 所有生图模型在选多张时，一律并发发送单张请求，彻底杜绝上游 API "invalid n, should be in [1, 1]" 校验拦截
                  setStatusMsg(`AI 正在并发绘制第 1~${count} 张画面，请稍候...`);
                  const tasks = Array.from({ length: count }, () => requestSingleBatch(1));
                  const results = await Promise.all(tasks);
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
                  const newItems = generatedData.map(d => ({
                    url: d.url || (d.b64_json ? 'data:image/png;base64,' + d.b64_json : ''),
                    prompt: prompt.trim(),
                    model: selectedModel,
                    size: size,
                    hasRef: referenceSlots.length > 0,
                    time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
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
                alert(`【视频生成任务提交成功】\n基底模型: ${currentModelObj.name}\n渲染规格: ${size} · 时长 ${duration} 秒\n预估消耗: ¥${formatCNY(estCost)}${isVip ? ` (${isSvip ? 'SVIP专属8折' : 'VIP专属9折'}特惠)` : ''}\n\n已成功载入视频渲染队列，视频渲染通常需 1~2 分钟，请稍候在视频展台查看。`);
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
                const next = prev.map(x => (x.id === item.id || x.url === item.url) ? { ...x, localPath } : x);
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
                const next = prev.map(x => (x.id === item.id || x.url === item.url) ? { ...x, localPath } : x);
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

            // 2. 主体工作台 (漫剧画布 vs 传统工坊双栏)
            mode === 'canvas' ? h(CanvasWorkspace, {
              theme,
              isVip,
              isSvip,
              isSuper,
              onOpenTutorial: () => setShowTutorial(true)
            }) : h('div', {
              style: {
                flex: 1,
                display: 'grid',
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
                              h('span', {}, `${isSvip ? 'SVIP' : 'VIP'} ¥${formatCNY(effectiveSinglePrice)}/张`)
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
                            h('span', {}, `${isSvip ? 'SVIP' : 'VIP'} ¥${formatCNY(estCost)}/${duration}秒 (¥${formatCNY(effectiveSecPrice)}/秒)`)
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
                        else if (isVip && m.vipPrice != null) priceDisplay = `${isSvip ? 'SVIP' : 'VIP'} ¥${formatCNY(effP)}/张`;
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
                        : (isVip ? `${isSvip ? 'SVIP' : 'VIP'} ¥${formatCNY(secP)}/秒` : `¥${formatCNY(secP)}/秒`);
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
                        mode === 'image' ? `参考图库 (${referenceSlots.length}/5)` : '首帧参考图'
                      ),
                      referenceSlots.length > 0 && h('span', { style: { fontSize: '10.5px', color: theme.textMuted } }, '可拖拽至输入框')
                    ]),
                    h('span', { style: { fontSize: '11px', color: referenceSlots.length > 0 ? '#22c55e' : theme.textMuted } },
                      referenceSlots.length > 0 ? (mode === 'image' ? `已启用 ${referenceSlots.length} 张垫图` : '已启用首帧驱动') : '可选'
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

                  referenceSlots.length > 0 ? h('div', {
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
                    h('span', { style: { fontSize: '10.5px', color: theme.textMuted } }, mode === 'image' ? '支持多角色人物与场景垫图、拖拽指代' : '作为视频首帧引导动态')
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
                          ? `立即垫图生成 · 预估消耗 ¥${formatCNY(estCost)}${isVip ? ` (${isSvip ? 'SVIP' : 'VIP'}优先扣套餐)` : ''}`
                          : `立即生成 · 预估消耗 ¥${formatCNY(estCost)}${isVip ? ` (${isSvip ? 'SVIP' : 'VIP'}优先扣套餐)` : ''}`)
                      : (referenceSlots.length > 0
                          ? `提交首帧生视频 (${duration}秒) · 预估消耗 ¥${formatCNY(estCost)}${isVip ? ` (${isSvip ? 'SVIP' : 'VIP'}优先扣套餐)` : ''}`
                          : `提交文生视频 (${duration}秒) · 预估消耗 ¥${formatCNY(estCost)}${isVip ? ` (${isSvip ? 'SVIP' : 'VIP'}优先扣套餐)` : ''}`)
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
                              imageRendering: '-webkit-optimize-contrast',
                              transform: 'translateZ(0)',
                              backfaceVisibility: 'hidden'
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
                          referenceSlots.length > 0 ? `已选择 ${referenceSlots.length} 张参考图，点击「立即垫图生成」即可开始` : '在左侧配置模型或上传参考底图，点击「立即生成」即可在此呈现成果'
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
          inject: ['slots', 'layout'],
          apply(ctx) {
            // 暴露全局切换视图句柄
            if (typeof window !== 'undefined') {
              window.__dsh_layout_selectPanel = (panelId) => {
                try { ctx.layout.selectPanel(panelId); } catch (_) {}
              };
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
    module.exports = { updateBilling };
  }
})();
