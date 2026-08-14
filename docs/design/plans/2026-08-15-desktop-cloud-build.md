# 桌面全平台云端打包技术计划

日期：2026-08-15

## 步骤

1. 将 `.github/workflows/windows-x64-package.yml` 扩展为 `Desktop Package`：
   - Job `native`：Windows x64/ARM64、macOS aarch64/x64、Linux amd64
   - Job `linux-arm`：Linux ARM64 / ARMv7 交叉编译（沿用官方 ports 源与 gcc）
   - 无 `workflow_dispatch` inputs
   - 不传签名 / 苹果 Secret
   - Windows 额外跑 `pnpm portable <target>`
   - 产物全部 `upload-artifact`
2. 更新 changelog。
3. push `main` 后 `gh workflow run "Desktop Package" --ref main`。

## 验证

- `gh workflow list` 显示 `Desktop Package`。
- 一次 run 含 7 个 build job（5 native + 2 linux-arm）。
- Artifacts 覆盖上表全部产物。
- 不创建 Release。
