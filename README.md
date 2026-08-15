<h1 align="center">
  <img src="./src-tauri/icons/icon.png" alt="Clash" width="128" />
  <br>
  Continuation of <a href="https://github.com/zzzgydi/clash-verge">Clash Verge</a>
  <br>
</h1>

<h3 align="center">
A Clash Meta GUI based on <a href="https://github.com/tauri-apps/tauri">Tauri</a>.
</h3>

<p align="center">
  Languages:
  <a href="./README.md">简体中文</a> ·
  <a href="./docs/README_en.md">English</a> ·
  <a href="./docs/README_es.md">Español</a> ·
  <a href="./docs/README_ru.md">Русский</a> ·
  <a href="./docs/README_ja.md">日本語</a> ·
  <a href="./docs/README_ko.md">한국어</a> ·
  <a href="./docs/README_fa.md">فارسی</a>
</p>

## 关于本仓库

这是 Clash Verge Rev **2.5.3** 的 **Windows 专用开发树**（分支 `windows-dev`），从本地快照克隆，只修 Windows 客户端。

- 本树路径：`D:\nexus-wsl\clash-verge-rev-windows`
- 原树（macOS / OpenHarmony）：`D:\nexus-wsl\clash-verge-rev`
- 上游项目：<https://github.com/clash-verge-rev/clash-verge-rev>
- Windows 开发约定见：[WINDOWS.md](./WINDOWS.md)
- 环境与命令见：[CONTRIBUTING.md](./CONTRIBUTING.md)

> 说明：本仓库是改过的本地树，不等同于上游正式发布版。不要把 OHOS / macOS 打包工作做到本目录。

## Preview

| Dark                             | Light                             |
| -------------------------------- | --------------------------------- |
| ![预览](./docs/preview_dark.png) | ![预览](./docs/preview_light.png) |

## Install

### 使用本仓库自行构建

```bash
git clone https://github.com/zoozlmaki-byte/clash-verge-rev-dev.git
cd clash-verge-rev-dev
pnpm i
pnpm run prebuild
pnpm build
```

macOS（Apple Silicon）示例：

```bash
pnpm run prebuild aarch64-apple-darwin
pnpm build --target aarch64-apple-darwin
```

更多步骤见 [MAC_BUILD.md](./MAC_BUILD.md) 与 [CONTRIBUTING.md](./CONTRIBUTING.md)。

### 上游官方安装包

如需官方发行版安装包，请前往上游发布页：

- [clash-verge-rev Releases](https://github.com/clash-verge-rev/clash-verge-rev/releases)

支持 Windows（x64/x86）、Linux（x64/arm64）和 macOS 11+（Intel / Apple Silicon）。

| 版本      | 说明                         | 链接                                                                                   |
| :-------- | :--------------------------- | :------------------------------------------------------------------------------------- |
| Stable    | 正式版，适合日常使用         | [Release](https://github.com/clash-verge-rev/clash-verge-rev/releases)                 |
| AutoBuild | 滚动更新测试版，可能存在缺陷 | [AutoBuild](https://github.com/clash-verge-rev/clash-verge-rev/releases/tag/autobuild) |

文档与常见问题：[Clash Verge Rev 文档](https://clash-verge-rev.github.io/)

## Features

- 基于 Rust 和 Tauri 2 框架
- 内置 [Clash.Meta (mihomo)](https://github.com/MetaCubeX/mihomo) 内核，支持切换 `Alpha` 版本内核
- 简洁美观的用户界面，支持自定义主题颜色、代理组/托盘图标以及 `CSS Injection`
- 配置文件管理与增强（Merge / Script），支持语法提示
- 系统代理与守卫、`TUN`（虚拟网卡）模式
- 可视化节点与规则编辑
- WebDAV 配置备份与同步

## FAQ

参见 [文档 FAQ](https://clash-verge-rev.github.io/faq/windows.html)

## Development

详见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

安装 Tauri 相关依赖后：

```shell
pnpm i
pnpm run prebuild
pnpm dev
```

- `pnpm dev`：沿用开发通道服务状态；若服务未安装，则走 Sidecar 模式
- `pnpm dev:service`：安装/更新隔离开发服务后启动
- `pnpm dev:sidecar`：强制使用无特权 Sidecar 流程

## Contributions

Issue 与 PR 欢迎。

## Acknowledgement

Clash Verge Rev 基于或参考了以下项目：

- [zzzgydi/clash-verge](https://github.com/zzzgydi/clash-verge)：基于 Tauri 的 Clash GUI，支持 Windows / macOS / Linux
- [tauri-apps/tauri](https://github.com/tauri-apps/tauri)：用 Web 前端构建更小、更快、更安全的桌面应用
- [Dreamacro/clash](https://github.com/Dreamacro/clash)：基于规则的 Go 隧道
- [MetaCubeX/mihomo](https://github.com/MetaCubeX/mihomo)：基于规则的 Go 隧道
- [Fndroid/clash_for_windows_pkg](https://github.com/Fndroid/clash_for_windows_pkg)：基于 Clash 的 Windows/macOS GUI
- [vitejs/vite](https://github.com/vitejs/vite)：下一代前端工具链

## License

GPL-3.0 License. See [License](./LICENSE) for details.
