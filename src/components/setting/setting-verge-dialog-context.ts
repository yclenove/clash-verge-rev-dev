import { createContext, use } from 'react'

import { DialogRef } from '@/components/base'

export interface SettingVergeDialogRefs {
  themeRef: React.RefObject<DialogRef | null>
  configRef: React.RefObject<DialogRef | null>
  hotkeyRef: React.RefObject<DialogRef | null>
  miscRef: React.RefObject<DialogRef | null>
  layoutRef: React.RefObject<DialogRef | null>
  backupRef: React.RefObject<DialogRef | null>
  liteModeRef: React.RefObject<DialogRef | null>
}

export const SettingVergeDialogContext =
  createContext<SettingVergeDialogRefs | null>(null)

export const useSettingVergeDialogs = () => {
  const ctx = use(SettingVergeDialogContext)
  if (!ctx) {
    throw new Error(
      'useSettingVergeDialogs must be used within SettingVergeDialogHost',
    )
  }
  return ctx
}
