# 2026-08-15 日志清除与警告/错误可见性

日期：2026-08-15

## 变更摘要

日志页「清除」会删除 `logs.db` 中的日志分区表，并记下 `cleared_at`，避免 Service 快照把旧行灌回来。后台告警 websocket 与日志页直播把 warning/error 写入 sqlite。当天第 1 页无论正序还是倒序都合并直播行。

## 动机

清除原先只清前端缓存，刷新后又出现。侧栏气泡来自 websocket，警告/错误 tab 只查 sqlite 且默认正序不合并直播，所以有气泡却看不到新数据。

## 涉及文件

- `src-tauri/src/core/log_store.rs`
- `src-tauri/src/core/manager/state.rs`
- `src-tauri/src/cmd/clash.rs`
- `src-tauri/src/lib.rs`
- `src/hooks/use-log-data.ts`
- `src/pages/logs.tsx`
- `src/services/log-alert-monitor.ts`
- `src/services/persist-clash-logs.ts`
- `src/services/cmds.ts`
- `Changelog.md`

## 事务

`clear_logs` 在同一 sqlite 事务里清空写入队列对应的分区表并更新 `log_clear_state.cleared_at`。失败不提交。流量表不动。

## 迁移 / 重启

无需手动迁移。重新打开日志页即可。无需重启内核。

## 验证

- `pnpm typecheck`
- `cargo test --config "build.rustc-wrapper=''" clear_logs_deletes_rows_and_blocks_old_reingest -- --nocapture`（需 `CV_EMBED_TEST_MANIFEST=1`）
- 点击清除后刷新日志页，旧行不再出现
- 离开日志页产生警告后，警告/错误 tab 能看到对应行
