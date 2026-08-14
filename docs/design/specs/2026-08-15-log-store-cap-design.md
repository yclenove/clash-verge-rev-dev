# 日志库瘦身设计

日期：2026-08-15

## 目标

停止把 Mihomo 的 info/debug 全文留 7 天。磁盘只保留对排障有用的日志，并给 `logs.db` 加硬顶，避免再出现几天 20GB。

## 策略

- 默认只持久化 `warning` / `error`（含 `warn`/`err` 别名，以及 `fatal`/`critical`）。
- `info` / `debug` / `unknown` 不入 SQLite；启动时清掉库里已有的这类行。
- 整个 `logs.db`（含 WAL）硬顶 **200MB**。超了先删最旧 warning/error 和过期连接，再 vacuum / checkpoint。
- 连接摘要仍按 3 天保留，但也受 200MB 硬顶约束。
- 应用 `latest.log` 轮转不变。日志页实时流仍走内存缓冲，不受本策略影响。

## 非目标

- 不恢复应用内自动更新。
- 不改 sidecar 文件轮转参数（单文件 128KB × 8，不是 20GB 来源）。
- 不做设置页开关（需要时再加）。
