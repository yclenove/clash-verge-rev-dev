# 日志库瘦身技术计划

日期：2026-08-15

## 步骤

1. `should_persist_log_level`：只允许 warning/error/fatal/critical。
2. `push` / `flush` / `ingest_*` 写入前过滤。
3. `open` 后 `purge_non_persisted_levels`，再 `enforce_size_cap`。
4. `SqliteLogStore` 增加 `db_path`、`max_db_bytes`（默认 200MB）；测试用 `open_with_limits`。
5. `prune_expired` 之后做 purge + size cap + `incremental_vacuum` + `wal_checkpoint(TRUNCATE)`；删不下去仍超顶时 `VACUUM`。
6. 改现有断言 info 入库的测试；补过滤与体积硬顶测试。

## 验证

- `cargo test -p clash-verge --features clippy log_store`
- 新库写入 info 后查询为 0；warning/error 仍在。
- 小硬顶测试：写入超限 warning 后，库文件不超过顶。
