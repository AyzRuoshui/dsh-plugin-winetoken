# DeepSeek Harness (DSH) - WineToken 原生聚合插件

[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-v0.2.1--rc.5-blue)](https://github.com/deepseek-ai/deepseek-harness)
[![Version](https://img.shields.io/badge/version-2.1.2-green.svg)](package.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![GitHub Release](https://img.shields.io/github/v/release/AyzRuoshui/dsh-plugin-winetoken)](https://github.com/AyzRuoshui/dsh-plugin-winetoken/releases)

专为 **DeepSeek Harness (dsh) 桌面客户端** 打造的原生官方规范增强插件。仅需配置 WineToken API Key，即可一键将全平台真实上架的精选推理模型（王者荣耀灵宝、GLM-5、Kimi、MiniMax、SenseNova、DeepSeek-V4 等）无缝导入 Harness，并在对话界面底部状态栏原生呈现双账轨（钱包永久余额与周期套餐配额）高精度进度监控与创作工坊。

---

## 核心特性

- **官方标准插件 Bundle 规范**：
  - 严格遵循 Harness 官方 Bundle 规范（`dsh.bundle.patch` 与 `dsh.client`）；
  - 配备完整的国际化元数据（`locale/zh.json`、`locale/en.json`）与纯矢量 SVG 图标；
  - **原生陈列于左侧边栏「插件」中心**，支持在界面中查看详情、启用与管理。
- **现代化 AI 漫剧画布创作工坊 (Comic Canvas Studio)**：
  - **无限视口漫游 (LibTV 对标)**：Ctrl+滚轮/触控板捏合定点缩放 (20%~300%)、滚轮/Shift+滚轮/Space/中键多通道平移、V/H 工具状态机、`Ctrl+0` 一键适应画布总览全部内容；
  - **专业选择集**：橡皮筋框选多选、Shift 加减选、多选批量移动（单次手势单快照）与批量删除、`Ctrl+A` 全选、对齐参考线自动吸附；
  - **万物皆节点 (节点工作流)**：生成图自动作为独立图片节点落画布并连线到源分镜（提示词随节点保存）、通用图片/文本节点、`Tab`/双击空白新建节点菜单、`Ctrl+L` 连线模式与绿色锚点拖出连线、连线可选中删除；
  - **复制三件套**：`Ctrl+D` 复制节点和连线、`Alt+拖动` 克隆节点、`Ctrl+Alt+拖动` 创建副本（保留对外连线）；
  - **组织力**：`Ctrl/Alt+G` 成组 / 解组 / 合并分镜组（组虚线底框 + 成员随动）、`Alt+Shift+F` 整理画布（组波段自动布局 + 适应视图）、`Ctrl+F` 节点搜索（镜号/提示词/台词/角色名/组名定位居中）、AABB 视口虚拟化支撑百卡长画布；
  - **AI 剧本拆镜自动铺图**：粘贴剧本文本一键调用对话模型结构化拆解为分镜卡阵列（含景别/提示词/台词），自动铺上画布；
  - **角色 DNA 锚定**：多角色资产库与参考图绑定，彻底解决跨分镜人物“换脸”与画风漂移问题；
  - **WAL 异步任务队列**：引入 Write-Ahead Log 本地离线任务队列与三级水合保活机制，彻底解决切 Tab 或刷新丢图丢状态问题；
  - **撤销/重做堆栈**：基于命令模式实现 30 步动作栈（覆盖节点/连线/组），支持全局 `Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y`；
  - **画布快捷键速查面板与五步新手引导**：工具栏「快捷键」弹层四栏速查，交互完全对标 LibTV；
  - **条漫长图自适应导出**：离屏 Canvas 渲染导出高清条漫，台词对白多行自适应折行断句，杜绝溢出重叠。
- **左侧导航栏原生「创作工坊」与 Tool Calling 技能体系**：
  - 无缝接入主导航栏，拥有独立全功能生图与生视频工作空间；
  - **原生大模型工具调用 (Tool Calling)**：大模型在对话中可直接调用工坊生图与视频技能，支持会话级滑动窗口熔断保护与本地垫图自动 Base64 管道；
  - **全链路真实视频生成**：工坊视频模式直连云端网关，支持 MiniMax-H3 与 Grok 视频模型异步长轮询与实时进度展示；
  - **前置余额校验与受控并发**：批量生成前自动校验账户总可用额度，采用受控并发池（Concurrency Limit=2）杜绝瞬时击穿。
- **对话底部状态栏原生资产展示 (双账轨引擎)**：
  - 无缝接入状态栏（`data-composer-dock`），样式与官方风格深度契合；
  - 严格隔离“套餐限时配额”与“钱包永久资产”，30 秒定时静默轮询，点击胶囊可随时手动刷新；
  - 界面遵循零 Emoji 纯矢量极简工业设计，黑白双主题原生自适应。
- **开机模型动态同步与全模态规格推断**：
  - 启动时自动与 WineToken 官方 Manifest 中枢拉齐，映射真实上下文、输出上限与视觉/推理能力；
  - 彻底消除 TDZ 暂存死区风险，移除任意进程误杀逻辑，运行环境平稳可靠。

---

## 安装与使用

### 方式一：客户端界面原生安装 (推荐)
1. 打开 **DeepSeek Harness** 客户端；
2. 点击左侧边栏的 **「插件」** 图标；
3. 点击右上角的 **「+ 添加插件」**，在下拉菜单中选择 **「安装第三方插件」**；
4. 粘贴安装地址：
   - **国内免魔法高速镜像**：
     ```text
     https://ghproxy.net/https://github.com/AyzRuoshui/dsh-plugin-winetoken/archive/refs/tags/v2.1.2.tar.gz
     ```
   - **GitHub 官方直链**：
     ```text
     https://github.com/AyzRuoshui/dsh-plugin-winetoken/archive/refs/tags/v2.1.2.tar.gz
     ```
5. 点击确认完成安全增量安装；首次在底部点击状态胶囊配置 API Key 即可！

### 方式二：本地安全增量安装脚本 (离线或本地源码开发)
在工程根目录下运行安装脚本：
```bash
node scripts/safe_install.cjs
```

---

## 项目结构

```text
dsh-plugin-winetoken/
├── locale/
│   ├── zh.json                 # 官方规范中文插件介绍
│   └── en.json                 # 官方规范英文插件介绍
├── src/
│   ├── index.js                # Host 端插件入口 (生命周期注入 & 资源清理)
│   ├── client.js               # Client 端核心模块 (状态栏胶囊、工坊、AI漫剧画布)
│   ├── credentials.js          # 统一凭据中枢 (跨进程、别名兼容与自动对齐)
│   ├── patch-engine.js         # 纯原生零依赖 Patch 增量合并引擎 (保留注释与用户provider)
│   ├── canvas-storage.js       # 漫剧画布独立持久化存储驱动 (原子双写双备份)
│   ├── canvas-job-queue.js     # WAL 预写日志异步任务队列驱动 (防切Tab丢图)
│   ├── canvas-math.js          # 画布数学计算工具 (贝塞尔曲线、网格磁吸、文本折行)
│   ├── canvas-history.js       # 命令模式 30 步撤销/重做堆栈 (Undo/Redo)
│   ├── tool.js                 # 大模型 Tool Calling 原生技能注入引擎 (带熔断器与尺寸智能对齐)
│   ├── parser.js               # 智能模型元数据解析引擎
│   ├── updater.js              # 安全版本检查器 (只读检查无覆写)
│   ├── history.js              # 本地画廊创作历史库管理
│   └── sync.js                 # Cordis 配置安全合并器 (消除 TDZ 与进程误杀)
├── tests/
│   ├── canvas-math.test.js     # 画布几何计算与长文本折行单元测试
│   ├── canvas-storage.test.js  # 本地工程原子落盘与恢复测试
│   ├── canvas-job-queue.test.js# WAL 异步任务状态机测试
│   ├── circuit-breaker.test.js # 会话级熔断器状态机测试
│   ├── credentials.test.js     # 凭据别名解析与换行符防御测试
│   ├── patch-engine.test.js    # 零依赖增量合并与注释保留测试
│   ├── image-size.test.js      # 图像尺寸 32 倍数智能对齐测试
│   └── sync-security.test.js   # 凭据安全与防误杀单元测试
├── scripts/
│   ├── safe_install.cjs        # 官方标准安全增量合并安装器
│   ├── release.cjs             # 自动化 GitHub Release 发布工具
│   └── publish_to_github.cjs   # 基于 GitHub REST API 的免 Git CLI 发布引擎 (带脱敏审计)
├── cordis.patch.yml            # 官方 Bundle 补丁定义
├── icon.svg                    # 官方规范矢量图标
└── package.json                # 插件元数据与依赖定义 (v2.1.2)
```

---

## 开源许可证

本项目基于 [MIT License](LICENSE) 开源发布。
