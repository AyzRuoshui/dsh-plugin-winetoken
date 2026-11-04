// -*- coding: utf-8 -*-
/**
 * 绿色伴随守护进程 (零系统残留、零计划任务污染)
 * 仅在 DeepSeek Harness 运行时在后台保持 1 小时定时刷新
 * 检测到 DeepSeek Harness 退出后，立即自我销毁退出，绝不残留孤儿进程
 */
const { exec } = require('child_process');
const path = require('path');
const { runSync } = require('./sync');

const INTERVAL_MS = 60 * 60 * 1000; // 1 小时
const CHECK_PROCESS_INTERVAL_MS = 30 * 1000; // 每 30 秒检查一次 Harness 存活

function isHarnessRunning() {
  return new Promise((resolve) => {
    exec('tasklist /FI "IMAGENAME eq DeepSeek Harness.exe" /NH', (err, stdout) => {
      if (err) return resolve(false);
      resolve(stdout.toLowerCase().includes('deepseek harness.exe'));
    });
  });
}

async function main() {
  // 首次启动先执行一次同步
  await runSync().catch(() => {});

  let lastSyncTime = Date.now();

  const timer = setInterval(async () => {
    // 检查主程序是否存活
    const running = await isHarnessRunning();
    if (!running) {
      // 主程序已退出，守护进程干净退出，绝不常驻系统
      clearInterval(timer);
      process.exit(0);
    }

    // 满足 1 小时间隔则同步
    if (Date.now() - lastSyncTime >= INTERVAL_MS) {
      await runSync().catch(() => {});
      lastSyncTime = Date.now();
    }
  }, CHECK_PROCESS_INTERVAL_MS);
}

main();
