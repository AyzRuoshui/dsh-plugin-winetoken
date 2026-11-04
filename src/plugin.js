// -*- coding: utf-8 -*-
/**
 * DeepSeek Harness 官方 Cordis 原生插件
 * 挂载至 ~/.dsh/profiles/desktop/cordis.patch.yml
 * 1. 每次打开 dsh 启动时自动触发模型同步
 * 2. 客户端运行期间每 60 分钟自动静默轮询
 * 3. 随 dsh 退出自动释放，零系统污染
 */
const { runSync } = require('./sync');

module.exports.name = 'winetoken-auto-sync';

module.exports.apply = function(ctx) {
  // 1. 客户端启动时延迟 1 秒静默同步（等待网络与基础服务就绪）
  setTimeout(() => {
    runSync().catch(err => {
      if (ctx.logger) {
        ctx.logger('winetoken').warn('自动同步模型失败:', err.message);
      } else {
        console.warn('[WineToken AutoSync Error]:', err.message);
      }
    });
  }, 1000);

  // 2. 运行期间每 60 分钟自动更新，随 App 关闭自动销毁
  const INTERVAL_MS = 60 * 60 * 1000;
  if (typeof ctx.setInterval === 'function') {
    ctx.setInterval(() => {
      runSync().catch(() => {});
    }, INTERVAL_MS);
  } else {
    const timer = setInterval(() => {
      runSync().catch(() => {});
    }, INTERVAL_MS);

    if (typeof ctx.on === 'function') {
      ctx.on('dispose', () => clearInterval(timer));
    }
  }
};
