# macOS Build Guide

Source: Clash Verge Rev 2.5.3 (local snapshot)

## Clone

```bash
git clone https://github.com/zoozlmaki-byte/clash-verge-rev-dev.git
cd clash-verge-rev-dev
```

## Prerequisites

- Xcode Command Line Tools: `xcode-select --install`
- Rust 1.95+: https://rustup.rs
- Node.js 24.x or recent LTS
- `corepack enable`

## Build (Apple Silicon)

```bash
pnpm i
pnpm run prebuild aarch64-apple-darwin
pnpm build --target aarch64-apple-darwin
```

## Build (Intel)

```bash
pnpm i
pnpm run prebuild x86_64-apple-darwin
pnpm build --target x86_64-apple-darwin
```

## Output

```text
target/<triple>/release/bundle/dmg/*.dmg
target/<triple>/release/bundle/macos/*.app
```

## Notes

1. This tree may include OpenHarmony-related source changes.
2. Sidecar binaries are not in git; `prebuild` downloads them.
3. Unsigned local builds may be blocked by Gatekeeper:

```bash
xattr -dr com.apple.quarantine "/Applications/Clash Verge.app"
```
