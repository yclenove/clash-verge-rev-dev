# 2026-08-15 日志清除与警告/错误可见性 — 实现计划

1. `log_store`：`log_clear_state.cleared_at`、`clear_logs`、`append_entries`、flush/push 跳过 `ts <= cleared_at`。
2. 命令：`clear_clash_logs`、`append_clash_logs`；同步清内存 `CLASH_LOGGER`。
3. 前端：清除按钮 await 清库；告警 socket 与直播流持久化 warning/error；当天首页合并直播日志（含正序）。
4. 单测：clear 后旧行不回潮；正序合并直播；`pnpm typecheck`。
