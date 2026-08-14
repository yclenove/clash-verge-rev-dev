import fs from 'fs'
import fsp from 'fs/promises'
import { createRequire } from 'module'
import path from 'path'

import AdmZip from 'adm-zip'

const target = process.argv.slice(2)[0]
const ARCH_MAP = {
  'x86_64-pc-windows-msvc': 'x64',
  'aarch64-pc-windows-msvc': 'arm64',
}

const PROCESS_MAP = {
  x64: 'x64',
  arm64: 'arm64',
}
const arch = target ? ARCH_MAP[target] : PROCESS_MAP[process.arch]

function resolveReleaseDir(targetTriple) {
  const candidates = []
  if (targetTriple) {
    candidates.push(`./target/${targetTriple}/release`, `./src-tauri/target/${targetTriple}/release`)
  }
  candidates.push('./target/release', './src-tauri/target/release')
  const found = candidates.find((dir) => fs.existsSync(path.join(dir, 'clash-verge.exe')))
  if (!found) {
    throw new Error(`could not found the release dir (tried ${candidates.join(', ')})`)
  }
  return found
}

/// Script for ci
/// 打包绿色版/便携版 (only Windows)
async function resolvePortable() {
  if (process.platform !== 'win32') return

  const releaseDir = resolveReleaseDir(target)
  const configDir = path.join(releaseDir, '.config')

  await fsp.mkdir(configDir, { recursive: true })
  if (!fs.existsSync(path.join(configDir, 'PORTABLE'))) {
    await fsp.writeFile(path.join(configDir, 'PORTABLE'), '')
  }
  const zip = new AdmZip()

  zip.addLocalFile(path.join(releaseDir, 'clash-verge.exe'))
  zip.addLocalFile(path.join(releaseDir, 'verge-mihomo.exe'))
  zip.addLocalFile(path.join(releaseDir, 'verge-mihomo-alpha.exe'))
  zip.addLocalFolder(path.join(releaseDir, 'resources'), 'resources')
  zip.addLocalFolder(configDir, '.config')

  const require = createRequire(import.meta.url)
  const packageJson = require('../package.json')
  const { version } = packageJson
  const zipFile = `Clash.Verge_${version}_${arch}_portable.zip`
  zip.writeZip(zipFile)
  console.log('[INFO]: create portable zip successfully')
}

resolvePortable().catch(console.error)
