// v2.5.19 全量打包：fs/path/os 的 esbuild 构建期 stub。
// 构建 dist/client.js 时通过 esbuild alias 把 'fs'/'path'/'os' 指向本文件，
// 使产物中不残留任何对 Node 内置模块的运行时 require。
// 4 个 fs 兄弟模块用 existsSync 探测：stub 无该方法 → HAS_FS=false → 走内存垫片。
module.exports = {};
