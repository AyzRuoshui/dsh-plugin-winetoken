// -*- coding: utf-8 -*-
/**
 * v2.5.19 全量打包：web 渲染进程内存 fs/path/os 垫片。
 *
 * 背景：4 个 fs 兄弟模块（canvas-storage / canvas-job-queue / canvas-assets /
 * canvas-project-store）在 Node 端跑真实 fs（保留既有 216 项单测契约）；
 * 在打包产物（web 渲染进程，无真实 fs）里由本垫片接管，落盘改为内存 Map，
 * 可用时镜像到 LocalStorage。垫片实现这些模块实际用到的 fs/path/os 子集，
 * 让上层 class 代码逐字不变、全部对外方法签名保持不变。
 *
 * 本文件只在 HAS_FS === false 分支被 require；Node 单测不会走到这里。
 */
(function () {
  var LS_KEY = '__WINETOKEN_CANVAS_MEMFS__';
  var files = new Map(); // normalized path -> Buffer

  function safeLocalStorage() {
    try {
      if (typeof globalThis !== 'undefined' && globalThis && globalThis.localStorage) return globalThis.localStorage;
      if (typeof window !== 'undefined' && window && window.localStorage) return window.localStorage;
    } catch (_) {}
    return null;
  }

  function persist() {
    var ls = safeLocalStorage();
    if (!ls) return;
    try {
      var obj = {};
      files.forEach(function (buf, p) { obj[p] = buf.toString('base64'); });
      ls.setItem(LS_KEY, JSON.stringify(obj));
    } catch (_) {}
  }

  function restore() {
    var ls = safeLocalStorage();
    if (!ls) return;
    try {
      var raw = ls.getItem(LS_KEY);
      if (!raw) return;
      var obj = JSON.parse(raw);
      Object.keys(obj || {}).forEach(function (p) {
        try { files.set(normalizePath(p), Buffer.from(obj[p], 'base64')); } catch (_) {}
      });
    } catch (_) {}
  }

  function normalizePath(p) {
    return String(p).replace(/\\/g, '/').replace(/\/+/g, '/');
  }

  function toBuffer(data) {
    if (Buffer.isBuffer(data)) return Buffer.from(data);
    if (typeof data === 'string') return Buffer.from(data, 'utf8');
    return Buffer.from(data || '');
  }

  function enoent(op, p) {
    var err = new Error("ENOENT: no such file or directory, " + op + " '" + p + "'");
    err.code = 'ENOENT';
    return err;
  }

  var fsShim = {
    existsSync: function (p) { return files.has(normalizePath(p)); },
    mkdirSync: function () { return undefined; },
    readFileSync: function (p, enc) {
      var key = normalizePath(p);
      if (!files.has(key)) throw enoent('open', p);
      var buf = files.get(key);
      return (enc === 'utf8' || enc === 'utf-8') ? buf.toString('utf8') : Buffer.from(buf);
    },
    writeFileSync: function (p, data) {
      files.set(normalizePath(p), toBuffer(data));
      persist();
      return undefined;
    },
    copyFileSync: function (src, dst) {
      var key = normalizePath(src);
      if (!files.has(key)) throw enoent('copyFile', src);
      files.set(normalizePath(dst), Buffer.from(files.get(key)));
      persist();
    },
    renameSync: function (src, dst) {
      var s = normalizePath(src), d = normalizePath(dst);
      if (!files.has(s)) throw enoent('rename', src);
      files.set(d, files.get(s));
      files.delete(s);
      persist();
    },
    readdirSync: function (dir) {
      var prefix = normalizePath(dir).replace(/\/$/, '') + '/';
      var out = [];
      files.forEach(function (_, p) {
        if (p.indexOf(prefix) === 0) {
          var rest = p.slice(prefix.length);
          if (rest && rest.indexOf('/') === -1) out.push(rest);
        }
      });
      return out;
    },
    unlinkSync: function (p) {
      var key = normalizePath(p);
      if (!files.has(key)) throw enoent('unlink', p);
      files.delete(key);
      persist();
    }
  };

  var pathShim = {
    join: function () {
      var parts = Array.prototype.slice.call(arguments);
      var out = [];
      for (var i = 0; i < parts.length; i++) {
        if (parts[i] === '' || parts[i] === null || parts[i] === undefined) continue;
        var seg = String(parts[i]).replace(/^\/+|\/+$/g, '');
        if (seg) out.push(seg);
      }
      return out.join('/');
    },
    basename: function (p) { return String(p).split('/').pop(); }
  };

  var osShim = {
    homedir: function () { return '/__winetoken_web__'; }
  };

  restore();

  module.exports = { fs: fsShim, path: pathShim, os: osShim };
})();
