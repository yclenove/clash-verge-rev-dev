<h1 align="center">
  <img src="./src-tauri/icons/icon.png" alt="Clash Verge Rev Dev" width="128" />
  <br>
  Clash Verge Rev Dev
  <br>
</h1>

<h3 align="center">
基于 <a href="https://github.com/clash-verge-rev/clash-verge-rev">Clash Verge Rev</a> 2.5.3 的个人 fork。<br>
给 Cursor / Grok 做「先 VPN，再家宽」规则出口，不必开全局链式代理。
</h3>

<p align="center">
  <a href="https://github.com/yclenove/clash-verge-rev-dev/releases/latest"><img src="https://img.shields.io/github/v/release/yclenove/clash-verge-rev-dev?display_name=tag&sort=semver" alt="Latest release" /></a>
  <a href="https://github.com/yclenove/clash-verge-rev-dev/actions/workflows/windows-x64-package.yml"><img src="https://img.shields.io/github/actions/workflow/status/yclenove/clash-verge-rev-dev/windows-x64-package.yml?label=Desktop%20Package" alt="Desktop Package" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/github/license/yclenove/clash-verge-rev-dev" alt="GPL-3.0" /></a>
</p>

<p align="center">
  <a href="https://github.com/yclenove/clash-verge-rev-dev/releases">下载安装包</a>
  ·
  <a href="https://github.com/yclenove/clash-verge-rev-dev">源码仓库</a>
  ·
  <a href="https://github.com/clash-verge-rev/clash-verge-rev">上游项目</a>
</p>

> 这不是官方包。安装包只发在本仓库 [Releases](https://github.com/yclenove/clash-verge-rev-dev/releases)，不要去上游官方包里找这次的 Cursor 链路修复。

## 这个 fork 解决什么

Cursor 出口要走规则，而不是开全局链式代理：

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

旧逻辑会把 `Thordata-ISP` 塞进 `JMS`，而它自己的 `dialer-proxy` 又是 `JMS`，于是成环。开全局链会把 dialer 改成 VPN 叶子，所以看起来「一开全局链就好使」。现在规则模式就能通。

**推荐状态**

- 打开系统代理
- 关掉虚拟网卡（TUN）
- 全局链式代理保持空
- `EXIT` 选 `Thordata-ISP`
- `JMS` 里不要出现 `Thordata-ISP`

一键设置默认会勾上 TUN。本机按进程名 / 路径匹配后，TUN 可以关掉。不要开全局链式。

## 下载

安装包发在本仓库 [Releases](https://github.com/yclenove/clash-verge-rev-dev/releases/tag/v2.5.3-dev.1)。当前版本 **v2.5.3-dev.1**，对应云打包：[Desktop Package #32093256178](https://github.com/yclenove/clash-verge-rev-dev/actions/runs/32093256178)（构建 commit `b9537d9`）。

| 平台 | 文件 |
| --- | --- |
| Windows x64 | `Clash.Verge_*_x64-setup.exe`，另有 portable |
| Windows ARM64 | `Clash.Verge_*_arm64-setup.exe`，另有 portable |
| macOS Apple Silicon | `Clash.Verge_*_aarch64.dmg` |
| macOS Intel | `Clash.Verge_*_x64.dmg` |
| Linux amd64 / ARM | `.deb` / `.rpm` |

已安装的旧 App 不会自动吃到这次代码，需要装这个 Release。

macOS 本地未签名包如果被 Gatekeeper 拦住：

```bash
xattr -dr com.apple.quarantine "/Applications/Clash Verge.app"
```

## Cursor ISP 怎么用

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

Mihomo 连接详情通常只显示 `['Thordata-ISP', 'EXIT']`，看不到 `JMS` 那一跳。这是内核展示限制，不代表 dialer 没走。

## 相对上游改了什么

| 点 | 说明 |
| --- | --- |
| Cursor ISP 一键设置 | 设置里填静态 ISP 地址 / 端口 / 账号，写入前置跳节点、`EXIT` 组和 Cursor 规则 |
| 拆 dialer 环 | 带 `dialer-proxy` 的节点不再注入 hop 组及其子组；`url-test` 组也不注入这类节点 |
| 清空全局链 | 只恢复被全局链覆盖的 `dialer-proxy`，用户自己的 `Thordata-ISP -> JMS` 会留下来 |
| macOS 规则 | 补 `Cursor` 进程名、`PROCESS-NAME-REGEX,(?i)^Cursor`、`PROCESS-PATH-REGEX,(?i)Cursor\\.app`，以及 Grok / `cursorvm.com` |

## 常见问题

**必须开全局链式代理吗？**  
不用。全局链保持空，走 `EXIT -> Thordata-ISP -> JMS` 即可。

**虚拟网卡（TUN）要开吗？**  
可以关。本机按进程名 / 路径匹配 Cursor / Grok。一键设置默认会勾上 TUN，应用后自行关掉即可。

**连接详情里看不到 JMS？**  
正常。Mihomo 通常只展示 `Thordata-ISP` 和 `EXIT`，前置 `dialer-proxy` 不会画出来。

**`Thordata-ISP-Direct` 测不通？**  
预期行为。它是直连家宽对照节点；真正要通的是带前置跳的 `Thordata-ISP`。

**装完还是老行为？**  
已安装的旧 App 不会热更新到这次 fork。卸掉官方包或旧包后，再装本仓库 Release。

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

macOS Apple Silicon：

```bash
pnpm run prebuild aarch64-apple-darwin
pnpm build --target aarch64-apple-darwin
```

更多步骤见 [MAC_BUILD.md](./MAC_BUILD.md)、[WINDOWS.md](./WINDOWS.md)、[CONTRIBUTING.md](./CONTRIBUTING.md)。sidecar 不进 git，必须先跑 `prebuild`。

云打包走 GitHub Actions 工作流 **Desktop Package**，产物上传到 [Releases](https://github.com/yclenove/clash-verge-rev-dev/releases)。不要用官方 `Release Build` 工作流：它依赖上游签名密钥，这个 fork 没有。

## 上游能力

这个 fork 仍是 Clash Meta GUI，基于 Tauri 2 / mihomo：

- 切换 `Alpha` 内核
- 主题、代理组 / 托盘图标、`CSS Injection`
- 配置 Merge / Script，语法提示
- 系统代理守卫、TUN
- 可视化节点与规则编辑
- WebDAV 备份

通用问题仍可看 [上游文档](https://clash-verge-rev.github.io/)。

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

基于或参考：

- [clash-verge-rev/clash-verge-rev](https://github.com/clash-verge-rev/clash-verge-rev)
- [zzzgydi/clash-verge](https://github.com/zzzgydi/clash-verge)
- [tauri-apps/tauri](https://github.com/tauri-apps/tauri)
- [MetaCubeX/mihomo](https://github.com/MetaCubeX/mihomo)
- [Dreamacro/clash](https://github.com/Dreamacro/clash)
- [vitejs/vite](https://github.com/vitejs/vite)

## License

GPL-3.0。详见 [LICENSE](./LICENSE)。
