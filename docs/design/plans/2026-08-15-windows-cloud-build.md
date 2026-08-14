# Windows 云端打包技术计划

日期：2026-08-15

## 步骤

1. `src-tauri/tauri.conf.json`：`createUpdaterArtifacts` 改为 `false`。
2. `scripts/portable.mjs`：按 `clash-verge.exe` 探测 `target/<triple>/release` 与 `src-tauri/target/<triple>/release`。
3. 新增 `.github/workflows/windows-x64-package.yml`：
   - 触发：`workflow_dispatch`
   - Rust 1.95.0、Node 24.18.0、pnpm 11
   - `pnpm i` + `pnpm run prebuild x86_64-pc-windows-msvc`
   - `tauri-apps/tauri-action`：`--target x86_64-pc-windows-msvc -b nsis`，不传签名环境变量，`includeUpdaterJson: false`
   - `pnpm portable <target>`
   - 上传 NSIS exe 与便携 zip
4. 提交后 push `main`，执行 `gh workflow run "Windows x64 Package" --ref main`。

## 验证

- `gh workflow list` 能看到 `Windows x64 Package`。
- 工作流 run 成功后 Artifact 含 setup.exe 与 portable.zip。
- 不创建 GitHub Release，不触发 Winget / Telegram。
