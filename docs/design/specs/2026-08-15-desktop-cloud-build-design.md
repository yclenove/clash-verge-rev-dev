# 桌面全平台云端打包设计

日期：2026-08-15  
仓库：yclenove/clash-verge-rev-dev（fork）

## 目标

手动触发一次 GitHub Actions，始终打出本分叉的全部桌面安装包，不勾选平台、不跳过目标。

## 每次必打的目标

| 平台 | 目标 | 产物 |
|------|------|------|
| Windows | x64、ARM64 | NSIS setup + 便携 zip |
| macOS | Apple 芯片、Intel | 未签名 `.dmg` |
| Linux | amd64、ARM64、ARMv7 | `.deb` + `.rpm` |

不含官方「内置 WebView2」变体（体积大，仅企业版/无 WebView2 时才需要）。

## 约束

- 不传 `TAURI_PRIVATE_KEY`、不传苹果证书。macOS 保持 `signingIdentity: null`。
- 不发 GitHub Release，不提交 Winget，不发 Telegram。
- 不调用官方仓 reusable workflow。
- `createUpdaterArtifacts` 保持 `false`。
- 某一目标失败不取消其余目标（`fail-fast: false`）。

## 触发

仅 `workflow_dispatch`。没有平台开关。
