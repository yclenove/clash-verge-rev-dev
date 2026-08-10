import { ContentCopyRounded } from '@mui/icons-material'
import { Typography } from '@mui/material'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { TooltipIcon } from '@/components/base'
import {
  exitApp,
  exportDiagnosticInfo,
  openAppDir,
  openCoreDir,
  openDevTools,
  openLogsDir,
} from '@/services/cmds'
import { showNotice } from '@/services/notice-service'
import { version } from '@root/package.json'
import getSystem from '@/utils/get-system'

import { SettingItem, SettingList } from './mods/setting-comp'
import { useSettingVergeDialogs } from './setting-verge-dialog-context'

interface Props {
  onError?: (err: Error) => void
}

const SettingVergeAdvanced = ({ onError: _ }: Props) => {
  const { t } = useTranslation()
  const { configRef, backupRef, liteModeRef } = useSettingVergeDialogs()
  const OS = getSystem()

  const onExportDiagnosticInfo = useCallback(async () => {
    await exportDiagnosticInfo()
    showNotice.success('shared.feedback.notifications.common.copySuccess', 1000)
  }, [])

  const copyVersion = useCallback(() => {
    navigator.clipboard.writeText(`v${version}`).then(() => {
      showNotice.success(
        'settings.components.verge.advanced.notifications.versionCopied',
        1000,
      )
    })
  }, [])

  return (
    <SettingList title={t('settings.components.verge.advanced.title')}>
      <SettingItem
        onClick={() => backupRef.current?.open()}
        label={t('settings.components.verge.advanced.fields.backupSetting')}
        extra={
          <TooltipIcon
            title={t('settings.components.verge.advanced.tooltips.backupInfo')}
            sx={{ opacity: '0.7' }}
          />
        }
      />

      <SettingItem
        onClick={() => configRef.current?.open()}
        label={t('settings.components.verge.advanced.fields.runtimeConfig')}
      />

      {OS !== 'ohos' && (
        <>
          <SettingItem
            onClick={openAppDir}
            label={t('settings.components.verge.advanced.fields.openConfDir')}
            extra={
              <TooltipIcon
                title={t('settings.components.verge.advanced.tooltips.openConfDir')}
                sx={{ opacity: '0.7' }}
              />
            }
          />

          <SettingItem
            onClick={openCoreDir}
            label={t('settings.components.verge.advanced.fields.openCoreDir')}
          />

          <SettingItem
            onClick={openLogsDir}
            label={t('settings.components.verge.advanced.fields.openLogsDir')}
          />

          <SettingItem
            onClick={openDevTools}
            label={t('settings.components.verge.advanced.fields.openDevTools')}
          />
        </>
      )}

      {OS !== 'ohos' && (
        <SettingItem
          label={t('settings.components.verge.advanced.fields.liteModeSettings')}
          extra={
            <TooltipIcon
              title={t('settings.components.verge.advanced.tooltips.liteMode')}
              sx={{ opacity: '0.7' }}
            />
          }
          onClick={() => liteModeRef.current?.open()}
        />
      )}

      <SettingItem
        onClick={() => {
          exitApp()
        }}
        label={t('settings.components.verge.advanced.fields.exit')}
      />

      {OS !== 'ohos' && (
        <SettingItem
          label={t('settings.components.verge.advanced.fields.exportDiagnostics')}
          extra={
            <TooltipIcon
              icon={ContentCopyRounded}
              onClick={onExportDiagnosticInfo}
            />
          }
        ></SettingItem>
      )}

      <SettingItem
        label={t('settings.components.verge.advanced.fields.vergeVersion')}
        extra={
          <TooltipIcon
            icon={ContentCopyRounded}
            onClick={copyVersion}
            title={t('settings.components.verge.advanced.actions.copyVersion')}
          />
        }
      >
        <Typography sx={{ py: '7px', pr: 1 }}>v{version}</Typography>
      </SettingItem>
    </SettingList>
  )
}

export default SettingVergeAdvanced
