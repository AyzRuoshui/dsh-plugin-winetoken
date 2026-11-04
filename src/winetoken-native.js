/**
 * WineToken Native DSH Client Extension
 * 100% 原生内置扩展：底部状态栏 30 秒余额轮询、订阅进度条与开机模型同步
 * 零系统污染、零桌面垃圾快捷方式、随 DSH 进程生命周期启动和销毁
 */

(function () {
  const fs = require('fs');
  const path = require('path');
  const os = require('os');

  console.log('[WineToken Native] Initializing native extension in DeepSeek Harness...');

  const homedir = os.homedir();
  const credentialsPath = path.join(homedir, '.dsh', '.credentials.yaml');
  const cordisPatchPath = path.join(homedir, '.dsh', 'profiles', 'desktop', 'cordis.patch.yml');
  const configPath = path.join(__dirname, 'config.json');

  // 1. 读取 API Key
  function getApiKey() {
    if (process.env.WINETOKEN_API_KEY) {
      return process.env.WINETOKEN_API_KEY.trim();
    }
    try {
      if (fs.existsSync(credentialsPath)) {
        const content = fs.readFileSync(credentialsPath, 'utf8');
        const match = content.match(/WINETOKEN_API_KEY:\s*([^\r\n#]+)/);
        if (match && match[1]) {
          return match[1].trim();
        }
      }
    } catch (e) {
      console.warn('[WineToken Native] Failed to read credentials:', e.message);
    }
    return '';
  }

  // 2. 状态存储
  let currentBalance = null;
  let currentUsage = null;
  let subscriptionData = null;
  let isFetching = false;
  let pollTimer = null;

  // 3. 轮询余额与订阅数据
  async function fetchBillingData() {
    const apiKey = getApiKey();
    if (!apiKey) {
      renderPill({ status: 'no_key' });
      return;
    }

    if (isFetching) return;
    isFetching = true;

    try {
      const headers = { Authorization: `Bearer ${apiKey}` };
      const base = 'https://www.winetoken.asia';

      // 3.1 查询订阅
      const subRes = await fetch(`${base}/dashboard/billing/subscription`, { headers });
      if (!subRes.ok) {
        throw new Error(`Subscription fetch HTTP ${subRes.status}`);
      }
      const subData = await subRes.json();
      subscriptionData = subData;

      // 3.2 查询当月用量
      const now = new Date();
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
      const usageRes = await fetch(`${base}/dashboard/billing/usage?start_date=${firstDay}&end_date=${lastDay}`, { headers });
      if (usageRes.ok) {
        const usageData = await usageRes.json();
        currentUsage = usageData.total_usage || 0;
      }

      // 3.3 计算余额
      const hardLimit = subData.hard_limit_usd || 0;
      const usedUSD = (currentUsage || 0) / 100;
      if (hardLimit >= 100000000) {
        currentBalance = '充足';
      } else {
        const remain = Math.max(0, hardLimit - usedUSD);
        currentBalance = `¥${(remain * 7.2).toFixed(2)}`;
      }

      renderPill({
        status: 'ok',
        balance: currentBalance,
        subscription: subData,
        usage: currentUsage
      });
    } catch (err) {
      console.warn('[WineToken Native] Billing fetch failed:', err.message);
      renderPill({ status: 'error', error: err.message });
    } finally {
      isFetching = false;
    }
  }

  // 4. DOM 渲染与注入（精准对齐 DSH 原生样式）
  const CONTAINER_ID = 'winetoken-status-dock-pill';

  function ensureStyles() {
    if (document.getElementById('winetoken-dock-styles')) return;
    const style = document.createElement('style');
    style.id = 'winetoken-dock-styles';
    style.textContent = `
      #${CONTAINER_ID} {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 11px;
        line-height: 16px;
        color: var(--dsw-alias-label-secondary, #94a3b8);
        background: transparent;
        border-radius: 9999px;
        padding: 2px 6px;
        cursor: pointer;
        user-select: none;
        transition: color 0.15s ease, background-color 0.15s ease;
      }
      #${CONTAINER_ID}:hover {
        color: var(--dsw-alias-label-primary, #f8fafc);
        background: rgba(255, 255, 255, 0.06);
      }
      .wt-coin-icon {
        display: inline-block;
        width: 13px;
        height: 13px;
        vertical-align: -2px;
        flex-shrink: 0;
      }
      .wt-balance-text {
        font-weight: 500;
        letter-spacing: -0.2px;
      }
      .wt-progress-wrap {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        margin-left: 2px;
      }
      .wt-progress-bar-bg {
        width: 38px;
        height: 5px;
        border-radius: 3px;
        background: rgba(255, 255, 255, 0.15);
        overflow: hidden;
        position: relative;
      }
      .wt-progress-bar-fill {
        height: 100%;
        border-radius: 3px;
        background: #3b82f6;
        transition: width 0.3s ease;
      }
      .wt-progress-text {
        font-size: 10px;
        color: var(--dsw-alias-label-tertiary, #64748b);
      }
      .wt-sep {
        opacity: 0.4;
        margin: 0 1px;
      }
      .wt-spin {
        animation: wtRotate 1s linear infinite;
      }
      @keyframes wtRotate {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
  }

  function renderPill(data) {
    if (!document.body) return;
    ensureStyles();

    const dock = document.querySelector('div[data-composer-dock="true"], div[data-composer-dock]');
    if (!dock) return;

    let pill = document.getElementById(CONTAINER_ID);
    if (!pill) {
      pill = document.createElement('span');
      pill.id = CONTAINER_ID;
      pill.setAttribute('data-composer-stat', 'winetoken-balance');
      pill.title = '点击立即刷新 WineToken 余额';
      pill.onclick = (e) => {
        e.stopPropagation();
        fetchBillingData();
      };

      // 插入在 ContextMeter (dock.lastElementChild) 之前或末尾
      if (dock.lastElementChild) {
        dock.insertBefore(pill, dock.lastElementChild);
      } else {
        dock.appendChild(pill);
      }
    }

    // 状态组装
    if (data.status === 'no_key') {
      pill.innerHTML = `
        <span class="wt-coin-icon">💰</span>
        <span class="wt-balance-text">WineToken: 未填Key</span>
      `;
      return;
    }

    if (data.status === 'error') {
      pill.innerHTML = `
        <span class="wt-coin-icon">⚠️</span>
        <span class="wt-balance-text" title="${data.error || ''}">WineToken 离线</span>
      `;
      return;
    }

    // 正常状态
    const balanceText = data.balance || currentBalance || '查询中...';
    const sub = data.subscription || subscriptionData;
    const usage = data.usage !== undefined ? data.usage : currentUsage;

    // 判定是否有订阅：access_until 在未来且有具体订阅配额
    const nowSec = Date.now() / 1000;
    const hasSubscription = sub && sub.access_until && sub.access_until > nowSec && sub.hard_limit_usd < 100000000;

    let subHtml = '';
    if (hasSubscription) {
      const hardLimit = sub.hard_limit_usd || 1;
      const usedUSD = (usage || 0) / 100;
      const percent = Math.min(100, Math.max(0, Math.round((usedUSD / hardLimit) * 100)));

      let barColor = '#3b82f6'; // 默认蓝
      if (percent >= 90) barColor = '#ef4444'; // 红色
      else if (percent >= 75) barColor = '#f59e0b'; // 橙色

      const remainDays = Math.max(1, Math.ceil((sub.access_until - nowSec) / 86400));
      const subTooltip = `订阅套餐配额: $${hardLimit.toFixed(2)} | 已用: $${usedUSD.toFixed(2)} | 剩余 ${remainDays} 天`;

      subHtml = `
        <span class="wt-sep">·</span>
        <span class="wt-progress-wrap" title="${subTooltip}">
          <span class="wt-progress-bar-bg">
            <span class="wt-progress-bar-fill" style="width: ${percent}%; background: ${barColor};"></span>
          </span>
          <span class="wt-progress-text">${percent}%</span>
        </span>
      `;
    }

    pill.innerHTML = `
      <span class="wt-coin-icon">💰</span>
      <span class="wt-balance-text">${balanceText}</span>
      ${subHtml}
    `;
  }

  // 5. 持续保活挂载（防止 React 重绘冲刷）
  function setupObserver() {
    const observer = new MutationObserver(() => {
      const dock = document.querySelector('div[data-composer-dock="true"], div[data-composer-dock]');
      if (dock && !document.getElementById(CONTAINER_ID)) {
        renderPill({ status: 'ok', balance: currentBalance });
      }
    });

    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
    } else {
      window.addEventListener('DOMContentLoaded', () => {
        observer.observe(document.body, { childList: true, subtree: true });
      });
    }
  }

  // 6. 开机静默模型检查与同步 (启动 3 秒后执行)
  async function triggerStartupModelSync() {
    try {
      const apiKey = getApiKey();
      if (!apiKey) return;

      console.log('[WineToken Native] Checking gateway models in background...');
      const res = await fetch('https://www.winetoken.asia/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` }
      });
      if (!res.ok) return;

      const data = await res.json();
      if (!data.data || !Array.isArray(data.data)) return;

      // 动态载入 parser 同步
      const parserPath = path.join(__dirname, 'parser.js');
      const syncPath = path.join(__dirname, 'sync.js');
      if (fs.existsSync(parserPath) && fs.existsSync(syncPath)) {
        const { parseModels } = require(parserPath);
        const { syncWithHarness } = require(syncPath);

        const newModels = parseModels(data.data);
        if (newModels && newModels.length > 0) {
          syncWithHarness(newModels, { quiet: true });
          console.log(`[WineToken Native] Gateway models checked: ${newModels.length} models valid.`);
        }
      }
    } catch (e) {
      console.warn('[WineToken Native] Startup model check ignored:', e.message);
    }
  }

  // 7. 启动自运行
  function start() {
    setupObserver();

    // 首次获取
    fetchBillingData();

    // 30 秒轮询
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(fetchBillingData, 30000);

    // 3 秒后静默检查模型
    setTimeout(triggerStartupModelSync, 3000);
  }

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
