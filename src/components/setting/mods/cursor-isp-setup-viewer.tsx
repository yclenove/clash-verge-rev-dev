import {
  Box,
  Button,
  FormControlLabel,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useLockFn } from 'ahooks'
import type { Ref } from 'react'
import { useImperativeHandle, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { BaseDialog, DialogRef, Switch } from '@/components/base'
import { useDisplayedMixedPort } from '@/hooks/use-displayed-mixed-port'
import { useAppRefreshers, useProxiesData } from '@/providers/app-data-context'
import {
  applyCursorIspSetup,
  loadCursorIspSnapshot,
  revertCursorIspSetup,
  testCursorIspNode,
} from '@/services/cursor-isp-setup'
import { showNotice } from '@/services/notice-service'
import {
  DEFAULT_CURSOR_ISP_SETUP,
  normalizeSetupInput,
  validateSetupInput,
  type CursorIspProtocol,
  type CursorIspSetupInput,
} from '@/utils/cursor-isp-setup'

const emptyStatus = ''

const FIELD_KEYS = {
  server: 'settings.modals.cursorIspSetup.fields.server',
  port: 'settings.modals.cursorIspSetup.fields.port',
  username: 'settings.modals.cursorIspSetup.fields.username',
  password: 'settings.modals.cursorIspSetup.fields.password',
  hopGroup: 'settings.modals.cursorIspSetup.fields.hopGroup',
  exitGroup: 'settings.modals.cursorIspSetup.fields.exitGroup',
  nodeName: 'settings.modals.cursorIspSetup.fields.nodeName',
} as const

const ERROR_KEYS = {
  server: 'settings.modals.cursorIspSetup.errors.server',
  port: 'settings.modals.cursorIspSetup.errors.port',
  hopGroup: 'settings.modals.cursorIspSetup.errors.hopGroup',
  exitGroup: 'settings.modals.cursorIspSetup.errors.exitGroup',
  nodeName: 'settings.modals.cursorIspSetup.errors.nodeName',
} as const

export function CursorIspSetupViewer({ ref }: { ref?: Ref<DialogRef> }) {
  const { t } = useTranslation()
  const { proxyView } = useProxiesData()
  const { refreshAll } = useAppRefreshers()
  const mixedPort = useDisplayedMixedPort()

  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState(emptyStatus)
  const [input, setInput] = useState<CursorIspSetupInput>(
    DEFAULT_CURSOR_ISP_SETUP,
  )
  const [applyAllProfiles, setApplyAllProfiles] = useState(true)
  const [enableSystemProxy, setEnableSystemProxy] = useState(true)
  const [enableTunMode, setEnableTunMode] = useState(true)
  const [enableGlobalChain, setEnableGlobalChain] = useState(false)
  const [hopGroups, setHopGroups] = useState<string[]>([])
  const [profileNames, setProfileNames] = useState<string[]>([])

  const field = (key: keyof typeof FIELD_KEYS) => t(FIELD_KEYS[key])

  const hopOptions = useMemo(() => {
    if (hopGroups.includes(input.hopGroup) || !input.hopGroup) return hopGroups
    return [input.hopGroup, ...hopGroups]
  }, [hopGroups, input.hopGroup])

  useImperativeHandle(ref, () => ({
    open: () => {
      setOpen(true)
      setStatus(emptyStatus)
      void loadCursorIspSnapshot(proxyView, mixedPort)
        .then((snapshot) => {
          setInput(snapshot.input)
          setApplyAllProfiles(snapshot.options.applyAllProfiles)
          setEnableSystemProxy(snapshot.options.enableSystemProxy)
          setEnableTunMode(snapshot.options.enableTunMode)
          setEnableGlobalChain(snapshot.options.enableGlobalChain)
          setHopGroups(snapshot.hopGroups)
          setProfileNames(snapshot.profileNames)
        })
        .catch((error) => {
          showNotice.error(error)
        })
    },
    close: () => setOpen(false),
  }))

  const patchInput = (patch: Partial<CursorIspSetupInput>) => {
    setInput((current) => normalizeSetupInput({ ...current, ...patch }))
  }

  const onApply = useLockFn(async () => {
    const invalid = validateSetupInput(input)
    if (invalid) {
      setStatus(t(ERROR_KEYS[invalid]))
      return
    }
    setLoading(true)
    try {
      const result = await applyCursorIspSetup(
        input,
        {
          applyAllProfiles,
          enableSystemProxy,
          enableTunMode,
          enableGlobalChain,
        },
        proxyView,
      )
      await refreshAll()
      setStatus(
        t('settings.modals.cursorIspSetup.messages.applied', {
          profiles: result.profileNames.join(', '),
          group: result.exitGroup,
          node: result.nodeName,
          port: mixedPort,
        }),
      )
      showNotice.success('settings.modals.cursorIspSetup.messages.applySuccess')
    } catch (error) {
      const code = error instanceof Error ? error.message : String(error)
      if (code.startsWith('invalid:')) {
        const fieldCode = code.slice(8)
        if (fieldCode in ERROR_KEYS) {
          setStatus(t(ERROR_KEYS[fieldCode as keyof typeof ERROR_KEYS]))
          return
        }
      }
      if (code === 'missing-hop-node') {
        setStatus(t('settings.modals.cursorIspSetup.errors.missingHopNode'))
      } else if (code === 'no-profiles') {
        setStatus(t('settings.modals.cursorIspSetup.errors.noProfiles'))
      } else {
        showNotice.error(error)
      }
    } finally {
      setLoading(false)
    }
  })

  const onTest = useLockFn(async () => {
    setLoading(true)
    try {
      const delay = await testCursorIspNode(input.nodeName)
      if (delay > 0 && delay < 1e5) {
        setStatus(
          t('settings.modals.cursorIspSetup.messages.testOk', { delay }),
        )
      } else {
        setStatus(t('settings.modals.cursorIspSetup.errors.testFailed'))
      }
    } catch (error) {
      showNotice.error(error)
      setStatus(t('settings.modals.cursorIspSetup.errors.testFailed'))
    } finally {
      setLoading(false)
    }
  })

  const onRevert = useLockFn(async () => {
    setLoading(true)
    try {
      const result = await revertCursorIspSetup(input, applyAllProfiles)
      await refreshAll()
      setStatus(
        t('settings.modals.cursorIspSetup.messages.reverted', {
          profiles: result.profileNames.join(', ') || '-',
        }),
      )
      showNotice.success(
        'settings.modals.cursorIspSetup.messages.revertSuccess',
      )
    } catch (error) {
      showNotice.error(error)
    } finally {
      setLoading(false)
    }
  })

  return (
    <BaseDialog
      open={open}
      title={t('settings.modals.cursorIspSetup.title')}
      contentSx={{ width: 520 }}
      okBtn={t('settings.modals.cursorIspSetup.actions.apply')}
      cancelBtn={t('shared.actions.cancel')}
      loading={loading}
      onClose={() => setOpen(false)}
      onCancel={() => setOpen(false)}
      onOk={onApply}
    >
      <Stack spacing={1.5} sx={{ pt: 0.5 }}>
        <Typography variant="body2" color="text.secondary">
          {t('settings.modals.cursorIspSetup.messages.intro', {
            port: mixedPort,
          })}
        </Typography>
        <TextField
          select
          size="small"
          label={t('settings.modals.cursorIspSetup.fields.protocol')}
          value={input.protocol}
          onChange={(event) =>
            patchInput({ protocol: event.target.value as CursorIspProtocol })
          }
        >
          <MenuItem value="http">HTTP</MenuItem>
          <MenuItem value="socks5">SOCKS5</MenuItem>
        </TextField>
        <TextField
          size="small"
          autoComplete="off"
          label={field('server')}
          value={input.server}
          onChange={(event) => patchInput({ server: event.target.value })}
        />
        <TextField
          size="small"
          type="number"
          autoComplete="off"
          label={field('port')}
          value={input.port || ''}
          onChange={(event) =>
            patchInput({ port: Number(event.target.value) || 0 })
          }
        />
        <TextField
          size="small"
          autoComplete="off"
          label={field('username')}
          value={input.username}
          onChange={(event) => patchInput({ username: event.target.value })}
        />
        <TextField
          size="small"
          type="password"
          autoComplete="new-password"
          label={field('password')}
          value={input.password}
          onChange={(event) => patchInput({ password: event.target.value })}
        />
        <TextField
          select={hopOptions.length > 0}
          size="small"
          autoComplete="off"
          label={field('hopGroup')}
          value={input.hopGroup}
          onChange={(event) => patchInput({ hopGroup: event.target.value })}
          helperText={t('settings.modals.cursorIspSetup.messages.hopHint')}
        >
          {hopOptions.map((name) => (
            <MenuItem key={name} value={name}>
              {name}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          size="small"
          autoComplete="off"
          label={field('exitGroup')}
          value={input.exitGroup}
          onChange={(event) => patchInput({ exitGroup: event.target.value })}
        />
        <TextField
          size="small"
          autoComplete="off"
          label={field('nodeName')}
          value={input.nodeName}
          onChange={(event) => patchInput({ nodeName: event.target.value })}
        />
        <FormControlLabel
          control={
            <Switch
              checked={applyAllProfiles}
              onChange={(_, checked) => setApplyAllProfiles(checked)}
            />
          }
          label={t('settings.modals.cursorIspSetup.toggles.applyAll')}
        />
        <FormControlLabel
          control={
            <Switch
              checked={enableSystemProxy}
              onChange={(_, checked) => setEnableSystemProxy(checked)}
            />
          }
          label={t('settings.modals.cursorIspSetup.toggles.systemProxy')}
        />
        <FormControlLabel
          control={
            <Switch
              checked={enableTunMode}
              onChange={(_, checked) => setEnableTunMode(checked)}
            />
          }
          label={t('settings.modals.cursorIspSetup.toggles.tunMode')}
        />
        {enableTunMode && (
          <Typography variant="body2" color="text.secondary">
            {t('settings.modals.cursorIspSetup.messages.tunHint')}
          </Typography>
        )}
        <FormControlLabel
          control={
            <Switch
              checked={enableGlobalChain}
              onChange={(_, checked) => setEnableGlobalChain(checked)}
            />
          }
          label={t('settings.modals.cursorIspSetup.toggles.globalChain')}
        />
        {enableGlobalChain && (
          <Typography variant="body2" color="warning.main">
            {t('settings.modals.cursorIspSetup.messages.globalChainWarn')}
          </Typography>
        )}
        {profileNames.length > 0 && (
          <Typography variant="caption" color="text.secondary">
            {t('settings.modals.cursorIspSetup.messages.targets', {
              profiles: profileNames.join(', '),
            })}
          </Typography>
        )}
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button
            size="small"
            variant="outlined"
            disabled={loading}
            onClick={onTest}
          >
            {t('settings.modals.cursorIspSetup.actions.test')}
          </Button>
          <Button
            size="small"
            variant="outlined"
            color="warning"
            disabled={loading}
            onClick={onRevert}
          >
            {t('settings.modals.cursorIspSetup.actions.revert')}
          </Button>
        </Box>
        {status && (
          <Typography variant="body2" color="text.secondary">
            {status}
          </Typography>
        )}
      </Stack>
    </BaseDialog>
  )
}
