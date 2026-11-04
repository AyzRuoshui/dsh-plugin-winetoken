# DeepSeek Harness (DSH) - WineToken 原生聚合插件

[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-v0.2.1--rc.5-blue)](https://github.com/deepseek-ai/deepseek-harness)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![GitHub Release](https://img.shields.io/github/v/release/AyzRuoshui/dsh-plugin-winetoken)](https://github.com/AyzRuoshui/dsh-plugin-winetoken/releases)

专为 **DeepSeek Harness (dsh) 桌面客户端** 打造的原生内置官方规范插件。仅需填写 WineToken API Key，即可将全平台真实上架的精选推理模型（王者荣耀灵宝、Claude 5.5/4.6、MiniMax、SenseNova 等）无缝导入 Harness，并在对话界面底部状态栏原生展示实时余额与订阅用量进度条。

---

## ✨ 核心特性

- **100% 官方标准插件 Bundle 规范**：
  - 严格遵循 Harness 官方 Bundle 规范（`dsh.bundle.patch` 与 `dsh.client`）；
  - 配备完整的国际化元数据（`locale/zh.json`、`locale/en.json`）与官方矢量图标；
  - **原生陈列于左侧边栏「插件」中心**，支持在界面中查看详情、启用与管理。
- **左侧导航栏原生内置「创作工坊 (Studio)」**：
  - 无缝接入主导航栏（紧跟在「自动化任务」下方），拥有独立全功能创作空间；
  - 直调 WineToken 平台原生生图（GPT-Image 2.5 Flare/Sunburst、Imagen-3、SenseNova U1.5 Lite、Grok 2.0 等）与生视频（MiniMax-H3、Grok Video 1.5）模型；
  - 支持常用画幅比例（1:1、16:9、9:16）切换与纯人民币（¥）实时生成费用预估；
  - 支持一键导出下载成果至本地与本地历史作品展台。
- **对话底部状态栏原生资产展示**：
  - 无缝接入状态栏（`data-composer-dock`），样式与官方 `hNGZaa_pill` 视觉完美契合；
  - **30 秒定时静默轮询** 最新余额，点击胶囊亦可随时手动立即刷新；
  - **智能订阅感知**：
    - 若账户拥有有效周期订阅，额外呈现微型**已用配额进度条**（鼠标悬停查看配额与剩余天数）；
    - 若账户为普通充值余额（无订阅），**进度条严格隐匿**，仅纯粹展示可用余额。
- **开机静默同步与全模态规格推断**：
  - 启动时自动与 WineToken 网关拉齐模型，自动映射 256K/1M 真实上下文、64K/384K 输出限制与视觉输入能力；
  - 支持 DeepSeek Harness 内置 HMR 热更新，模型更新无需反复重启。
- **极致绿色纯净 (Zero System Pollution & Zero Asar Tampering)**：
  - **100% 官方标准插件机制**：基于 DeepSeek Harness 官方 Cordis 微内核与原生 React 插槽注入，**绝对不修改任何 `app.asar`** 核心包，零文件破坏风险，升级无忧；
  - **多插件无缝共存安全承诺**：采用官方模块命名空间隔离与增量合并（Deep Merge），**绝对不覆写、不清空用户的任何现有已装插件或 Profile 配置**；
  - **绝不**在桌面上生成伴随启动的冗余快捷方式，100% 保持官方原版启动体验；
  - **绝不**注册 Windows 计划任务或后台系统常驻服务；
  - 所有网络请求与状态轮询严格随 DSH 客户端进程生命周期同生共死。

---

## 🔌 安装与使用 (官方标准增量安装 · 零风险保证)

本插件原生符合 DeepSeek Harness 第三方插件标准规范，**已通过多插件共存兼容性测试，绝不会影响您已经安装的其他任何插件**。

### 方式一：客户端界面原生安装 (最推荐 · 官方原生零脚本)
1. 打开 **DeepSeek Harness** 客户端；
2. 点击左侧边栏的 **「插件」** 图标；
3. 点击右上角的 **「+ 添加插件」**，在下拉菜单中选择 **「安装第三方插件」**；
4. 在弹出框中粘贴安装地址：
   - **普通电脑首选 (免 Git 极速归档包)**：
     ```text
     https://github.com/AyzRuoshui/dsh-plugin-winetoken/archive/refs/heads/main.tar.gz
     ```
   - **开发环境 (已安装 Git)**：
     ```text
     https://github.com/AyzRuoshui/dsh-plugin-winetoken
     ```
5. 点击确认，Harness 内置包管理器会自动将插件**安全增量追加**至您的 Profile 依赖中，已有插件 100% 原样保留！
6. 首次在对话框底部点击 WineToken 状态胶囊，填入您的 WineToken API Key 即可！

### 方式二：本地安全增量安装脚本 (离线或本地源码开发)
若您下载了源码压缩包到本地，可直接在工程根目录下运行官方安全增量安装器：
```bash
node scripts/safe_install.cjs
```
> 🛡️ **安全机制说明**：该脚本在执行前会自动对您的 `package.json` 和 `cordis.patch.yml` 进行带时间戳的 `.bak` 备份，并以只追加（Append Only）模式注入依赖，绝对不触碰 `app.asar`，绝对不覆盖既有第三方插件。

---

## 🛡️ 安全合规与多插件生态保障

| 维度 | WineToken 插件保障机制 |
|---|---|
| **客户端核心包 (app.asar)** | **100% 零篡改**。纯官方 React 插槽注入，不碰任何客户端本体文件，完整性校验永不失效。 |
| **既有插件配置** | **100% 完好无损**。官方 pnpm 包管理器与 safe_install 均采用严格增量合并，绝不覆盖其他插件。 |
| **API 密钥与凭证安全** | 凭证仅保存在用户本地 `~/.dsh/.credentials.yaml` 中，源码中绝无任何硬编码密钥。 |
| **消费与资产安全** | 严格遵循零消耗审计准则，绝不在后台静默发起任何消耗性生图/生视频请求。 |

---

## 📸 界面预览与规范展示

### 1. 官方插件中心陈列
进入客户端左侧边栏的 **「插件」**，可在列表中直观看到 **WineToken AI 聚合网关** 卡片。

### 2. 底部输入框状态栏 (Composer Dock)
- **普通真实余额账户（无订阅）**：`余额 ¥128.50 · 已用 ¥12.30`
- **周期订阅套餐账户**：`余额 ¥500.00 · 已用 ¥120.00 · 24% [====  ]`

### 3. 左侧主导航「创作工坊」
紧跟在左侧边栏「自动化任务」下方，点击直达专属多模态创作工作室，支持生图、生视频与历史成果管理。

> **更新记录**：详细版本迭代与更新日志请参阅 [GitHub Releases](https://github.com/AyzRuoshui/dsh-plugin-winetoken/releases)。

---

## 🛠️ 项目结构

```text
G:\dsh-plugin-winetoken\
├── locale\
│   ├── zh.json             # 官方规范中文插件介绍
│   └── en.json             # 官方规范英文插件介绍
├── src\
│   ├── index.js            # 官方规范 Host 端插件入口 (开机模型同步 & 自动更新调度)
│   ├── client.js           # 官方规范 Client 端渲染模块 (状态栏组件)
│   ├── updater.js          # 原生内置静默自动更新引擎
│   ├── parser.js           # 智能模型元数据解析引擎
│   └── sync.js             # Cordis 配置安全合并器
├── scripts\
│   ├── safe_install.cjs    # 官方标准安全增量合并安装器 (自动备份 & 零数据丢失)
│   ├── release.cjs         # 自动化 GitHub Release 发布工具
│   └── publish_to_github.cjs# GitHub 同步工具
├── cordis.patch.yml        # 官方 Bundle 补丁定义
├── icon.svg                # 官方规范矢量图标
└── package.json            # 官方规范插件元数据
```

---

## 📄 开源许可证

本项目基于 [MIT License](LICENSE) 开源发布。
