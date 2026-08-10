import assert from 'node:assert/strict'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  downloadToTempAndReplace,
  tempDownloadPath,
} from './prebuild-resource-utils.mjs'

test('downloadToTempAndReplace keeps existing target when download fails', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'prebuild-test-'))
  const target = path.join(dir, 'resource.dat')
  await fsp.writeFile(target, 'good-old-content')

  await assert.rejects(
    downloadToTempAndReplace(target, async (tempPath) => {
      await fsp.writeFile(tempPath, 'broken-content')
      throw new Error('download failed')
    }),
    /download failed/,
  )

  const targetContent = await fsp.readFile(target, 'utf8')
  assert.equal(targetContent, 'good-old-content')
  assert.equal(fs.existsSync(tempDownloadPath(target)), false)
})

test('downloadToTempAndReplace replaces target on success', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'prebuild-test-'))
  const target = path.join(dir, 'resource.dat')
  await fsp.writeFile(target, 'old-content')

  await downloadToTempAndReplace(target, async (tempPath) => {
    await fsp.writeFile(tempPath, 'new-content')
  })

  const targetContent = await fsp.readFile(target, 'utf8')
  assert.equal(targetContent, 'new-content')
  assert.equal(fs.existsSync(tempDownloadPath(target)), false)
})
