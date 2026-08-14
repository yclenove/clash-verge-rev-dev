# 2026-08-15 日志库瘦身

## 日期

2026-08-15

## 变更摘要

SQLite 日志库默认只保存 warning/error，启动时清掉已有 info/debug/unknown。`logs.db` 硬顶 200MB，超出则删最旧记录并回收文件空间。

## 动机

这个分叉把核心每一行 info 留 7 天，Mac 上几天就能把 `logs.db` 顶到 20GB。日志页只分页看最近告警，流量归因走连接摘要，不需要全文 info。

## 涉及文件

- `src-tauri/src/core/log_store.rs`
- `docs/design/specs/2026-08-15-log-store-cap-design.md`
- `docs/design/plans/2026-08-15-log-store-cap.md`
- `docs/changelog/2026-08-15-log-store-cap.md`

## 是否需迁移 / 重启

需要重启应用。首次启动会清理旧 info 并 vacuum，若原库已经很大，这一次可能多花几十秒。不需要手改配置。旧的 20GB `logs.db` 会在启动后瘦下来。

## 验证方式

1. `cargo test -p clash-verge --features clippy log_store` 通过。
2. 启动后看 `logs/logs.db` 体积，应远小于 200MB。
3. 日志页仍能看到 warning/error；info 历史不再从库里回放，实时流仍可用。
