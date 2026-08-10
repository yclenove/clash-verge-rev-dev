import { useMemo, useRef, type ReactNode } from 'react'

import { DialogRef } from '@/components/base'

import { BackupViewer } from './mods/backup-viewer'
import { ConfigViewer } from './mods/config-viewer'
import { HotkeyViewer } from './mods/hotkey-viewer'
import { LayoutViewer } from './mods/layout-viewer'
import { LiteModeViewer } from './mods/lite-mode-viewer'
import { MiscViewer } from './mods/misc-viewer'
import { ThemeViewer } from './mods/theme-viewer'
import {
  SettingVergeDialogContext,
  type SettingVergeDialogRefs,
} from './setting-verge-dialog-context'

export const SettingVergeDialogHost = ({
  children,
}: {
  children: ReactNode
}) => {
  const themeRef = useRef<DialogRef>(null)
  const configRef = useRef<DialogRef>(null)
  const hotkeyRef = useRef<DialogRef>(null)
  const miscRef = useRef<DialogRef>(null)
  const layoutRef = useRef<DialogRef>(null)
  const backupRef = useRef<DialogRef>(null)
  const liteModeRef = useRef<DialogRef>(null)

  const value = useMemo<SettingVergeDialogRefs>(
    () => ({
      themeRef,
      configRef,
      hotkeyRef,
      miscRef,
      layoutRef,
      backupRef,
      liteModeRef,
    }),
    [],
  )

  return (
    <SettingVergeDialogContext value={value}>
      <ThemeViewer ref={themeRef} />
      <ConfigViewer ref={configRef} />
      <HotkeyViewer ref={hotkeyRef} />
      <MiscViewer ref={miscRef} />
      <LayoutViewer ref={layoutRef} />
      <BackupViewer ref={backupRef} />
      <LiteModeViewer ref={liteModeRef} />
      {children}
    </SettingVergeDialogContext>
  )
}
