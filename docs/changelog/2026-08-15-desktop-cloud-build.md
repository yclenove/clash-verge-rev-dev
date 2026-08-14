# 2026-08-15 云端全平台打包

## 日期

2026-08-15

## 变更摘要

云端打包从「只打 Windows x64」改为一次手动触发打齐全部桌面目标：Windows x64/ARM64、macOS Apple/Intel、Linux amd64/ARM64/ARMv7。打包时没有平台开关。

## 动机

本分叉需要自己发 Windows / Linux / macOS 包装包。苹果证书和 Tauri 更新私钥都不是出包前提；缺的是一条不依赖官方 Release 流程的全平台 workflow。

## 涉及文件

- `.github/workflows/windows-x64-package.yml`（工作流名改为 Desktop Package）
- `docs/design/specs/2026-08-15-desktop-cloud-build-design.md`
- `docs/design/plans/2026-08-15-desktop-cloud-build.md`
- `docs/changelog/2026-08-15-desktop-cloud-build.md`

## 是否需迁移 / 重启

不需要迁移已有配置。之后出包：GitHub → Actions → Desktop Package → Run workflow。每次都会打全目标。

## 验证方式

1. push 后 `gh workflow list` 出现 `Desktop Package`。
2. `gh workflow run "Desktop Package" --ref main`。
3. 该 run 应有 7 个 build job；Artifacts 含 Windows setup/portable、macOS dmg、Linux deb/rpm。
4. 不出现 GitHub Release、Winget、Telegram 步骤。

## 范围说明

macOS 包未签名，本机需右键打开。不含官方 fixed-WebView2 安装包。不恢复应用内自动更新。
