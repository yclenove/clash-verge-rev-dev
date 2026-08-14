# 2026-08-15 Windows 云端打包

## 日期

2026-08-15

## 变更摘要

为本分叉增加可手动触发的 GitHub Actions Windows x64 打包入口，并关闭 updater 签名产物，使云端在没有 Tauri 私钥时也能打出 NSIS 与便携包。

## 动机

本地已能打便携包，但每次要本机编 release。仓库已有官方 Release / Autobuild 工作流，却依赖官方 reusable workflow、Winget、Telegram，以及本仓并不存在的 `TAURI_PRIVATE_KEY`。Actions 开启后需要一条只服务本分叉的出包路径。

## 涉及文件

- `src-tauri/tauri.conf.json`
- `scripts/portable.mjs`
- `.github/workflows/windows-x64-package.yml`
- `docs/design/specs/2026-08-15-windows-cloud-build-design.md`
- `docs/design/plans/2026-08-15-windows-cloud-build.md`
- `docs/changelog/2026-08-15-windows-cloud-build.md`

## 是否需迁移 / 重启

不需要迁移已有配置。已安装或已解压的便携包不用重装。之后云端出包：GitHub → Actions → Windows x64 Package → Run workflow。

## 验证方式

1. `gh secret list` 确认本仓仍无 Tauri 签名钥（预期为空）。
2. push `main` 后 `gh workflow list` 出现 `Windows x64 Package`。
3. `gh workflow run "Windows x64 Package" --ref main`，等待 job 成功。
4. 在该 run 的 Artifacts 下载 NSIS 与 portable zip，本机解压可启动。

## 范围说明

不恢复应用内自动更新。不改官方 `release.yml` / `autobuild.yml` 的 Winget 与 Telegram 行为。本分叉不要打与官方相同的 `v2.5.3` tag 去跑 Release Build。
