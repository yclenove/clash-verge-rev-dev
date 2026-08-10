# 项目增量计划：SQLite 日志库 + 日志关联流量分析

> 关联流量分析结论：Codex 会话 `019fc3c1-2714-74f2-956c-704f6bbead0f`
> 本版已按审查意见修订：写入背压、分页查询、连接源端口关联、关闭连接记账、回填去重、service 模式与验收指标。

## 摘要

- 用 SQLite 保存所有核心/应用日志，正式解决“气泡有提醒、日志页看不到”的历史丢失问题。
- 基于连接明细 + 核心日志重建更精确的流量归因，修复 `verge-traffic-rank-v2` 按进程聚合导致“27G 全算到 `api.synaglobal.vip`”的误报。
- SQLite 只做结构化主存储；Zvec 不作为日志主存储，仅可作后续相似错误检索旁路。

## 现状与临时修复

- 日志气泡根因：后端内存缓冲仅 100 行，info 日志把 warning 挤掉；前端缓存再次进入日志页时不刷新。
- 已落地临时修复：后端读取 `logs/sidecar/*.log` 最近 24 小时；前端把全天历史与实时日志分开，历史安全上限 10 万行。
- 本计划用 SQLite 正式取代内存/文件临时方案，并扩展为“所有日志 + 流量关联”。

## 阶段一：SQLite 日志存储

### 架构

- 新增 `rusqlite`（bundled SQLite），启用 `journal_mode=WAL`、`busy_timeout`、`auto_vacuum=INCREMENTAL`。
- 一个写连接 + 独立读连接；`tokio::sync::Mutex` 只保护写连接，避免读查询阻塞写入。
- 写入链路：sidecar stdout/stderr 行 → 有界 `mpsc` channel → 独立 worker 每 50-100ms 或每 200 条批量事务写入 SQLite。
- channel 满时丢弃最旧日志并计数告警，绝不让 SQLite 写入反向阻塞 core stdout 读取。
- 写入失败降级为现有文件写入，核心运行不受影响。

### 表结构

```sql
CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  level TEXT NOT NULL,
  source TEXT NOT NULL,
  payload TEXT NOT NULL,
  raw TEXT NOT NULL,
  raw_hash TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_logs_source_ts_hash
  ON logs(source, ts, raw_hash);
CREATE INDEX IF NOT EXISTS idx_logs_ts ON logs(ts);
CREATE INDEX IF NOT EXISTS idx_logs_level_ts ON logs(level, ts);
CREATE INDEX IF NOT EXISTS idx_logs_source_ts ON logs(source, ts);
```

- `source`：`core`、`app`、`frontend`，后续可扩展 `service`。
- `raw` 仅用于审计/回填比对；查询和展示优先使用 `ts/level/payload`。
- `raw_hash` 用于回填去重与幂等写入。

### 写入

- sidecar stdout/stderr 每行解析 `time/level/msg`，结构化后进入写入队列。
- app 日志（Rust `Logger`）接入 `source='app'`，实现“所有日志”落库。
- 写入批次使用 `INSERT OR IGNORE`，按 `(source, ts, raw_hash)` 去重。

### 读取与分页

- `get_clash_logs` 改为返回结构化 `ILogItem[]`，不再返回 raw line；前端 `getClashLogs` 同步改造一次，移除脆弱正则解析。
- 命令增加查询参数：`from_ts`、`to_ts`、`level`、`source`、`limit`、`cursor`。
- 查询固定 `ORDER BY ts, id`；分页用 `(ts, id)` 游标，避免深分页 `OFFSET`。
- 前端日志页改为增量加载：历史按页拉取，实时日志仍走 WebSocket 小缓冲，两者按 `(ts, id)` 合并。
- 前端 `MAX_HISTORY_LOG_NUM` 保留为单次渲染安全上限（默认 10 万），但不再代表“日志只保留 10 万行”。

### 保留与清理

- 默认保留 7 天，可通过配置选择 1/3/7/30 天。
- 启动时清理一次，之后每日定时清理；不在每个写入批次后删除。
- 定期执行 `incremental_vacuum`（阈值：日志文件超过 128MB 或每月一次），防止 DELETE 后文件膨胀。

### 回填

- 首次启用从 `logs/sidecar/*.log` 回填当前保留期历史。
- 回填按 `(source, ts, raw_hash)` 幂等；记录每个文件的 `path + mtime + offset` checkpoint，避免重复导入。

### service 模式

- service 模式纳入 M1 验收，不允许留到以后。
- 实现二选一：service 进程直接写同一 SQLite 文件；或 UI 进程定期导入 service 日志文件并去重。

### 测试与指标

- Rust：建表/写入/查询/分页/清理/回填/去重/背压/降级单测。
- 前端：`getClashLogs` 结构化契约、分页加载、搜索、实时合并测试。
- 指标：写入不阻塞 core stdout；10 万行历史查询 < 500ms；日志页首屏 1 万行 < 200ms；10k lines/s 日志风暴下不丢新增（只丢最旧且可观测）。

## 阶段二：日志关联流量增强

### 问题口径

`verge-traffic-rank-v2` 按进程聚合，副标题只取一个“主域名”，导致：

- `firefox.exe` 累计下载 27.76 GiB 全部显示为 `api.synaglobal.vip`。
- 真实大头是 8/1 从 `66.154.115.131` 下载 hermes 备份/迁移包（约 20.76 GiB，另有约 4 GiB 中断重传），以及 8/2 约 5.45 GiB 上传。
- `api.synaglobal.vip` 域名本身 7/29-8/3 仅约 0.12 GiB。

### 数据模型

```sql
CREATE TABLE IF NOT EXISTS connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  connection_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  closed_at INTEGER,
  process TEXT,
  host TEXT,
  ip TEXT,
  port INTEGER,
  source_port INTEGER,
  destination_port INTEGER,
  rule TEXT,
  proxy TEXT,
  upload INTEGER NOT NULL DEFAULT 0,
  download INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_connections_id
  ON connections(connection_id);
CREATE INDEX IF NOT EXISTS idx_connections_started ON connections(started_at);
CREATE INDEX IF NOT EXISTS idx_connections_host_ip ON connections(host, ip);
CREATE INDEX IF NOT EXISTS idx_connections_process ON connections(process, started_at);
CREATE INDEX IF NOT EXISTS idx_connections_ports ON connections(source_port, destination_port);
```

### 连接字节记账

- 复用现有 `traffic-rank-store` 的“每次 WS 快照 diff”逻辑，不重写。
- 连接从快照中消失时，把最后一次快照的 `upload/download` 记为最终值并写入 `closed_at`。
- 对漏快照/重启造成的缺口，用 core 日志补 join，并给该行标记 `confidence`（高/低）。

### 日志关联 key

- 主关联键：`(process, host, source_port, destination_port, time window)`。
- core 日志解析源端口（如 `127.0.0.1:13269(cc-switch.exe)`），连接 metadata 提供 `sourcePort/destinationPort`。
- 禁止只用 `host/ip/process/time` 模糊关联，避免同进程同域名并发连接归因错误。

### 归因口径

- 流量主表改为逐连接记账：`process × host × ip × proxy × date`。
- 流量排行 UI 支持二级展开：进程 → 域名/IP → 连接列表。
- 副标题不再从“主域名”猜测，而是取该进程当天流量最大的 `host` 或 `ip`，并允许展开查看完整拆分。

### 兼容与降级

- SQLite 为主存储；`verge-traffic-rank-v2` localStorage 继续保留为离线/降级数据，启动时只读兼容导入。

### 验证用例

- 用 7/29-8/3 fixture 复现 27G 案例。
- 断言：`api.synaglobal.vip` 约 0.12 GiB；`66.154.115.131` 下载约 23.33 GiB、上传约 5.45 GiB。
- 断言：8/1 两个成功文件 + 中断重传与 Clash 下载字节对齐。
- 断言：同进程同域名并发连接按 `source_port` 正确拆分，归因误差 < 1%。

## 里程碑

- M1：SQLite 日志库（worker/WAL/分页/清理/回填/service 模式/指标）+ 测试。
- M2：连接明细落库、关闭连接记账、日志 join、`process × host × ip` 聚合。
- M3：流量页二级明细展示、localStorage 兼容、27G 回归与性能验收。

## 假设

- 默认日志保留 7 天，可通过配置调整。
- 阶段一同时覆盖 sidecar 与 service 模式。
- Zvec 不做日志主存储；如需要相似错误检索，再作为向量旁路接入。
