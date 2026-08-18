<h1 align="center">
  <img src="./src-tauri/icons/icon.png" alt="Clash Verge Rev Dev" width="128" />
  <br>
  Clash Verge Rev Dev
  <br>
</h1>

<h3 align="center">
基于官方 <a href="https://github.com/clash-verge-rev/clash-verge-rev">Clash Verge Rev</a> 2.5.3 的个人修改版。<br>
给 Cursor / Grok 做「先 VPN，再家宽」规则出口，不必开全局链式代理。
</h3>

<p align="center">
  <a href="https://github.com/yclenove/clash-verge-rev-dev/releases/latest"><img src="https://img.shields.io/github/v/release/yclenove/clash-verge-rev-dev?display_name=tag&sort=semver" alt="Latest release" /></a>
  <a href="https://github.com/yclenove/clash-verge-rev-dev/actions/workflows/windows-x64-package.yml"><img src="https://img.shields.io/github/actions/workflow/status/yclenove/clash-verge-rev-dev/windows-x64-package.yml?label=Desktop%20Package" alt="Desktop Package" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/github/license/yclenove/clash-verge-rev-dev" alt="GPL-3.0" /></a>
</p>

<p align="center">
  <a href="https://github.com/yclenove/clash-verge-rev-dev/releases/tag/v2.5.3-dev.1">下载本仓库安装包</a>
  ·
  <a href="https://github.com/clash-verge-rev/clash-verge-rev">官方项目</a>
  ·
  <a href="https://github.com/clash-verge-rev/clash-verge-rev/releases">官方 Releases</a>
</p>

> 这不是官方包。Cursor 这条链路的修复只在本仓库 [Releases](https://github.com/yclenove/clash-verge-rev-dev/releases/tag/v2.5.3-dev.1) 里，官方安装包没有。

## 跟官方版对比

官方 Clash Verge Rev 2.5.3 能当日常代理客户端用，但 Cursor 要走「先 VPN，再家宽」时会卡住：

| | 官方版 | 这个修改版 |
| --- | --- | --- |
| Cursor 出口 | 没有一键设置。要自己写节点、组和规则 | 设置里有 **Cursor ISP 一键设置** |
| 规则模式 | `Thordata-ISP` 会被塞进 `JMS`，和自己的 `dialer-proxy = JMS` 成环，规则模式不通 | 带 `dialer-proxy` 的节点不再进 hop 组，规则模式能通 |
| 全局链式代理 | 一开全局链，dialer 被改成 VPN 叶子，看起来就通了 | **不用开**。清空全局链时，用户自己的 `Thordata-ISP -> JMS` 会留下 |
| macOS 匹配 | 容易漏掉 Cursor / Grok 进程和路径 | 补了进程名、路径正则，以及 Grok / `cursorvm.com` |
| 虚拟网卡（TUN） | 日常可开可关 | 本机按进程匹配后可以关 |

目标链路：

```text
Cursor / Grok
  -> EXIT
  -> Thordata-ISP          # 家宽 ISP，dialer-proxy = JMS
  -> JMS                   # 订阅里的 VPN 组
  -> 家宽出口
```

```mermaid
flowchart LR
  cursor["Cursor / Grok"] --> exitGroup["EXIT"]
  exitGroup --> isp["Thordata-ISP"]
  isp -->|"dialer-proxy"| jms["JMS / VPN"]
  jms --> home["家宽"]
```

官方版会把 `Thordata-ISP` 塞进 `JMS`，而它自己的 `dialer-proxy` 又是 `JMS`，于是成环。开全局链会把 dialer 改成 VPN 叶子，所以官方包上「一开全局链就好使」。这个修改版在规则模式下就能通。

界面、订阅、系统代理、TUN、主题这些，官方版有的这里都还在。通用用法看 [官方文档](https://clash-verge-rev.github.io/)。

## 下载

只从本仓库下，不要下官方包：

[v2.5.3-dev.1](https://github.com/yclenove/clash-verge-rev-dev/releases/tag/v2.5.3-dev.1)

| 平台 | 文件 |
| --- | --- |
| Windows x64 | [`Clash.Verge_2.5.3_x64-setup.exe`](https://github.com/yclenove/clash-verge-rev-dev/releases/download/v2.5.3-dev.1/Clash.Verge_2.5.3_x64-setup.exe)，另有 [portable](https://github.com/yclenove/clash-verge-rev-dev/releases/download/v2.5.3-dev.1/Clash.Verge_2.5.3_x64_portable.zip) |
| Windows ARM64 | [`Clash.Verge_2.5.3_arm64-setup.exe`](https://github.com/yclenove/clash-verge-rev-dev/releases/download/v2.5.3-dev.1/Clash.Verge_2.5.3_arm64-setup.exe)，另有 [portable](https://github.com/yclenove/clash-verge-rev-dev/releases/download/v2.5.3-dev.1/Clash.Verge_2.5.3_arm64_portable.zip) |
| macOS Apple Silicon | [`Clash.Verge_2.5.3_aarch64.dmg`](https://github.com/yclenove/clash-verge-rev-dev/releases/download/v2.5.3-dev.1/Clash.Verge_2.5.3_aarch64.dmg) |
| macOS Intel | [`Clash.Verge_2.5.3_x64.dmg`](https://github.com/yclenove/clash-verge-rev-dev/releases/download/v2.5.3-dev.1/Clash.Verge_2.5.3_x64.dmg) |
| Linux amd64 | [`Clash.Verge_2.5.3_amd64.deb`](https://github.com/yclenove/clash-verge-rev-dev/releases/download/v2.5.3-dev.1/Clash.Verge_2.5.3_amd64.deb) / [`Clash.Verge-2.5.3-1.x86_64.rpm`](https://github.com/yclenove/clash-verge-rev-dev/releases/download/v2.5.3-dev.1/Clash.Verge-2.5.3-1.x86_64.rpm) |
| Linux ARM64 / ARMv7 | `.deb` / `.rpm` 见 [Release](https://github.com/yclenove/clash-verge-rev-dev/releases/tag/v2.5.3-dev.1) |

已经装着官方版或旧包的，不会自动变成这个修改版，要卸掉再装本仓库这个包。

macOS 未签名包如果被 Gatekeeper 拦住：

```bash
xattr -dr com.apple.quarantine "/Applications/Clash Verge.app"
```

## 怎么用

1. 先导入带 `JMS` 组的订阅。
2. 打开系统代理，关掉 TUN，全局链式代理留空。
3. 打开 **设置 → Clash → Cursor ISP 一键设置**。
4. 填静态 ISP 地址、端口、账号。默认值：
   - 前置代理组：`JMS`
   - 出口组名：`EXIT`
   - ISP 节点名：`Thordata-ISP`
5. **不要**勾「全局链式模式」。TUN 可按需关掉。
6. 点「一键应用」，再把 `EXIT` 选到 `Thordata-ISP`。
7. 用「测试 ISP 节点」看延迟。通的是带前置跳的 `Thordata-ISP`；`Thordata-ISP-Direct` 直连家宽，不通是预期。

**推荐状态**

- 打开系统代理
- 关掉虚拟网卡（TUN）
- 全局链式代理保持空
- `EXIT` 选 `Thordata-ISP`
- `JMS` 里不要出现 `Thordata-ISP`

一键设置默认会勾上 TUN。本机按进程名 / 路径匹配后，TUN 可以关掉。不要开全局链式。

Mihomo 连接详情通常只显示 `['Thordata-ISP', 'EXIT']`，看不到 `JMS` 那一跳。这是内核展示限制，不代表 dialer 没走。

## 常见问题

**必须开全局链式代理吗？**  
不用。官方版要靠全局链绕开成环；这个修改版把环拆了，全局链保持空，走 `EXIT -> Thordata-ISP -> JMS` 即可。

**虚拟网卡（TUN）要开吗？**  
可以关。本机按进程名 / 路径匹配 Cursor / Grok。一键设置默认会勾上 TUN，应用后自行关掉即可。

**连接详情里看不到 JMS？**  
正常。Mihomo 通常只展示 `Thordata-ISP` 和 `EXIT`，前置 `dialer-proxy` 不会画出来。

**`Thordata-ISP-Direct` 测不通？**  
预期行为。它是直连家宽对照节点；真正要通的是带前置跳的 `Thordata-ISP`。

**装完还是官方版那个样子？**  
下错包了，或还在用已安装的官方 App。卸掉官方包后再装本仓库 Release。

## Preview

| Dark | Light |
| --- | --- |
| ![深色预览](./docs/preview_dark.png) | ![浅色预览](./docs/preview_light.png) |

## 自行构建

```bash
git clone https://github.com/yclenove/clash-verge-rev-dev.git
cd clash-verge-rev-dev
pnpm i
pnpm run prebuild
pnpm build
```

macOS Intel：

```bash
pnpm run prebuild x86_64-apple-darwin
pnpm build --target x86_64-apple-darwin
```

macOS Apple Silicon：

```bash
pnpm run prebuild aarch64-apple-darwin
pnpm build --target aarch64-apple-darwin
```

更多步骤见 [MAC_BUILD.md](./MAC_BUILD.md)、[WINDOWS.md](./WINDOWS.md)、[CONTRIBUTING.md](./CONTRIBUTING.md)。sidecar 不进 git，必须先跑 `prebuild`。

云打包走 GitHub Actions 工作流 **Desktop Package**，再用 **Publish Desktop Package** 挂到 [Releases](https://github.com/yclenove/clash-verge-rev-dev/releases)。不要跑官方的 `Release Build`：它要官方签名密钥，这个仓库没有。

## 开发

```bash
pnpm i
pnpm run prebuild
pnpm dev
```

- `pnpm dev`：沿用开发通道服务；没装服务则走 Sidecar
- `pnpm dev:service`：安装 / 更新隔离开发服务后启动
- `pnpm dev:sidecar`：强制无特权 Sidecar

Issue 和 PR 欢迎。

## 致谢

基于官方 [clash-verge-rev/clash-verge-rev](https://github.com/clash-verge-rev/clash-verge-rev)，并参考：

- [zzzgydi/clash-verge](https://github.com/zzzgydi/clash-verge)
- [tauri-apps/tauri](https://github.com/tauri-apps/tauri)
- [MetaCubeX/mihomo](https://github.com/MetaCubeX/mihomo)
- [Dreamacro/clash](https://github.com/Dreamacro/clash)
- [vitejs/vite](https://github.com/vitejs/vite)

## License

GPL-3.0。详见 [LICENSE](./LICENSE)。
