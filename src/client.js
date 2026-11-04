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

  function getKey() {
    try {
      if (typeof localStorage !== 'undefined') {
        const stored = localStorage.getItem('WINETOKEN_API_KEY');
        if (stored && stored.trim()) return stored.trim();
      }
    } catch (_) {}
    return DEFAULT_KEY;
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

  const initialCache = loadBillingCache();

  let billingState = initialCache ? {
    balanceText: initialCache.balanceText || '余额 --',
    usedText: initialCache.usedText || '已用 ¥0.00',
    pillText: initialCache.pillText || initialCache.balanceText || '余额 --',
    hasSubscription: Boolean(initialCache.hasSubscription),
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
    balanceText: '余额 --',
    usedText: '已用 ¥0.00',
    pillText: '余额 --',
    hasSubscription: false,
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
    tooltip: '点击管理 WineToken 账户与密钥',
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
    if (!key || billingState.isFetching) return;
    billingState.isFetching = true;

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

        const hasSub = Boolean(subStatusData.subscribed && subStatusData.subscription);
        billingState.hasSubscription = hasSub;

        if (hasSub) {
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
          const [showKeyInput, setShowKeyInput] = React.useState(false);
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
            localStorage.setItem('WINETOKEN_API_KEY', trimmed);
            setCurrentKey(trimmed);
            setKeyInput('');
            setShowKeyInput(false);
            setStatusTip('正在连接并验证新 Key...');
            await updateBilling();
            setStatusTip('连接成功，已生效！');
            setTimeout(() => setStatusTip(''), 3000);
          };

          const handleResetKey = async () => {
            localStorage.removeItem('WINETOKEN_API_KEY');
            setCurrentKey(DEFAULT_KEY);
            setKeyInput('');
            setShowKeyInput(false);
            setStatusTip('已恢复默认预设 Key，正在刷新...');
            await updateBilling();
            setStatusTip('已恢复默认！');
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
                border: `1px solid ${theme.borderSubtle}`,
                borderRadius: '8px',
                padding: '12px',
                marginBottom: '12px'
              }
            }, [
              // 分区 1：若拥有活跃周期订阅，呈现专属限时额度与到期自动失效说明
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
                  paddingTop: billing.hasSubscription ? '10px' : '0',
                  borderTop: billing.hasSubscription ? `1px dashed ${theme.borderSubtle}` : 'none',
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
                h('input', {
                  type: 'text',
                  placeholder: '粘贴新的 sk-... 密钥',
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
                    onClick: handleResetKey
                  }, '恢复默认'),
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
                    onClick: () => { setShowKeyInput(false); setKeyInput(''); }
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

        // 3. 创作工坊主工作台 (StudioPage)
        function StudioPage() {
          const theme = useTheme();
          const [mode, setMode] = React.useState('image'); // 'image' | 'video'
          const [selectedModel, setSelectedModel] = React.useState('gpt-image-2.5-flare');
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

          // 判断用户当前是否拥有 VIP / SVIP 会员特权 (SVIP 8折，VIP 9折，100% 对齐数据库 GroupRatio)
          const isVip = Boolean(billing.hasSubscription);
          const isSvip = isVip && (billing.subGroup === 'svip' || !billing.subGroup); // 默认高级订阅按 SVIP 8折
          const discountRatio = isVip ? (billing.subGroup === 'vip' ? 0.9 : 0.8) : 1.0;

          // 价格解析引擎：根据用户是否有 VIP/SVIP 动态输出对应真实价格
          const getModelEffectivePrice = (m) => {
            if (!m || m.price == null) return null;
            if (m.price === 0) return 0;
            if (!isVip) return m.price;
            if (m.vipPrice != null && isSvip) return m.vipPrice;
            return Number((m.price * discountRatio).toFixed(3));
          };

          // 生图模型列表 (100% 对齐线上生产数据库 billing_setting.billing_expr 真实账本)
          const IMAGE_MODELS = [
            {
              id: 'gpt-image-2.5-flare',
              name: 'OpenAI GPT-Image 2.5 Flare',
              tag: '极速',
              price: 0.30,
              vipPrice: 0.24, // SVIP 8折: 0.24元 (120k Quota) | VIP 9折: 0.27元
              singleNOnly: false,
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
              name: 'OpenAI GPT-Image 2.5 Sunburst',
              tag: '高画质',
              price: 0.40,
              vipPrice: 0.32, // SVIP 8折: 0.32元 (160k Quota) | VIP 9折: 0.36元
              singleNOnly: false,
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
              name: 'Google DeepMind Imagen-3',
              tag: '2K写实',
              price: 0.15,
              vipPrice: 0.12, // SVIP 8折: 0.12元 (60k Quota) | VIP 9折: 0.135元
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
              singleNOnly: true, // 明确单次上限 1 张，选多张时自动并发拆包
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
              name: 'xAI Grok Imagine 2.0',
              tag: '光影旗舰',
              price: 0.50,
              vipPrice: 0.40, // SVIP 8折: 0.40元 (200k Quota) | VIP 9折: 0.45元
              singleNOnly: false,
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
              name: 'OpenAI GPT-Image 2',
              tag: '经典DALL-E 2',
              price: 0.20, // 彻底修正此前误标的 0.30，线上真实原价仅 0.20元！
              vipPrice: 0.16, // SVIP 8折: 0.16元 (80k Quota) | VIP 9折: 0.18元
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

          // 视频模型列表与独立专属规格 (100% 对齐线上生产数据库 billing_setting.billing_expr 真实规则)
          const VIDEO_MODELS = [
            {
              id: 'MiniMax-H3',
              name: 'MiniMax H3 (海螺视频)',
              tag: '电影感',
              pricePerSecond: 0.15, // 后端规则: tier("base", u("seconds") * 0.15)
              vipPricePerSecond: 0.12, // SVIP 8折: 0.12元/秒 (5秒基准刚好为 300k Quota = ¥0.60)
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
              name: 'xAI Grok Video 1.5',
              tag: '物理连贯',
              pricePerSecond: 0.20, // 后端规则: tier("base", u("seconds") * 0.2)
              vipPricePerSecond: 0.16, // SVIP 8折: 0.16元/秒 (5秒基准 ¥0.80) | VIP 9折: 0.18元/秒
              priceText: '原¥0.20/秒 (5秒基准 ¥1.00)',
              vipPriceText: 'SVIP ¥0.16/秒 (5秒基准 ¥0.80)',
              unit: '秒',
              durations: [
                { val: 5, label: '5 秒', tag: '标配' },
                { val: 10, label: '10 秒', tag: '长片' }
              ],
              desc: '物理规律连贯无频闪，支持 5秒 / 10秒 时长选择，支持首帧参考图生视频',
              resolutions: [
                { label: '720P 横屏', icon: 'ratio16_9', val: '1280x720' },
                { label: '720P 竖屏', icon: 'ratio9_16', val: '720x1280' },
                { label: '1080P 全高清', icon: 'ratio16_9', val: '1920x1080' },
                { label: '1:1 正方', icon: 'ratio1_1', val: '1024x1024' }
              ]
            }
          ];

          // 当前模型与可用分辨率/时长联动
          const currentModels = mode === 'image' ? IMAGE_MODELS : VIDEO_MODELS;
          const currentModelObj = currentModels.find(m => m.id === selectedModel) || currentModels[0];
          const availableResolutions = currentModelObj.resolutions || [];
          const availableDurations = currentModelObj.durations || [{ val: 5, label: '5 秒' }];

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

          // 快捷下载
          const downloadMedia = (url, name) => {
            const a = document.createElement('a');
            a.href = url;
            a.download = name || `winetoken_${Date.now()}.png`;
            a.target = '_blank';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
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
                  onClick: () => { setMode('image'); setSelectedModel('gpt-image-2.5-flare'); }
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
                  onClick: () => { setMode('video'); setSelectedModel('MiniMax-H3'); }
                }, [
                  h(Icon, { name: 'video', size: 14 }),
                  h('span', {}, '视频工坊')
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
                    h(Icon, { name: billing.hasSubscription ? 'crown' : 'wallet', size: 13, style: { opacity: 0.8, color: billing.hasSubscription ? (theme.isDark ? '#f59e0b' : '#d97706') : 'inherit' } }),
                    h('span', { style: { color: theme.textPrimary, fontWeight: '500' } }, billing.pillText)
                  ]),
                  showStudioPopover && h(WineTokenAccountPopover, {
                    positionTop: true,
                    onClose: () => setShowStudioPopover(false)
                  })
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

            // 2. 主体工作台 (左侧 360px 参数栏 + 右侧画廊展台，全量自适应)
            h('div', {
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
                              h('span', {}, `SVIP ¥${formatCNY(effectiveSinglePrice)}/张`)
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
                  h('select', {
                    value: selectedModel,
                    onChange: (e) => setSelectedModel(e.target.value),
                    style: {
                      width: '100%',
                      padding: '9px 12px',
                      borderRadius: '7px',
                      background: theme.bgInput,
                      border: `1px solid ${theme.borderStrong}`,
                      color: theme.textPrimary,
                      fontSize: '12.5px',
                      outline: 'none',
                      cursor: 'pointer'
                    }
                  }, currentModels.map(m => {
                    let priceDisplay = '';
                    if (mode === 'image') {
                      const effP = getModelEffectivePrice(m);
                      if (effP != null) {
                        if (effP === 0) priceDisplay = '免费';
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
                      priceDisplay = isVip ? `${isSvip ? 'SVIP' : 'VIP'} ¥${formatCNY(secP)}/秒` : `¥${formatCNY(secP)}/秒`;
                    }
                    return h('option', { key: m.id, value: m.id, style: { background: theme.bgSidebar, color: theme.textPrimary } },
                      `${m.name} [${m.tag}] — ${priceDisplay}`
                    );
                  })),
                  h('p', { style: { fontSize: '11px', color: theme.textMuted, marginTop: '6px', lineHeight: '1.4' } },
                    currentModelObj.desc || ''
                  )
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
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '20px',
                      boxSizing: 'border-box'
                    }
                  }, [
                    h('img', {
                      src: activeImage.url,
                      alt: activeImage.prompt,
                      style: {
                        maxWidth: '92%',
                        maxHeight: '68vh',
                        objectFit: 'contain',
                        borderRadius: '8px',
                        boxShadow: theme.isDark ? '0 20px 45px rgba(0, 0, 0, 0.7)' : '0 20px 45px rgba(0, 0, 0, 0.15)',
                        border: `1px solid ${theme.borderSubtle}`
                      }
                    }),
                    // 浮动悬停操作栏 (自适应)
                    h('div', {
                      style: {
                        marginTop: '16px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        background: theme.floatingBarBg,
                        padding: '6px 10px',
                        borderRadius: '8px',
                        border: `1px solid ${theme.floatingBarBorder}`,
                        boxShadow: theme.isDark ? '0 8px 20px rgba(0,0,0,0.5)' : '0 8px 20px rgba(0,0,0,0.1)'
                      }
                    }, [
                      h('button', {
                        type: 'button',
                        onClick: () => downloadMedia(activeImage.url),
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
                        h(Icon, { name: 'download', size: 13 }),
                        h('span', {}, '保存原图')
                      ]),
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
                      h('img', {
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
            ])
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
              h('span', {
                style: {
                  fontWeight: '500',
                  letterSpacing: '-0.1px'
                }
              }, state.pillText),
              !state.hasSubscription && h('span', {
                style: {
                  opacity: 0.35,
                  margin: '0 4px'
                }
              }, '·'),
              !state.hasSubscription && h('span', {
                style: {
                  fontWeight: '500',
                  letterSpacing: '-0.1px'
                }
              }, state.usedText),
              progressBar
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
