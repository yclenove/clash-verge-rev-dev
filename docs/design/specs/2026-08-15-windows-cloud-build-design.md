# Windows 云端打包设计

日期：2026-08-15  
仓库：yclenove/clash-verge-rev-dev（fork）

## 目标

在 GitHub Actions 上按需打出 Windows x64 安装包和便携包，不依赖官方仓 reusable workflow，不提交 Winget，不发 Telegram。

## 约束

- 本仓已去掉 updater ACL；仓库 Secrets 无 `TAURI_PRIVATE_KEY`。
- `createUpdaterArtifacts: true` 时，云端 `tauri build` 会因缺签名钥失败。
- 官方 `autobuild.yml` 引用 `clash-verge-rev/clash-verge-rev`，不作为本分叉的出包入口。
- 正式 `release.yml` 仍按官方 Release / Winget 流程，本分叉不打 `v*.*.*` tag 触发它。

## 方案

1. 将 `tauri.conf.json` 的 `bundle.createUpdaterArtifacts` 设为 `false`，使未签名 CI 能完成 NSIS 打包。
2. 新增 `workflow_dispatch` 工作流，只跑 `windows-latest` + `x86_64-pc-windows-msvc`。
3. 产物以 Artifact 上传：NSIS `*-setup.exe` 与便携 zip。
4. `scripts/portable.mjs` 同时识别工作区 `target/` 与旧路径 `src-tauri/target/`。

## 非目标

- 不配置 Apple / Winget / Telegram Secrets。
- 不恢复应用内自动更新。
- 不在 CI 发布 GitHub Release。
