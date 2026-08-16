import { RefreshRounded, SettingsEthernetRounded } from '@mui/icons-material'
import {
  Box,
  Button,
  CircularProgress,
  Divider,
  Grid,
  Skeleton,
  Tooltip,
  Typography,
  alpha,
} from '@mui/material'
import { invoke } from '@tauri-apps/api/core'
import { useLockFn } from 'ahooks'
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'

import { BasePage, type DialogRef, Switch } from '@/components/base'
import { EnhancedCard } from '@/components/home/enhanced-card'
import { NetworkModeCard } from '@/components/home/network-mode-card'
import { ProfileProxyCard } from '@/components/home/profile-proxy-card'
import { ClashPortViewer } from '@/components/setting/mods/clash-port-viewer'
import { DnsViewer } from '@/components/setting/mods/dns-viewer'
import { TunViewer } from '@/components/setting/mods/tun-viewer'
import { useClash } from '@/hooks/use-clash'
import { useDisplayedMixedPort } from '@/hooks/use-displayed-mixed-port'
import { useProfiles } from '@/hooks/use-profiles'
import { useSystemProxyState } from '@/hooks/use-system-proxy-state'
import { useSystemState } from '@/hooks/use-system-state'
import { useVerge } from '@/hooks/use-verge'
import { useAppRefreshers } from '@/providers/app-data-context'
import { showNotice } from '@/services/notice-service'
import { updateRemoteProfiles } from '@/services/update-remote-profiles'
import getSystem from '@/utils/get-system'
import { formatHostPort } from '@/utils/network'

const preloadSystemInfoCard = () =>
  import('@/components/home/system-info-card').then((module) => ({
    default: module.SystemInfoCard,
  }))

const LazySystemInfoCard = lazy(preloadSystemInfoCard)

// Used by bootstrap to initiate optional card imports without blocking render.
// eslint-disable-next-line react-refresh/only-export-components
export const preloadHomePageCards = () =>
  Promise.all([preloadSystemInfoCard().catch(() => {})])

// 首页区块开关（合并为单卡后，仍按区块独立显隐/排序）
interface HomeCardsSettings {
  profile: boolean
  network: boolean
  systeminfo: boolean
  [key: string]: boolean
}

const DEFAULT_HOME_CARDS: HomeCardsSettings = {
  profile: true,
  network: true,
  systeminfo: true,
}

// 首页区块元信息（key → i18n 标签），默认顺序与初始渲染顺序一致
interface HomeCardMeta {
  key: string
  labelKey: string
}

const HOME_CARD_META: HomeCardMeta[] = [
  { key: 'profile', labelKey: 'home.page.settings.cards.profile' },
  { key: 'network', labelKey: 'home.page.settings.cards.network' },
  { key: 'systeminfo', labelKey: 'home.page.settings.cards.systemInfo' },
]

const DEFAULT_HOME_CARD_ORDER = HOME_CARD_META.map((card) => card.key)

// 解析已保存的区块顺序：过滤无效/重复 key，缺失的 key 按默认顺序追加到末尾
const resolveCardOrder = (stored: string[] | undefined): string[] => {
  const known = new Set(DEFAULT_HOME_CARD_ORDER)
  const seen = new Set<string>()
  const resolved: string[] = []
  // 旧版 proxy 卡已并入 profile；mode 并入 network；test 网站测试卡已移除
  const aliases: Record<string, string> = { proxy: 'profile', mode: 'network' }
  if (Array.isArray(stored)) {
    for (const rawKey of stored) {
      const key = aliases[rawKey] ?? rawKey
      if (key === 'test') continue
      if (known.has(key) && !seen.has(key)) {
        resolved.push(key)
        seen.add(key)
      }
    }
  }
  for (const key of DEFAULT_HOME_CARD_ORDER) {
    if (!seen.has(key)) {
      resolved.push(key)
      seen.add(key)
    }
  }
  return resolved
}

const HomePage = () => {
  const { t } = useTranslation()
  const { verge, patchVerge, mutateVerge } = useVerge()
  const { mutateClash } = useClash()
  const { profiles, mutateProfiles } = useProfiles()
  const { refreshProxy } = useAppRefreshers()
  const { isTunModeAvailable } = useSystemState()
  const {
    indicator: systemProxyIndicator,
    configState: systemProxyConfigState,
    toggleSystemProxy,
  } = useSystemProxyState()
  const displayedMixedPort = useDisplayedMixedPort()
  const proxyServiceAddress = formatHostPort(
    verge?.proxy_host || '127.0.0.1',
    displayedMixedPort,
  )
  const [systemProxyBusy, setSystemProxyBusy] = useState(false)
  const [tunBusy, setTunBusy] = useState(false)
  const [updatingSubscriptions, setUpdatingSubscriptions] = useState(false)
  const dnsRef = useRef<DialogRef>(null)
  const portRef = useRef<DialogRef>(null)
  const tunRef = useRef<DialogRef>(null)
  const tunEnabled = verge?.enable_tun_mode ?? false
  const dnsMutateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const dnsEnabled = verge?.enable_dns_settings ?? false

  useEffect(() => {
    return () => {
      if (dnsMutateTimerRef.current) {
        clearTimeout(dnsMutateTimerRef.current)
      }
    }
  }, [])

  const handleDnsToggle = useLockFn(async (enable: boolean) => {
    if (dnsMutateTimerRef.current) {
      clearTimeout(dnsMutateTimerRef.current)
      dnsMutateTimerRef.current = null
    }
    try {
      await patchVerge({ enable_dns_settings: enable })
      await invoke('apply_dns_config', { apply: enable })
      dnsMutateTimerRef.current = setTimeout(() => {
        dnsMutateTimerRef.current = null
        mutateClash()
      }, 500)
    } catch (err: any) {
      showNotice.error(err)
      await patchVerge({ enable_dns_settings: !enable }).catch(() => {})
    }
  })

  const handleSystemProxyToggle = useLockFn(async (enabled: boolean) => {
    setSystemProxyBusy(true)
    try {
      await toggleSystemProxy(enabled)
    } catch (error) {
      showNotice.error(error)
    } finally {
      setSystemProxyBusy(false)
    }
  })

  const handleTunToggle = useLockFn(async (enabled: boolean) => {
    if (!isTunModeAvailable) {
      showNotice.error('settings.sections.proxyControl.tooltips.tunUnavailable')
      return
    }
    setTunBusy(true)
    const previous = verge?.enable_tun_mode ?? false
    mutateVerge({ ...verge, enable_tun_mode: enabled }, false)
    try {
      await patchVerge({ enable_tun_mode: enabled })
    } catch (error) {
      mutateVerge({ ...verge, enable_tun_mode: previous }, false)
      showNotice.error(error)
    } finally {
      setTunBusy(false)
    }
  })

  const remoteProfileUids = useMemo(
    () =>
      (profiles?.items ?? [])
        .filter((item): item is IProfileItem =>
          Boolean(item?.uid && item.type === 'remote'),
        )
        .map((item) => item.uid),
    [profiles?.items],
  )
  const profilesReady = profiles != null

  const handleUpdateSubscriptions = useLockFn(async () => {
    if (!profilesReady) return
    if (remoteProfileUids.length === 0) {
      showNotice.info('home.page.feedback.notifications.noRemoteSubscriptions')
      return
    }
    setUpdatingSubscriptions(true)
    try {
      const { succeeded, failed, skipped } =
        await updateRemoteProfiles(remoteProfileUids)
      await mutateProfiles()
      await refreshProxy()
      if (succeeded > 0 && failed === 0) {
        showNotice.success(
          'home.page.feedback.notifications.subscriptionsUpdated',
        )
      } else if (succeeded > 0 && failed > 0) {
        showNotice.info(
          'home.page.feedback.notifications.subscriptionsPartial',
          { succeeded, failed },
        )
      } else if (skipped > 0 && succeeded === 0 && failed === 0) {
        showNotice.info('profiles.page.feedback.notifications.updateBusy')
      }
    } finally {
      setUpdatingSubscriptions(false)
    }
  })

  const isOhos = getSystem() === 'ohos'

  // 区块显示状态：迁移旧键后只保留当前已知区块
  const homeCards = useMemo(() => {
    const raw =
      (verge?.home_cards as HomeCardsSettings | undefined) ?? DEFAULT_HOME_CARDS
    const merged: HomeCardsSettings = { ...DEFAULT_HOME_CARDS, ...raw }
    if ('proxy' in raw) {
      merged.profile = Boolean(
        merged.profile ||
          (raw as HomeCardsSettings & { proxy?: boolean }).proxy,
      )
    }
    if ('mode' in raw) {
      merged.network = Boolean(
        merged.network || (raw as HomeCardsSettings & { mode?: boolean }).mode,
      )
    }
    const cleaned: HomeCardsSettings = { ...DEFAULT_HOME_CARDS }
    for (const key of DEFAULT_HOME_CARD_ORDER) {
      cleaned[key] = Boolean(merged[key])
    }
    return cleaned
  }, [verge?.home_cards])

  // 区块显示顺序
  const homeCardsOrder = useMemo(
    () => resolveCardOrder(verge?.home_cards_order),
    [verge?.home_cards_order],
  )

  const visibleSections = useMemo(
    () => homeCardsOrder.filter((key) => homeCards[key]),
    [homeCardsOrder, homeCards],
  )

  const renderSection = useCallback((key: string) => {
    switch (key) {
      case 'profile':
        return <ProfileProxyCard embedded dense />
      case 'network':
        return <NetworkModeCard embedded dense />
      case 'systeminfo':
        return (
          <Suspense
            fallback={
              <Skeleton variant="rectangular" height={160} sx={{ m: 1.25 }} />
            }
          >
            <LazySystemInfoCard embedded dense />
          </Suspense>
        )
      default:
        return null
    }
  }, [])

  return (
    <BasePage
      title={t('home.page.title')}
      contentStyle={{ padding: 1.5 }}
      header={
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            flex: 1,
            minWidth: 0,
            ml: 2,
          }}
        >
          <DnsViewer ref={dnsRef} />
          <ClashPortViewer ref={portRef} />
          <TunViewer ref={tunRef} />
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'center',
              flex: 1,
              minWidth: 0,
              px: 1,
            }}
          >
            <Tooltip title={t('home.page.tooltips.openPortSettings')} arrow>
              <Button
                size="small"
                variant="text"
                startIcon={<SettingsEthernetRounded fontSize="small" />}
                onClick={() => portRef.current?.open()}
                sx={{
                  minWidth: 0,
                  maxWidth: '100%',
                  px: 1,
                  color: 'text.secondary',
                  textTransform: 'none',
                  '&:hover': { color: 'primary.main' },
                }}
              >
                <Typography
                  component="span"
                  sx={{
                    display: { xs: 'none', sm: 'inline' },
                    mr: 0.75,
                    fontSize: 12,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {t('home.page.proxyServiceAddress')}
                </Typography>
                <Typography
                  component="span"
                  sx={{
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    fontFamily: 'monospace',
                    fontSize: 12,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {proxyServiceAddress}
                </Typography>
              </Button>
            </Tooltip>
          </Box>
          {!isOhos && (
            <Tooltip
              title={t('home.components.proxyTun.tooltips.systemProxy')}
              arrow
            >
              <Box
                sx={(theme) => ({
                  height: 30,
                  pl: { xs: 0.25, sm: 1 },
                  pr: 0.25,
                  mr: 0.75,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.5,
                  borderRadius: 1,
                  bgcolor: systemProxyIndicator
                    ? alpha(theme.palette.success.main, 0.08)
                    : 'transparent',
                  transition: 'background-color 0.2s',
                })}
              >
                <Typography
                  variant="body2"
                  sx={{
                    display: { xs: 'none', sm: 'block' },
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                    color: systemProxyIndicator
                      ? 'success.main'
                      : 'text.secondary',
                  }}
                >
                  {t('settings.sections.system.toggles.systemProxy')}
                </Typography>
                <Switch
                  size="small"
                  checked={systemProxyConfigState}
                  disabled={systemProxyBusy}
                  slotProps={{
                    input: {
                      'aria-label': t(
                        'settings.sections.system.toggles.systemProxy',
                      ),
                    },
                  }}
                  onChange={(_, checked) =>
                    void handleSystemProxyToggle(checked)
                  }
                />
              </Box>
            </Tooltip>
          )}
          {!isOhos && (
            <Tooltip
              title={
                isTunModeAvailable
                  ? t('home.components.proxyTun.tooltips.tunMode')
                  : t('settings.sections.proxyControl.tooltips.tunUnavailable')
              }
              arrow
            >
              <Box
                sx={(theme) => ({
                  height: 30,
                  pl: { xs: 0.25, sm: 1 },
                  pr: 0.25,
                  mr: 0.75,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.5,
                  borderRadius: 1,
                  bgcolor:
                    tunEnabled && isTunModeAvailable
                      ? alpha(theme.palette.success.main, 0.08)
                      : 'transparent',
                  transition: 'background-color 0.2s',
                })}
              >
                <Typography
                  variant="body2"
                  component="button"
                  type="button"
                  onClick={() => tunRef.current?.open()}
                  sx={{
                    all: 'unset',
                    display: { xs: 'none', sm: 'block' },
                    cursor: 'pointer',
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                    color:
                      tunEnabled && isTunModeAvailable
                        ? 'success.main'
                        : 'text.secondary',
                    '&:hover': { color: 'primary.main' },
                  }}
                >
                  {t('settings.sections.system.toggles.tunMode')}
                </Typography>
                <Switch
                  size="small"
                  checked={tunEnabled && isTunModeAvailable}
                  disabled={tunBusy || !isTunModeAvailable}
                  slotProps={{
                    input: {
                      'aria-label': t(
                        'settings.sections.system.toggles.tunMode',
                      ),
                    },
                  }}
                  onChange={(_, checked) => void handleTunToggle(checked)}
                />
              </Box>
            </Tooltip>
          )}
          <Tooltip
            title={t('home.components.proxyTun.tooltips.dnsOverwrite')}
            arrow
          >
            <Box sx={{ display: 'flex', alignItems: 'center', mr: 0.75 }}>
              <Box
                component="button"
                type="button"
                onClick={() => dnsRef.current?.open()}
                sx={{
                  all: 'unset',
                  cursor: 'pointer',
                  mr: 0.5,
                  fontSize: 13,
                  fontWeight: 600,
                  lineHeight: 1.2,
                  color: dnsEnabled ? 'primary.main' : 'text.secondary',
                  '&:hover': { color: 'primary.main' },
                }}
              >
                {t('home.components.proxyTun.labels.remoteDns')}
              </Box>
              <Switch
                size="small"
                checked={dnsEnabled}
                onChange={(_, checked) => handleDnsToggle(checked)}
              />
            </Box>
          </Tooltip>
          <Tooltip
            title={
              !profilesReady
                ? t('shared.statuses.loading')
                : remoteProfileUids.length === 0
                  ? t('home.page.tooltips.updateSubscriptionsEmpty')
                  : t('home.page.tooltips.updateSubscriptions')
            }
            arrow
          >
            <Box component="span" sx={{ display: 'inline-flex', ml: 0.25 }}>
              <Button
                size="small"
                variant="text"
                disabled={
                  updatingSubscriptions ||
                  !profilesReady ||
                  remoteProfileUids.length === 0
                }
                startIcon={
                  updatingSubscriptions ? (
                    <CircularProgress size={14} color="inherit" />
                  ) : (
                    <RefreshRounded fontSize="small" />
                  )
                }
                onClick={() => void handleUpdateSubscriptions()}
                sx={{
                  minWidth: 0,
                  px: 1,
                  color: 'text.secondary',
                  textTransform: 'none',
                  whiteSpace: 'nowrap',
                  '&:hover': { color: 'primary.main' },
                }}
              >
                {t('home.page.actions.updateSubscriptions')}
              </Button>
            </Box>
          </Tooltip>
        </Box>
      }
    >
      <Grid container spacing={1} columns={{ xs: 6, sm: 6, md: 12 }}>
        <Grid size={12}>
          <EnhancedCard dense hideHeader noContentPadding>
            {visibleSections.length === 0 ? (
              <Box sx={{ px: 1.5, py: 2 }}>
                <Typography variant="body2" color="text.secondary">
                  {t('home.page.settings.emptyHidden')}
                </Typography>
              </Box>
            ) : (
              visibleSections.map((key, index) => (
                <Box key={key}>
                  {index > 0 && <Divider />}
                  {renderSection(key)}
                </Box>
              ))
            )}
          </EnhancedCard>
        </Grid>
      </Grid>
    </BasePage>
  )
}

export default HomePage
