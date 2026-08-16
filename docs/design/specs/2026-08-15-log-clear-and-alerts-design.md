# 2026-08-15 日志清除与警告/错误可见性

## 问题

1. 日志页「清除」只清空前端缓存，`logs.db` 分区表仍在；刷新或再进页面数据回来。
2. 侧栏气泡来自 mihomo websocket 的 warning/error；日志页默认正序只渲染 sqlite 历史，且 websocket 行未入库，所以警告/错误 tab 没有新数据。

## 方案

- 清除：删除 sqlite 日志分区表，记下 `cleared_at`，后续 ingest/sync 跳过该时刻及更早的行，避免 Service 快照把旧日志灌回来。不删流量表。
- 入库：后台告警监听与日志页直播把 warning/error 立即写入 sqlite。
- 展示：当天第 1 页无论正序/倒序都合并直播与历史。

## 事务

`clear_logs` 在同一 sqlite 事务里：丢弃写入队列、DELETE 分区表、更新 `cleared_at`，然后 vacuum。失败不提交。
`append_entries` 走现有 `INSERT OR IGNORE` flush。
