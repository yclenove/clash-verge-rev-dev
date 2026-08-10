# Clash Verge OHOS 真机巡检计划

巡检对象：MateBook Pro (HAD-W32)，`hdc -t 192.168.124.253:39937`，API 24。
巡检包：`io.github.clash_verge_rev.clash_verge_rev`。

## 巡检频率

- 日常（每天或每次使用）：A、B、D（首页/代理/日志）。
- 每周：A-I 全量。
- 重编/重装 HAP 后：A-I 全量 + 退出/重启。

## A. 连接与安装

1. `hdc list targets` 应返回 `192.168.124.253:39937`。
2. `hdc shell bm dump -n io.github.clash_verge_rev.clash_verge_rev` 应有输出。
3. `hdc fport ls` 应包含：`19090→9090`、`17897→7897`、`19222→webview devtools`。hdc 重连后转发可能丢失，巡检前先确认。

## B. App 与核心进程

4. `hdc shell ps -ef | grep -iE 'clash_verge_rev|mihomo|runner'` 应看到主进程、gpu/render 和 `Native_libmihomo_runner*`。
5. `curl http://127.0.0.1:19090/version` 应返回 `{"meta":true,"version":"1.10.0"}`。
6. `hdc shell "cat /proc/net/tcp | grep 0100007F:2382"` 应有 `0A`（LISTEN）；9097/7895 不应有监听。

## C. 配置对齐

7. 设置 → 运行时配置：`external-controller` 为 `127.0.0.1:9090`，`secret` 为空，`tun.enable` 为 false。
8. 磁盘 `clash-verge.yaml` 可能保留 9097/`set-your-secret`（恢复流程会带回旧值），运行时增强会强制 9090/空 secret。巡检以运行时为准，不要把磁盘文件当故障。

## D. 功能页

9. 首页：版本 1.10.0、流量、当前节点、出口 IP（当前节点出口，如香港 45.78.32.31）。
10. 代理页：JMS/JMS Auto 组可见，节点可切换，延迟测试可触发。
11. 日志页：实时日志包含“外部控制器正在监听：127.0.0.1:9090”。
12. 设置页：不应出现 打开配置/核心/日志目录、开发者工具、轻量模式设置、导出诊断信息、导入备份 等桌面入口。

## E. 代理连通

13. `curl "http://127.0.0.1:19090/proxies/JMS/delay?timeout=5000&url=http://www.gstatic.com/generate_204"` 应返回 `{"delay":<100}`。
14. `curl -x http://127.0.0.1:17897 -s -o /dev/null -w "%{http_code}" https://www.gstatic.com/generate_204` 应为 204；10MB 下载测速可复测吞吐。

## F. 系统代理

15. 设置 → 系统代理开关可开/关，应用内状态同步；必要时用系统侧核对。
16. 退出 App 会清理系统代理，巡检后如需保持代理要重新打开开关。

## G. 剪贴板

17. 复制出口 IP / 版本号：系统首次弹授权，批准后成功。
18. 订阅页粘贴：剪贴板有订阅链接时点“粘贴”；被拒时应显示明确提示，不能静默失败。

## H. 退出与重启

19. 设置 → 退出：所有 App/核心进程退出，9090 关闭。
20. `hdc shell aa start -b io.github.clash_verge_rev.clash_verge_rev -a EntryAbility`：拉起后核心自动启动，9090 恢复。

## I. 日志与稳定性

21. `hdc shell "hilog -x | grep -iE 'not allowed by ACL|Unhandled promise rejection'"` 启动期应无输出。
22. 连续观察 30 分钟：无 JS 报错、核心不崩溃、内存/CPU 无异常增长。

## 异常处置

- 核心不在或 9090 无响应：`aa force-stop` 后重新 `aa start`；仍失败则查 `hilog -T clash_verge`。
- ACL 报错：检查 `src-tauri/capabilities/ohos.json` 与插件权限声明。
- 剪贴板粘贴被拒：在系统授权弹窗批准一次；仍失败则手动输入订阅链接。

## 注意

- rport/fport 在 hdc 重连后会丢，巡检前先执行 `hdc fport ls` 核对。
- 每次重编安装后建议跑一次全量巡检。
