import fsp from 'fs/promises'

export const tempDownloadPath = (targetPath) => `${targetPath}.tmp`

export async function downloadToTempAndReplace(targetPath, downloadFn) {
  const tempPath = tempDownloadPath(targetPath)
  try {
    await downloadFn(tempPath)
    await fsp.rename(tempPath, targetPath)
  } finally {
    await fsp.rm(tempPath, { force: true })
  }
}
