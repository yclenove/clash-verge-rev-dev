# Clash Verge Rev — 项目说明

> 本文档描述**本仓库**的技术架构、模块划分与开发约定。  
> 项目基于上游 [Clash Verge Rev](https://github.com/clash-verge-rev/clash-verge-rev)（Clash Meta / mihomo 的 Tauri 桌面客户端），并在 UI、流量统计、日志告警等方面做了较大定制。

---

## 1. 项目是什么

**Clash Verge Rev** 是一款跨平台代理客户端：

- **前端**：React 19 + TypeScript 6 + MUI 9，由 Vite 8 打包
- **壳层**：Tauri 2（Rust）
- **内核**：内置 [mihomo](https://github.com/MetaCubeX/mihomo)（Clash Meta），通过 `tauri-plugin-mihomo-api` 与之通信
- **能力**：订阅管理、规则/全局/直连模式、TUN、系统代理、链式代理、连接与日志查看等

本仓库在官方功能之上，重点增强了：

| 方向 | 说明 |
|------|------|
| **首页重构** | 订阅/节点、网络模式、系统信息等可拖拽排序的卡片式首页 |
| **流量页** | 独立「流量」导航，按目标/代理链统计排行，支持历史与图表 |
| **日志告警** | 高危日志徽标、滑动窗口计数、自动更新订阅并换节点 |
| **链式代理** | 多订阅合并下的链式选路、GeoIP 离线解析、规则组出口 |
| **i18n 精简** | 当前仅维护 **英文 / 简体中文**（`en`、`zh`） |
| **Windows 开发** | UTF-8 安全补丁流程（见 `docs/utf8-patch-windows.md`） |

---

## 2. 技术栈

| 层级 | 技术 |
|------|------|
| UI | React 19、MUI 9、`@dnd-kit` 拖拽、`@tanstack/react-virtual` 虚拟列表 |
| 状态 / 数据 | 自研 `query-client` 缓存、Context Provider、`foxact` localStorage |
| 构建 | Vite 8、TypeScript 6、`pnpm` 11 |
| 桌面 | Tauri 2、Rust 2024 |
| 测试 | Vitest 4、ESLint 10、Biome 2（格式）、Knip 6 |
| i18n | `i18next` + 生成类型 `src/types/generated/i18n-*.ts` |

**版本**（以 `package.json` 为准）：当前 `2.5.3`，许可证 `GPL-3.0-only`。

---

## 3. 架构概览

```
┌─────────────────────────────────────────────────────────┐
│  React 页面 (src/pages)                                  │
│  home · proxies · profiles · connections · traffic · …   │
└──────────────────────────┬──────────────────────────────┘
                           │ hooks / components
┌──────────────────────────▼──────────────────────────────┐
│  服务层 (src/services)                                   │
│  cmds · api · log-alert-* · traffic-rank-store · i18n    │
└──────────────────────────┬──────────────────────────────┘
                           │ Tauri invoke / events
┌──────────────────────────▼──────────────────────────────┐
│  Rust 后端 (src-tauri)                                   │
│  config · feat · core · cmd · enhance · module           │
└──────────────────────────┬──────────────────────────────┘
                           │ IPC / API
┌──────────────────────────▼──────────────────────────────┐
│  mihomo 核心 (sidecar 或系统服务)                         │
└─────────────────────────────────────────────────────────┘
```

**数据流要点**

- **Clash 配置**：`IProfilesConfig` → Rust `enhance` 合并 → 运行时 YAML → mihomo
- **Verge 应用设置**：`IVergeConfig` 存本地，经 `patchVerge` / `patchVergeConfig` 更新
- **实时数据**：连接、流量、日志、内存等经 **WebSocket**（`use-mihomo-ws-subscription`）或 REST 拉取
- **跨页共享**：`providers/app-data-context.tsx` 提供 proxy 视图、规则、uptime 等

---

## 4. 目录结构

```
clash-verge-rev/
├── src/                      # 前端源码
│   ├── pages/                # 路由页面（与 _navigation.tsx 对应）
│   ├── components/           # UI 组件（home / proxy / setting / …）
│   ├── hooks/                # 可复用逻辑（含 WS 订阅、GeoIP 等）
│   ├── services/             # API、告警、流量账本、通知
│   ├── providers/            # 全局 Context
│   ├── locales/{en,zh}/      # 前端 i18n JSON
│   ├── constants/            # 共享常量（如 IP 缓存键、storage 键名）
│   └── types/                # TS 类型与生成的 i18n 键
├── src-tauri/                # Rust 后端
│   └── src/
│       ├── cmd/              # Tauri 命令（geoip、profile、clash…）
│       ├── config/           # 配置模型与端口回退 (port.rs)
│       ├── core/             # 核心生命周期、托盘、服务、定时器
│       ├── feat/             # 业务功能（切模式、订阅、代理）
│       └── enhance/          # 配置增强（merge / script / tun）
├── crates/                   # 工作区 Rust crate（如 i18n）
├── scripts/                  # 构建、i18n、UTF-8 补丁、prebuild
└── docs/                     # 文档（含本文、巡检记录、UTF-8 说明）
```

---

## 5. 功能模块

### 5.1 导航与页面

| 路径 | 页面 | 职责 |
|------|------|------|
| `/` | 首页 | 节点/订阅卡、网络模式、系统信息；卡片显隐与排序可配置 |
| `/proxies` | 代理 | 规则/全局/直连、链式代理模式、节点组与延迟 |
| `/profiles` | 订阅 | 配置导入、更新、编辑 |
| `/connections` | 连接 | 实时连接列表 |
| `/traffic` | 流量 | 排行、图表、按目标/代理链维度统计 |
| `/rules` | 规则 | 规则列表 |
| `/logs` | 日志 | 内核日志流（可 `streamPaused` 暂停 UI，不关停后台告警） |
| `/unlock` | 测试 | 流媒体解锁检测 |
| `/settings` | 设置 | Verge / Clash / 系统项 |

布局壳：`src/pages/_layout.tsx`（侧栏、流量小组件、日志告警徽标、菜单排序）。

### 5.2 首页（定制）

- **`profile-proxy-card`**：当前订阅与策略组、自动选节点（按延迟）、出口 IP、**日志告警阈值**（默认 50 条 / 5 分钟窗口）
- **`network-mode-card`**：规则 / 全局 / 直连
- **`system-info-card`**：版本、运行模式、出口 IP、自启动等
- **`proxy-tun-card`**：TUN / 系统代理 / DNS 覆盖入口

首页布局持久化在 `verge.home_cards` 与 `verge.home_cards_order`。

### 5.3 日志告警与自动恢复

三层协作：

| 模块 | 文件 | 作用 |
|------|------|------|
| 后台监听 | `log-alert-monitor.ts` | 独立 WS，累计 warn/error，驱动导航徽标 |
| 速率窗口 | `log-alert-rate.ts` | 5 分钟滑动窗口计数、防抖通知 |
| 未读状态 | `log-alert-store.ts` | 徽标数字；在 `/logs` 页暂停累加 |
| **自动恢复** | `use-log-alert-auto-recovery-monitor.ts` | 在 `_layout` 全局挂载：超阈值 → 更新远程订阅 → 按延迟换节点 |

用户在首页开启「自动选节点」并设置阈值后，**无需停留在首页**即可触发恢复逻辑。  
Profile 级偏好存放在 `localStorage`（见 `constants/profile-proxy-storage.ts`）。

### 5.4 流量页

- **`traffic-rank-store.ts`**：按连接目标或代理链维度记账，按日分桶，localStorage 持久化
- **`use-connection-data.ts`**：后台 ingest，与连接页共享 WS
- **`traffic.tsx`**：排行表、详情展开、图表、暂停/清空历史

### 5.5 链式代理

- **入口**：代理页「链式模式」开关
- **状态**：`proxy-chain-items`、`proxy-chain-exit-node` 等 localStorage + `verge.proxy_chain_nodes`
- **组件**：`proxy-chain.tsx`、`proxy-groups-chain.tsx`、`proxy-chain-picker.tsx`
- **Cursor ISP 一键设置**：设置页 Clash 区块入口，写入静态 ISP 节点（`dialer-proxy` 前置组）、`EXIT` 组和全局 Cursor 规则；默认不打开全局链式模式
- **GeoIP**：Rust `cmd/geoip.rs` 离线 MMDB；前端 `use-servers-geoip.ts` 会话级缓存

### 5.6 Rust 后端要点

- **`config/port.rs`**：启动时混合端口冲突检测与回退；支持 `enable_random_port`
- **`core/timer.rs`**：订阅定时更新；失败发 `update_profile::error`
- **`feat/clash.rs`**：切模式、测延迟（`MixedPort::effective()`）
- **`feat/profile.rs`**：切节点、刷新代理配置事件

---

## 6. 开发环境

### 6.1 前置条件

- [Tauri 前置依赖](https://tauri.app/start/prerequisites/)（Rust、Node、各平台工具链）
- **pnpm**（`corepack enable`）
- Windows：建议 MSVC 工具链；改中文文案时需 Python 3（`scripts/utf8_patch.py`）

### 6.2 常用命令

```bash
pnpm i
pnpm run prebuild      # 拉取/准备 mihomo 等资源
pnpm dev               # 开发（保留本机 service 状态）
pnpm dev:sidecar       # 强制 Sidecar 模式
pnpm dev:service       # 安装/更新开发用 service 后启动

pnpm test              # Vitest
pnpm typecheck         # tsc
pnpm lint              # ESLint（max-warnings=0）
cargo check --workspace --all-targets --features clippy
cargo clippy-all --manifest-path src-tauri/Cargo.toml

pnpm i18n:types        # 改 locales 后重新生成 i18n 类型
```

### 6.3 Windows 下修改中文

**不要**在 PowerShell here-string 里直接写中文补丁。请使用：

1. `scripts/utf8_patch.py`，或  
2. `scripts/templates/utf8_patch_task.template.py` 派生的一次性 `.py` 脚本  

详见 [`utf8-patch-windows.md`](./utf8-patch-windows.md) 与根目录 [`AGENTS.md`](../AGENTS.md)。

### 6.4 代码约定（摘要）

- 新功能优先复用现有 hooks / `showNotice` / `patchVerge` 模式
- 列表大数据用虚拟滚动；链式模式列数固定为 1
- localStorage 与 profile 相关的键走 `utils/profile-scoped-storage.ts`
- 仅维护 `en` / `zh` 文案；改 JSON 后执行 `pnpm i18n:types`
- `lint-staged` 不对 `.scss` 跑 Biome（已在 `package.json` 配置）

---

## 7. 测试与质量

| 检查 | 命令 | 说明 |
|------|------|------|
| 单元测试 | `pnpm test` | Vitest：17 个文件、90 项测试 |
| 脚本测试 | `pnpm test:dev-control` | 3 个 Node 测试文件、58 项测试 |
| 类型 | `pnpm typecheck` | 严格 TS |
| 静态分析 | `pnpm lint` | ESLint，警告视为失败 |
| 死代码 / 依赖 | `pnpm knip:check` | 未使用文件、导出与依赖检查 |
| Rust | `cargo check --workspace --all-targets --features clippy` | workspace 全目标检查 |

合并后巡检与修复状态见 [`audit-post-merge.md`](./audit-post-merge.md)（含可勾选 Issue 清单 **ISSUE-001~009 / 101~104 / 201~207**）。

---

## 8. 国际化

- **支持语言**：`en`、`zh`（默认回退 `zh`）
- **前端**：`src/locales/{en,zh}/*.json`
- **Rust 托盘等**：`crates/clash-verge-i18n/locales/{en,zh}.yml`
- **类型安全键**：`src/types/generated/i18n-keys.ts`（由 `scripts/generate-i18n-keys.mjs` 生成）

---

## 9. 相关文档

| 文档 | 内容 |
|------|------|
| [README.md](../README.md) | 上游项目介绍、安装与发布 |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | 贡献与环境搭建 |
| [CONTRIBUTING_i18n.md](./CONTRIBUTING_i18n.md) | 翻译贡献 |
| [utf8-patch-windows.md](./utf8-patch-windows.md) | Windows UTF-8 补丁 |
| [audit-post-merge.md](./audit-post-merge.md) | 合并后巡检与修复状态 |
| [AGENTS.md](../AGENTS.md) | Agent / 自动化编辑约定 |

---

## 10. 许可与致谢

- 许可证：**GPL-3.0-only**
- 基于 [zzzgydi/clash-verge](https://github.com/zzzgydi/clash-verge) 及 [clash-verge-rev](https://github.com/clash-verge-rev/clash-verge-rev) 社区续作
- 内核：[MetaCubeX/mihomo](https://github.com/MetaCubeX/mihomo)

---

*文档版本：2026-07-29*
