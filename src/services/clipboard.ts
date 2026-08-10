import { invoke } from '@tauri-apps/api/core'

import getSystem from '@/utils/get-system'

const IS_OHOS = getSystem() === 'ohos'

export async function writeText(text: string) {
  if (IS_OHOS) {
    await navigator.clipboard.writeText(text)
    return
  }
  await invoke<void>('plugin:clipboard-manager|write_text', { text })
}

export async function readText() {
  if (IS_OHOS) {
    return navigator.clipboard.readText()
  }
  return invoke<string>('plugin:clipboard-manager|read_text')
}
