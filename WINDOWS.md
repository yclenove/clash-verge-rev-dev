# Clash Verge Rev — Windows 开发树

本目录是 **Windows 专用开发副本**，从 `D:\nexus-wsl\clash-verge-rev` 于 2026-08-15 克隆。

- 路径：`D:\nexus-wsl\clash-verge-rev-windows`
- 分支：`windows-dev`（基于 `346b900`）
- 版本：2.5.3
- 原树（macOS / OpenHarmony 打包）仍留在 `D:\nexus-wsl\clash-verge-rev`，两边独立改，不要混提交。

## 本树要做什么

只修 Windows 客户端问题：系统代理、TUN / Service、自启动、WebView2、UWP 回环、NSIS 安装包、托盘与窗口。

不要在本树做 OHOS HAP / macOS 打包。鸿蒙相关源码仍在仓库里（`cfg` 隔离），但不是本树的工作目标。

## 构建

```bash
pnpm i
pnpm run prebuild
pnpm dev
pnpm build:fast
```

MSVC 目标：`x86_64-pc-windows-msvc`。sidecar 不进 git，必须先 `prebuild`。

Windows 改中文文案：用 `scripts/utf8_patch.py`，不要把中文塞进 PowerShell here-string。见 `docs/utf8-patch-windows.md` 与 `AGENTS.md`。

## Windows 高风险面

| 模块 | 路径 |
|------|------|
| 系统代理 | `src-tauri/src/core/sysopt.rs` |
| TUN / 内核生命周期 | `src-tauri/src/core/manager/` |
| 自启动（计划任务） | `src-tauri/src/core/autostart.rs`、`utils/schtasks.rs` |
| UWP 回环 | `src-tauri/src/core/win_uwp.rs` |
| 安装包 | `src-tauri/packages/windows/installer.nsi`、`tauri.windows.conf.json` |
| 信号 / 关机恢复 | `crates/clash-verge-signal/src/windows.rs` |

原树 `pnpm build:fast` 曾因缺少 `TAURI_SIGNING_PRIVATE_KEY` 在打 updater 签名时失败；本地验证可用未签名包，不要把签名私钥写进仓库。
