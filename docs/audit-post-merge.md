# 合并后全量巡检记录

> **基准提交**：`becc3a0`（`merge: integrate origin/dev into local dev`）  
> **巡检时间**：2026-07-29  
> **分支**：`dev`（本地，未推送）  
> **范围**：合并 `origin/dev` 后的工作区全量审查（首页 / 代理 / 日志 / 流量 / 订阅 / 设置 + Rust 后端）

---

## 自动化基线

| 检查项 | 合并后巡检时 | Major 修复后 | 本轮全量复检 |
|--------|--------------|--------------|----------------|
| Vitest | 87/87 | 87/87 | **90/90**（17 个文件） |
| Node 脚本测试 | — | — | **58/58**（3 个文件） |
| TypeScript | 通过 | 通过 | 通过 |
| ESLint | 通过 | 通过 | 全量 `src` 通过；末次改动目标复检通过 |
| Vite 生产构建 | — | — | 通过（14163 modules） |
| i18n | — | — | 前后端 unused / missing / extra 均为 0 |
| Knip | — | — | 通过（仅 2 条样式扩展配置提示） |
| Biome | — | — | 311 个文件按原行尾检查通过（294 CRLF / 17 LF） |
| `cargo fmt --all --check` | — | — | 通过 |
| `cargo clippy-all` | — | — | 通过（`-D warnings`） |
| Cargo workspace check | 通过 | 通过 | 全 workspace / all targets / `clippy` feature 通过 |
| Cargo workspace test | — | — | **344 项测试通过**；7 个 bench 目标成功 |

**Critical：0** — 未发现必现崩溃、数据损坏或明确安全漏洞。

---

## Major（15 条）— 已全部修复

> 以下修复在 `becc3a0` 之后完成，**截至本文档编写时仍在工作区，未单独 commit**。

### 首页 / 布局

| # | 问题 | 位置 | 修复摘要 |
|---|------|------|----------|
| 1 | 代理切换失败仅 `console.error` | `profile-proxy-card.tsx` | `showNotice.error` 提示用户 |
| 2 | TUN / 系统代理开关乐观更新，失败后 UI 与配置不一致 | `proxy-control-switches.tsx`、`use-system-proxy-state.ts` | `patchVerge` 失败时回滚 `verge` 缓存 |
| 3 | 订阅列表清空后仍显示旧 chip | `use-subscription-nodes.ts` | 列表为空时返回空 map |
| 4 | 日志告警自动恢复仅在首页卡片挂载时生效 | 原 `profile-proxy-card.tsx` | 见 Minor：已上提至 `_layout` |

### 代理

| # | 问题 | 位置 | 修复摘要 |
|---|------|------|----------|
| 5 | `isConnected` 误判（单节点链 / localStorage 比对） | `proxy-chain.tsx` | 修正连接状态判定逻辑 |
| 6 | 删除链未与「断开」一致 | `proxy-chain.tsx` | 抽出 `disconnectChain()`，删除链时同步断开 |
| 7 | 链内重复检测 `recordId` vs `name` 不一致 | `proxy-groups-chain.tsx`、picker | 统一按 `name` + `recordId` |
| 8 | 切换规则组时静默清链，无断开 / 提示 | `proxy-groups-chain.tsx` | 清运行时链配置、旧组选择与持久化连接态，关闭连接并刷新；保留草稿节点并提示用户 |

### 日志

| # | 问题 | 位置 | 修复摘要 |
|---|------|------|----------|
| 9 | 批 flush 共用时间戳，排序失真 | `use-log-data.ts` | 每条日志独立时间戳 |
| 10 | 级别过滤用子串 `.includes()` | `logs.tsx` | 精确匹配 `warn` / `err` / `info` / `debug` |

### 订阅 / 设置

| # | 问题 | 位置 | 修复摘要 |
|---|------|------|----------|
| 11 | 导入刷新失败却提示成功文案 | `profiles.tsx` | 仅在刷新成功后提示导入成功；最终失败使用有效的 `notices.emergencyRefreshFailed` 键和错误插值 |
| 12 | 端口冲突后仍继续 `patchVerge` | `clash-port-viewer.tsx` | 冲突 / 校验失败有 toast；全部成功后才关窗 |
| 13 | 定时更新失败仍清 loading、无错误提示 | `timer.rs`、`profiles.tsx` | Rust 发 `update_profile::error` 事件 |

### Rust 后端

| # | 问题 | 位置 | 修复摘要 |
|---|------|------|----------|
| 14 | `test_delay` 用 `desired()` 端口 | `feat/clash.rs` | 改用 `MixedPort::effective()` |
| 15 | `change_clash_mode` 持久化失败仍 `Ok` | `feat/clash.rs` | `save_config` 失败返回 `Err` |

**附带修复（Major 轮）**

- `feat/profile.rs`：`switch_proxy_node` 重试成功也 emit `refresh-proxy-config`
- `tun-viewer.tsx`：恢复默认后调用 `enhanceProfiles()`

---

## Minor（体验 / 一致性）— 已修复

| 模块 | 问题 | 修复摘要 |
|------|------|----------|
| 布局 | 日志自动恢复依赖首页挂载 | 新增 `use-log-alert-auto-recovery-monitor`，在 `_layout.tsx` 全局监听 |
| 首页 | `home.tsx` 卡片设置保存无错误处理 | `try/catch` + `showNotice.error` |
| 首页 | DNS 开关 `setTimeout` 无清理 | `useRef` 管理定时器，卸载时 `clearTimeout` |
| 首页 | 出口 IP 失败硬编码 `--` | i18n：`home.components.currentProxy.status.ipUnavailable` |
| 首页 | 订阅筛选未按 profile 隔离 | `STORAGE_KEY_SUBSCRIPTION` 走 profile-scoped storage |
| 首页 | `system-info-card` 在 `!verge` 时空白 | 显示骨架屏 |
| 首页 | 自启动切换失败无提示 | `toggleAutoLaunch` 失败 `showNotice.error` |
| 首页 | ASN 显示硬编码 `N/A` | `shared.labels.notAvailable` |
| 首页 | IP 缓存键重复定义 | 抽取 `src/constants/ip-info-cache.ts` |
| GeoIP | 查找失败后永不重试 | 负缓存到期后自动调度 60s 重试，并新增 fake timer 测试 |
| 代理 | 无 `exit-node` 时链配置无法恢复 | `proxies.tsx` 从 `verge.proxy_chain_nodes` 回退 |
| 代理 | global 模式 `runtimeConfig` 未加载时空列表 | 回退 `selectAllChainNodes` |
| 代理 | 链模式滚动恢复单次设置无效 | RAF 跨帧重试（`proxy-groups.tsx`） |
| 代理 | `chainConfigHydratedRef` 只 hydrate 一次 | 随 `chainConfigData` 变化可重新 hydrate |
| 日志 | `enable` 与 `streamPaused` 语义混用 | `use-clash-log.ts` 迁移：`enable: false` → `streamPaused: true` |
| 日志 / WS | JSON 解析失败静默 | `use-log-data.ts`、`use-mihomo-ws-subscription.ts` 增加 `console.warn` |
| 布局 | 导航菜单排序失败无反馈 | `use-nav-menu-order.ts` → `showNotice.error` |
| Rust | `enable_random_port` 无候选端口时静默 | `port.rs` 增加 `warn` 日志 |
| 存储 | profile 级 localStorage 逻辑分散 | 新增 `src/utils/profile-scoped-storage.ts`、`src/constants/profile-proxy-storage.ts` |

---

## 待办 Issue 清单（可勾选）

> 完成一项后将 `[ ]` 改为 `[x]`。部分完成的 Issue 按子任务逐项勾选。

### 代码修复

| ID | 优先级 | 状态 | 任务 |
|----|--------|------|------|
| [x] **ISSUE-001** | 中 | 已完成 | **[Rust] 清理 updater dead_code** — 删除未接入的 `core/updater.rs`、启动初始化、前后端更新 UI / 状态 / 依赖、Rust runtime 插件与遗留翻译 |
| [ ] **ISSUE-002** | 中 | 代码完成 / 待手测 | **[代理] 规则组切换时清链与 UI 不一致** — 代码路径已同步，保留最后一个手动验证子任务 |
| [x] **ISSUE-003** | 低 | 已完成 | **[首页] 安装服务失败无用户提示** — 捕获失败并调用 `showNotice.error` |
| [x] **ISSUE-004** | 可选 | 已评估 | **[Rust] `owned_service_core_uses_port` 策略** — 保留保守所有权判断，避免把当前用户 service 的端口误判为可安全接管 |
| [x] **ISSUE-005** | 高 | 已完成 | **[构建] `js-yaml@5` 无 default export** — 三处改为 namespace import，生产构建恢复 |
| [x] **ISSUE-006** | 高 | 已完成 | **[日志] 自动恢复读到旧状态且误报切换成功** — 使用 live ref，`changeProxy()` 返回并等待真实成功结果，补充成功 / 失败测试 |
| [x] **ISSUE-007** | 中 | 已完成 | **[GeoIP] 负缓存到期不自动重试** — 增加 60s 自动重试调度和测试 |
| [x] **ISSUE-008** | 中 | 已完成 | **[代理] global 模式 runtime config 未就绪时链节点为空** — 回退 `selectAllChainNodes` |
| [x] **ISSUE-009** | 中 | 已完成 | **[质量] Clippy / Biome / Knip / i18n 门禁失败** — 清理 dead code 与依赖、修正格式和 i18n 键路径，补齐脚本测试入口 |

#### ISSUE-002 子任务

- [x] 切换规则组时执行等价断开逻辑：清运行时配置、旧组选择并关闭连接
- [x] `isConnected` 仅跟随 live core state，不再用 localStorage 伪造连接态
- [x] 清链时显示提示，并保留新出口组可复用的草稿节点
- [ ] 手动验证：规则模式下换出口组 → 链列表保留、连接态正确、可重新连接

---

### 流程 / 仓库卫生

- [ ] **ISSUE-101** — 将 Major + Minor 修复整理为 commit（工作区约 30+ 文件）
- [ ] **ISSUE-102** — 按需推送到远程（当前约定：本地 `dev`，未 push）
- [x] **ISSUE-103** — 已清理本轮 `_tmp_*.py` 与 `scripts/__pycache__/` 临时产物
- [x] **ISSUE-104** — 已更新本文档修订记录与全量复检状态；人工测试和 commit / push 状态继续保留

---

### 手动验证（commit 前建议）

- [ ] **ISSUE-201** — 日志告警自动恢复：非首页堆积 warn/error → 触发订阅更新并换节点
- [ ] **ISSUE-202** — 日志页停留后回首页：不因历史样本误触发换节点
- [ ] **ISSUE-203** — 链式代理：连接 / 断开 / 删除链行为一致（含 ISSUE-002 场景）
- [ ] **ISSUE-204** — 端口设置：冲突不部分写入；随机端口无候选时有 `warn` 或 fallback 通知
- [ ] **ISSUE-205** — TUN / 系统代理：失败时开关回滚
- [ ] **ISSUE-206** — 订阅导入：刷新失败显示 `emergencyRefreshFailed`
- [ ] **ISSUE-207** — 首页卡片设置保存失败有 toast；DNS 开关快速切换无定时器泄漏

---

## 剩余人工 / 流程项（摘要）

<details>
<summary>与上方 Issue 对照的简要表（点击展开）</summary>

### 代码处理结果

| 状态 | 内容 | Issue |
|------|------|-------|
| **已完成** | updater dead code、安装服务 toast、构建、自动恢复、GeoIP、global fallback、质量门禁 | ISSUE-001 / 003 / 005~009 |
| **已评估** | 保留 service 端口所有权的保守策略 | ISSUE-004 |
| **待手测** | 规则组切换清链代码已完成，仅剩交互验证 | ISSUE-002 |

### 流程 / 仓库卫生

见 **ISSUE-101 ~ ISSUE-104**。

</details>

---

## 已验证正常（审查范围内）

- 日志告警：`log-alert-store` / `log-alert-rate` / `log-alert-monitor` 与 `_layout` 分工清晰；日志页 `streamPaused` 不关停后台监控
- 流量：`traffic-rank-store` 记账与裁剪；暂停时 UI 冻结、后台仍 ingest
- 端口：`port.rs` 事务化回退；随机端口无候选时记录 `warn`
- 代理链 rebind、多订阅、`group-list-key` 编解码
- i18n（en/zh）审计范围内键齐全（含本轮新增 `ipUnavailable`、`notAvailable`）
- `setting-verge-dialog-host`、杂项设置与 Rust 字段对齐

---

## 手动测试清单

> 与 **ISSUE-201 ~ ISSUE-207** 相同，便于在 Issue 区块统一勾选；此处保留展开说明。

建议在 commit 前逐项点验：

1. **日志告警自动恢复**：开启自动选节点 + 调低阈值 → 在非首页页面堆积 warn/error → 应触发订阅更新并换节点
2. **回首页不误触发**：在日志页停留后回首页，不应因历史样本立即换节点
3. **链式代理**：连接 / 断开 / 删除链行为一致；切换规则组后草稿节点保留、运行时断开且 UI 连接态正确
4. **端口设置**：冲突时不应部分写入；随机端口开启后重启见 `warn` 或 fallback 通知
5. **TUN / 系统代理**：故意断网或拒绝权限时开关应回滚
6. **订阅导入**：刷新失败应显示 `emergencyRefreshFailed`，而非成功文案
7. **首页卡片设置**：保存失败应有 toast；DNS 开关快速切换不应泄漏定时器

---

## 关键新增文件

| 路径 | 用途 |
|------|------|
| `src/hooks/use-log-alert-auto-recovery-monitor.ts` | 全局日志告警自动恢复 |
| `src/constants/ip-info-cache.ts` | 首页 IP 查询共享 React Query key |
| `src/constants/profile-proxy-storage.ts` | Profile 代理相关 localStorage 键名 |
| `src/utils/profile-scoped-storage.ts` | Profile 级 localStorage 读写 + 旧键迁移 |
| `src/hooks/use-proxy-selection.test.tsx` | 代理切换成功 / 失败返回值测试 |
| `src/hooks/use-servers-geoip.test.ts` | GeoIP 负缓存 60s 自动重试测试 |
| `src/hooks/use-proxy-selection.test.tsx` | 代理切换成功 / 失败返回值测试 |
| `src/hooks/use-servers-geoip.test.ts` | GeoIP 负缓存 60s 自动重试测试 |

---

## 修订记录

| 日期 | 说明 |
|------|------|
| 2026-07-29 | 初稿：合并后巡检 + Major / Minor 修复状态汇总 |
| 2026-07-29 | 新增「待办 Issue 清单」：未修项拆为 ISSUE-001~004 / 101~104 / 201~207 |
| 2026-07-29 | 全量复检与修复：完成 ISSUE-001 / 003~009 / 103~104；ISSUE-002 代码完成待手测；同步 90 项前端、58 项脚本和 344 项 Rust 测试结果 |
