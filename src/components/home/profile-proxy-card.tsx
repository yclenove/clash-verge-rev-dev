/* eslint-disable @eslint-react/set-state-in-effect */
import {
  ChevronRight,
  ContentCopyRounded,
  PublicRounded,
  StorageOutlined,
  WifiOff as SignalError,
  SignalWifi3Bar as SignalGood,
  SignalWifi2Bar as SignalMedium,
  SignalWifi0Bar as SignalNone,
  SignalWifi4Bar as SignalStrong,
  SignalWifi1Bar as SignalWeak,
} from '@mui/icons-material'
import {
  Box,
  Button,
  Chip,
  FormControlLabel,
  IconButton,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
  alpha,
  useTheme,
} from '@mui/material'
import { useLockFn } from 'ahooks'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { unfixedProxy } from 'tauri-plugin-mihomo-api'

import { Switch } from '@/components/base'
import { EnhancedCard } from '@/components/home/enhanced-card'
import type { ProxySortType } from '@/components/proxy/use-filter-sort'
import { IP_INFO_QUERY_KEY } from '@/constants/ip-info-cache'
import {
  AUTO_LOG_ALERT_THRESHOLD_DEFAULT,
  AUTO_LOG_ALERT_WINDOW_MS,
  STORAGE_KEY_AUTO,
  STORAGE_KEY_AUTO_LOG_ALERT_THRESHOLD,
  STORAGE_KEY_GROUP,
  STORAGE_KEY_SUBSCRIPTION,
  SUBSCRIPTION_FILTER_ALL,
} from '@/constants/profile-proxy-storage'
import { useRuntimeConfig } from '@/hooks/use-clash'
import { useDisplayedMixedPort } from '@/hooks/use-displayed-mixed-port'
import { useGroupDelays } from '@/hooks/use-group-delays'
import { useProfiles } from '@/hooks/use-profiles'
import { useProxySelection } from '@/hooks/use-proxy-selection'
import { formatGeoParts, useServersGeoip } from '@/hooks/use-servers-geoip'
import { useSubscriptionNodes } from '@/hooks/use-subscription-nodes'
import { useVerge } from '@/hooks/use-verge'
import {
  useAppRefreshers,
  useClashConfigData,
  useCoreDataStatus,
  useProxiesData,
} from '@/providers/app-data-context'
import { getIpInfo } from '@/services/api'
import { writeText } from '@/services/clipboard'
import delayManager from '@/services/delay'
import { showNotice } from '@/services/notice-service'
import { useQuery } from '@/services/query-client'
import {
  findCurrentGroupMember,
  getRecord,
  isInteractableMember,
  memberDetails,
  resolveMember,
  type ProxyGroupView,
  type ResolvedProxyMember,
} from '@/types/proxy-view'
import { getCountryFlag } from '@/utils/country'
import { debugLog } from '@/utils/debug'
import {
  classifyDelay,
  compareByDelay,
  DEFAULT_DELAY_TIMEOUT,
} from '@/utils/delay'
import {
  readProfileScopedItem as readStoredProfileItem,
  writeProfileScopedItem as writeStoredProfileItem,
} from '@/utils/profile-scoped-storage'

const AUTO_CHECK_DEFAULT_INTERVAL_MINUTES = 5
const AUTO_CHECK_INITIAL_DELAY_MS = 100
const STORAGE_KEY_SORT_TYPE = 'clash-verge-proxy-sort-type'

// 代理节点信息接口
interface ProxyOption {
  memberIndex: number
  member: ResolvedProxyMember
}

function convertDelayColor(
  delayValue: number,
): 'success' | 'warning' | 'error' | 'primary' | 'default' {
  const colorStr = delayManager.formatDelayColor(delayValue)
  if (!colorStr) return 'default'

  const mainColor = colorStr.split('.')[0]

  switch (mainColor) {
    case 'success':
      return 'success'
    case 'warning':
      return 'warning'
    case 'error':
      return 'error'
    case 'primary':
      return 'primary'
    default:
      return 'default'
  }
}

function getSignalIcon(
  delay: number,
  translate: (key: string) => string,
  timeout: number = DEFAULT_DELAY_TIMEOUT,
): {
  icon: React.ReactElement
  text: string
  color: string
} {
  const state = classifyDelay(delay, timeout)
  if (state === 'testing')
    return {
      icon: <SignalNone />,
      text: translate('home.components.currentProxy.status.testing'),
      color: 'text.secondary',
    }
  if (state === 'untested')
    return {
      icon: <SignalNone />,
      text: translate('home.components.currentProxy.status.untested'),
      color: 'text.secondary',
    }
  if (state === 'error')
    return {
      icon: <SignalError />,
      text: translate('home.components.currentProxy.status.error'),
      color: 'error.main',
    }
  if (state === 'timeout')
    return {
      icon: <SignalError />,
      text: translate('home.components.currentProxy.status.timeout'),
      color: 'error.main',
    }
  if (delay >= 500)
    return {
      icon: <SignalWeak />,
      text: translate('home.components.currentProxy.status.latencyHigh'),
      color: 'error.main',
    }
  if (delay >= 300)
    return {
      icon: <SignalMedium />,
      text: translate('home.components.currentProxy.status.latencyMedium'),
      color: 'warning.main',
    }
  if (delay >= 200)
    return {
      icon: <SignalGood />,
      text: translate('home.components.currentProxy.status.latencyGood'),
      color: 'info.main',
    }
  return {
    icon: <SignalStrong />,
    text: translate('home.components.currentProxy.status.latencyExcellent'),
    color: 'success.main',
  }
}
// Profile + current-proxy merged card
// - subscription select: filter + group nodes by subscription name (ALL supported)
// - primary group is auto-bound (no group picker; Auto switch covers that UX)
// - node select: switch node inside the primary group
export interface ProfileProxyCardProps {
  /** 嵌入首页合并卡：不渲染外层 EnhancedCard */
  embedded?: boolean
  /** 紧凑字号与间距 */
  dense?: boolean
}

export const ProfileProxyCard = ({
  embedded = false,
  dense = false,
}: ProfileProxyCardProps = {}) => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const theme = useTheme()
  const { current: currentProfile } = useProfiles()
  const { proxyView } = useProxiesData()
  const { clashConfig } = useClashConfigData()
  const { refreshProxy } = useAppRefreshers()
  const { isCoreDataPending } = useCoreDataStatus()
  const { verge } = useVerge()
  const displayedMixedPort = useDisplayedMixedPort()

  // ==================== subscription filter ====================
  const { subscriptions, nodeProfileMap, nodeMetaMap } = useSubscriptionNodes()
  const { data: runtimeConfig } = useRuntimeConfig()
  const runtimeServerMap = useMemo(() => {
    const map = new Map<string, string>()
    const proxies = (
      runtimeConfig as (IConfigData & { proxies?: unknown }) | null | undefined
    )?.proxies
    if (!Array.isArray(proxies)) return map
    for (const proxy of proxies) {
      if (
        proxy &&
        typeof proxy === 'object' &&
        'name' in proxy &&
        'server' in proxy &&
        typeof (proxy as { name?: unknown }).name === 'string' &&
        typeof (proxy as { server?: unknown }).server === 'string'
      ) {
        const name = (proxy as { name: string }).name
        const server = (proxy as { server: string }).server.trim()
        if (name && server && !map.has(name)) map.set(name, server)
      }
    }
    return map
  }, [runtimeConfig])

  // ==================== proxy section ====================
  const autoDelayEnabled = verge?.enable_auto_delay_detection ?? true
  const defaultLatencyTimeout = verge?.default_latency_timeout
  const autoDelayIntervalMs = useMemo(() => {
    const rawInterval = verge?.auto_delay_detection_interval_minutes
    const intervalMinutes =
      typeof rawInterval === 'number' && rawInterval > 0
        ? rawInterval
        : AUTO_CHECK_DEFAULT_INTERVAL_MINUTES
    return Math.max(1, Math.round(intervalMinutes)) * 60 * 1000
  }, [verge?.auto_delay_detection_interval_minutes])

  const currentProfileId = currentProfile?.uid || null

  const readProfileScopedItem = useCallback(
    (baseKey: string) => readStoredProfileItem(baseKey, currentProfileId),
    [currentProfileId],
  )

  const writeProfileScopedItem = useCallback(
    (baseKey: string, value: string) =>
      writeStoredProfileItem(baseKey, currentProfileId, value),
    [currentProfileId],
  )

  const [selectedSubscriptionUid, setSelectedSubscriptionUid] =
    useState<string>(SUBSCRIPTION_FILTER_ALL)

  useEffect(() => {
    const saved = readProfileScopedItem(STORAGE_KEY_SUBSCRIPTION)
    const next = saved == null || saved === '' ? SUBSCRIPTION_FILTER_ALL : saved
    setSelectedSubscriptionUid(next)
  }, [currentProfileId, readProfileScopedItem])

  useEffect(() => {
    if (selectedSubscriptionUid === SUBSCRIPTION_FILTER_ALL) return
    if (subscriptions.length === 0) return
    if (subscriptions.some((item) => item.uid === selectedSubscriptionUid)) {
      return
    }
    setSelectedSubscriptionUid(SUBSCRIPTION_FILTER_ALL)
    writeProfileScopedItem(STORAGE_KEY_SUBSCRIPTION, SUBSCRIPTION_FILTER_ALL)
  }, [subscriptions, selectedSubscriptionUid, writeProfileScopedItem])

  const handleSubscriptionChange = useCallback(
    (uid: string) => {
      if (!uid) return
      setSelectedSubscriptionUid(uid)
      writeProfileScopedItem(STORAGE_KEY_SUBSCRIPTION, uid)
    },
    [writeProfileScopedItem],
  )

  const { changeProxy } = useProxySelection({
    onSuccess: () => {
      refreshProxy()
    },
    onError: (error) => {
      console.error('proxy switch failed', error)
      showNotice.error(error, 3000)
      refreshProxy()
    },
  })

  const mode = clashConfig?.mode?.toLowerCase() || 'rule'
  const isGlobalMode = mode === 'global'
  const isDirectMode = mode === 'direct'

  const [sortType, setSortType] = useState<ProxySortType>(() => {
    const savedSortType = localStorage.getItem(STORAGE_KEY_SORT_TYPE)
    return savedSortType ? (Number(savedSortType) as ProxySortType) : 0
  })

  const [selectedGroupName, setSelectedGroupName] = useState('')
  const [autoMode, setAutoMode] = useState(false)
  const [autoLogAlertThreshold, setAutoLogAlertThreshold] = useState<number>(
    AUTO_LOG_ALERT_THRESHOLD_DEFAULT,
  )
  // The input keeps its own draft so the field can be emptied while typing.
  const [autoLogAlertThresholdDraft, setAutoLogAlertThresholdDraft] = useState(
    String(AUTO_LOG_ALERT_THRESHOLD_DEFAULT),
  )

  const selectableGroups = useMemo(() => {
    if (!proxyView) return []
    return proxyView.groups.filter(
      (group) =>
        !group.hidden &&
        (group.type === 'Selector' || group.type === 'URLTest'),
    )
  }, [proxyView])

  const selectedGroup = useMemo<ProxyGroupView | null>(() => {
    if (!proxyView || isDirectMode) return null
    if (isGlobalMode) return proxyView.global
    return (
      selectableGroups.find(({ name }) => name === selectedGroupName) ?? null
    )
  }, [
    isDirectMode,
    isGlobalMode,
    proxyView,
    selectableGroups,
    selectedGroupName,
  ])

  // Keep the latest selection in a ref so restore logic can read it without
  // putting selectedGroupName in effect deps (avoids self-reentry / bounce).
  const selectedGroupNameRef = useRef(selectedGroupName)
  selectedGroupNameRef.current = selectedGroupName

  // No group picker on home card: bind the main Selector group only.
  // URLTest / "Auto" groups are NOT bound here — home Auto switch covers that.
  useEffect(() => {
    if (!proxyView) return
    if (isDirectMode) {
      setSelectedGroupName('DIRECT')
      return
    }
    if (isGlobalMode) {
      setSelectedGroupName(proxyView.global?.name ?? 'GLOBAL')
      return
    }

    const current = selectedGroupNameRef.current
    const savedGroup = readProfileScopedItem(STORAGE_KEY_GROUP)
    if (
      savedGroup &&
      selectableGroups.some((group) => group.name === savedGroup)
    ) {
      if (savedGroup !== current) {
        setSelectedGroupName(savedGroup)
      }
      return
    }

    const looksAutoNamed = (name: string) => {
      const lower = name.toLowerCase()
      return (
        lower.includes('auto') || lower.includes('自动') // 自动
      )
    }
    // Prefer real Selector groups; never prioritize URLTest just because name has Auto.
    const selectors = selectableGroups.filter(
      (group) => group.type === 'Selector',
    )
    const pool = selectors.length > 0 ? selectors : selectableGroups
    const preferredKeywords = [
      '节点选择', // node select
      'select',
      'proxy',
      '手动',
    ]
    const primaryGroup =
      pool.find(
        (group) =>
          preferredKeywords.some((keyword) =>
            group.name.toLowerCase().includes(keyword.toLowerCase()),
          ) && !looksAutoNamed(group.name),
      ) ??
      pool.find((group) => !looksAutoNamed(group.name)) ??
      pool[0]
    const nextGroup = primaryGroup?.name ?? ''
    if (nextGroup && nextGroup !== current) {
      setSelectedGroupName(nextGroup)
      writeProfileScopedItem(STORAGE_KEY_GROUP, nextGroup)
    }
  }, [
    isDirectMode,
    isGlobalMode,
    proxyView,
    readProfileScopedItem,
    selectableGroups,
    writeProfileScopedItem,
  ])

  // Sorting reads delays from a store outside React; this hands them over as a value.
  const delays = useGroupDelays(selectedGroupName || null)

  const autoCheckInProgressRef = useRef(false)
  const latestTimeoutRef = useRef<number>(
    verge?.default_latency_timeout || 10000,
  )
  const latestProxyMemberRef = useRef<ResolvedProxyMember | null>(null)

  useEffect(() => {
    latestTimeoutRef.current = verge?.default_latency_timeout || 10000
  }, [verge?.default_latency_timeout])

  const optionsForGroup = useCallback(
    (group: ProxyGroupView | null): ProxyOption[] =>
      proxyView && group
        ? group.members.map((member, memberIndex) => ({
            memberIndex,
            member: resolveMember(proxyView, member),
          }))
        : [],
    [proxyView],
  )

  const unsortedProxyOptions = useMemo(
    () => optionsForGroup(selectedGroup),
    [optionsForGroup, selectedGroup],
  )

  const currentOption = useMemo(() => {
    if (!proxyView) return undefined
    if (isDirectMode) {
      const node =
        proxyView.direct == null
          ? undefined
          : getRecord(proxyView, proxyView.direct)
      return node
        ? ({
            memberIndex: 0,
            member: {
              kind: 'node',
              ref: { kind: 'node', name: node.name, recordId: node.recordId },
              node,
            },
          } satisfies ProxyOption)
        : undefined
    }
    return selectedGroup
      ? findCurrentGroupMember(proxyView, selectedGroup)
      : undefined
  }, [isDirectMode, proxyView, selectedGroup])

  latestProxyMemberRef.current = currentOption?.member ?? null

  // Name-based values stay stable across proxyView refreshes (recordId can churn).
  const optionValue = (option: ProxyOption) =>
    `${option.member.kind}:${option.member.ref.name}:${option.memberIndex}`

  const resolveNodeDisplayMeta = (option: ProxyOption) => {
    const name = option.member.ref.name
    if (option.member.kind === 'group') {
      return {
        server: undefined as string | undefined,
        groupLabel: t('home.components.currentProxy.labels.policyGroups'),
        typeLabel: option.member.group.type,
      }
    }
    if (option.member.kind !== 'node') {
      return {
        server: undefined as string | undefined,
        groupLabel: undefined as string | undefined,
        typeLabel: undefined as string | undefined,
      }
    }

    const meta = nodeMetaMap.get(name)
    const runtimeServer = runtimeServerMap.get(name)
    const profileUid = meta?.profileUid ?? nodeProfileMap.get(name)
    const groupLabel = profileUid
      ? subscriptions.find((item) => item.uid === profileUid)?.name ||
        profileUid
      : t('home.components.currentProxy.labels.otherNodes')

    return {
      server: meta?.server || runtimeServer,
      groupLabel,
      typeLabel: meta?.type || option.member.node.type,
    }
  }

  const persistAutoMode = useCallback(
    (enabled: boolean, groupName = selectedGroupName) => {
      if (!groupName) return
      writeProfileScopedItem(
        `${STORAGE_KEY_AUTO}:${groupName}`,
        enabled ? '1' : '0',
      )
    },
    [selectedGroupName, writeProfileScopedItem],
  )

  // Restore Auto preference when group changes.
  // Default is off when no saved key, including URLTest groups.
  useEffect(() => {
    if (!selectedGroupName || isGlobalMode || isDirectMode) {
      setAutoMode(false)
      return
    }
    const saved = readProfileScopedItem(
      `${STORAGE_KEY_AUTO}:${selectedGroupName}`,
    )
    const enabled = saved === '1'
    setAutoMode(enabled)
  }, [isDirectMode, isGlobalMode, readProfileScopedItem, selectedGroupName])

  // Scoped to the subscription, not to a group: the threshold gates a
  // subscription update, which is not a per-group decision.
  useEffect(() => {
    const saved = readProfileScopedItem(STORAGE_KEY_AUTO_LOG_ALERT_THRESHOLD)
    const parsed = saved == null ? Number.NaN : Number(saved)
    const normalized =
      Number.isFinite(parsed) && parsed >= 1
        ? Math.floor(parsed)
        : AUTO_LOG_ALERT_THRESHOLD_DEFAULT
    setAutoLogAlertThreshold(normalized)
    setAutoLogAlertThresholdDraft(String(normalized))
  }, [readProfileScopedItem])

  const commitAutoLogAlertThreshold = useCallback(() => {
    const parsed = Number(autoLogAlertThresholdDraft.trim())
    // An empty or invalid draft reverts to the committed value rather than the
    // default, so clearing the field to retype is not destructive.
    const normalized =
      Number.isFinite(parsed) && parsed >= 1
        ? Math.floor(parsed)
        : autoLogAlertThreshold
    setAutoLogAlertThreshold(normalized)
    setAutoLogAlertThresholdDraft(String(normalized))
    writeProfileScopedItem(
      STORAGE_KEY_AUTO_LOG_ALERT_THRESHOLD,
      String(normalized),
    )
  }, [
    autoLogAlertThreshold,
    autoLogAlertThresholdDraft,
    writeProfileScopedItem,
  ])

  const pickBestProxyOption = useCallback(
    (excludeNodeName?: string): ProxyOption | null => {
      if (!selectedGroup || isDirectMode || isGlobalMode) return null
      const timeout =
        typeof defaultLatencyTimeout === 'number' && defaultLatencyTimeout > 0
          ? defaultLatencyTimeout
          : DEFAULT_DELAY_TIMEOUT

      const candidates = unsortedProxyOptions
        .filter((option) => isInteractableMember(option.member))
        .filter(({ member }) => {
          const name = member.ref.name
          if (name === 'DIRECT' || name === 'REJECT') return false
          // Excluded by name regardless of kind, so a nested group cannot be
          // re-picked when it is what we are trying to move away from.
          return name !== excludeNodeName
        })
      if (candidates.length === 0) return null

      let best = candidates[0]
      for (const option of candidates.slice(1)) {
        const cmp = compareByDelay(
          delayManager.getDelayFix(option.member, selectedGroup.name),
          delayManager.getDelayFix(best.member, selectedGroup.name),
          timeout,
        )
        if (cmp < 0) best = option
      }

      const bestDelay = delayManager.getDelayFix(
        best.member,
        selectedGroup.name,
      )
      if (classifyDelay(bestDelay, timeout) !== 'measured') return null
      return best
    },
    [
      defaultLatencyTimeout,
      isDirectMode,
      isGlobalMode,
      selectedGroup,
      unsortedProxyOptions,
    ],
  )

  const activateProxyOption = useCallback(
    (option: ProxyOption) => {
      if (isDirectMode) return
      if (!selectedGroup) return
      if (!isInteractableMember(option.member)) return

      // Manual pick exits auto mode
      if (autoMode) {
        setAutoMode(false)
        persistAutoMode(false, selectedGroup.name)
      }
      const previousProxy = selectedGroup.now
      const nextName = option.member.ref.name
      if (previousProxy === nextName) return
      changeProxy(selectedGroup.name, nextName, previousProxy)
    },
    [autoMode, changeProxy, isDirectMode, persistAutoMode, selectedGroup],
  )

  /** Returns the node it switched to, or null when nothing was switched. */
  const applyAutoSelection = useCallback(
    async (
      group: ProxyGroupView,
      opts?: { excludeNodeName?: string; forceDelayProbe?: boolean },
    ): Promise<string | null> => {
      const excludeNodeName = opts?.excludeNodeName
      const forceDelayProbe = Boolean(opts?.forceDelayProbe)

      // A URLTest group normally just hands control back to the core. That can
      // neither exclude a node nor guarantee a fresh probe, so when the caller
      // asks for either we pin a node explicitly instead.
      if (group.type === 'URLTest' && !excludeNodeName && !forceDelayProbe) {
        try {
          await unfixedProxy(group.name)
          refreshProxy()
        } catch (error) {
          console.error('[ProfileProxyCard] auto unfixed failed', error)
        }
        return null
      }

      const timeout = verge?.default_latency_timeout || 10000
      let best = pickBestProxyOption(excludeNodeName)
      if (forceDelayProbe || !best) {
        const interactable = unsortedProxyOptions
          .map(({ member }) => member)
          .filter(isInteractableMember)
          .filter(
            ({ ref }) =>
              ref.name !== 'DIRECT' &&
              ref.name !== 'REJECT' &&
              ref.name !== excludeNodeName,
          )

        if (interactable.length > 0) {
          try {
            await delayManager.checkListDelay(interactable, group.name, timeout)
          } catch (error) {
            console.error('[ProfileProxyCard] auto delay probe failed', error)
          }
          best = pickBestProxyOption(excludeNodeName)
        }
      }

      if (!best || !isInteractableMember(best.member)) return null
      const nextProxyName = best.member.ref.name
      changeProxy(group.name, nextProxyName, group.now)
      return nextProxyName
    },
    [
      changeProxy,
      pickBestProxyOption,
      refreshProxy,
      unsortedProxyOptions,
      verge?.default_latency_timeout,
    ],
  )

  const handleAutoModeChange = useCallback(
    async (_event: React.ChangeEvent<HTMLInputElement>, checked: boolean) => {
      if (isGlobalMode || isDirectMode || !selectedGroup) return
      setAutoMode(checked)
      persistAutoMode(checked, selectedGroup.name)
      if (!checked) return
      await applyAutoSelection(selectedGroup)
    },
    [
      applyAutoSelection,
      isDirectMode,
      isGlobalMode,
      persistAutoMode,
      selectedGroup,
    ],
  )

  // 导航到订阅页面
  const goToProfiles = useCallback(() => {
    navigate('/profile')
  }, [navigate])

  // 导航到代理页面
  const goToProxies = useCallback(() => {
    navigate('/proxies')
  }, [navigate])

  const currentMember = currentOption?.member
  const currentProxy = currentMember ? memberDetails(currentMember) : undefined
  const selectedProxyName = currentMember?.ref.name ?? ''

  const currentDelay =
    currentMember && selectedGroupName
      ? delayManager.getDelayFix(currentMember, selectedGroupName)
      : -1

  // 信号图标（增加非空校验）
  const signalInfo =
    currentProxy && selectedGroupName
      ? getSignalIcon(
          currentDelay,
          t,
          verge?.default_latency_timeout || DEFAULT_DELAY_TIMEOUT,
        )
      : {
          icon: <SignalNone />,
          text: t('home.components.currentProxy.status.uninitialized'),
          color: 'text.secondary',
        }

  // ---- 出口 IP 信息（与 IP 信息卡共享缓存，始终明文展示） ----
  const {
    data: ipInfo,
    isLoading: ipLoading,
    refetch: refetchIp,
  } = useQuery({
    queryKey: [IP_INFO_QUERY_KEY, displayedMixedPort],
    queryFn: () => getIpInfo(displayedMixedPort),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
    retryDelay: 30_000,
  })

  // 节点切换后延迟重新获取出口 IP（等待新节点生效）
  const prevProxyNameRef = useRef<string>('')
  useEffect(() => {
    const prev = prevProxyNameRef.current
    prevProxyNameRef.current = selectedProxyName
    if (isDirectMode) return
    if (!prev || !selectedProxyName || prev === selectedProxyName) return
    const timer = setTimeout(() => {
      refetchIp().catch(() => {})
    }, 2000)
    return () => clearTimeout(timer)
  }, [isDirectMode, selectedProxyName, refetchIp])

  const handleCopyIp = useLockFn(async () => {
    if (!ipInfo?.ip) return
    try {
      await writeText(ipInfo.ip)
      showNotice.success(
        'shared.feedback.notifications.common.copySuccess',
        1500,
      )
    } catch (err) {
      showNotice.error(err, 3000)
    }
  })

  const checkCurrentProxyDelay = useCallback(async () => {
    if (autoCheckInProgressRef.current) return
    if (isDirectMode) return

    const groupName = selectedGroupName
    const proxyName = selectedProxyName

    if (!groupName || !proxyName) return

    const proxyMember = latestProxyMemberRef.current
    if (!proxyMember || !isInteractableMember(proxyMember)) {
      debugLog(
        `[ProfileProxyCard] 自动延迟检测跳过，组: ${groupName}, 节点: ${proxyName} 未找到`,
      )
      return
    }

    autoCheckInProgressRef.current = true

    const timeout = latestTimeoutRef.current || 10000

    try {
      debugLog(
        `[ProfileProxyCard] 自动检测当前节点延迟，组: ${groupName}, 节点: ${proxyName}`,
      )
      await delayManager.checkDelay(proxyMember, groupName, timeout)
    } catch (error) {
      console.error(
        `[ProfileProxyCard] 自动检测当前节点延迟失败，组: ${groupName}, 节点: ${proxyName}`,
        error,
      )
    } finally {
      autoCheckInProgressRef.current = false
      refreshProxy()
    }
  }, [isDirectMode, refreshProxy, selectedGroupName, selectedProxyName])

  useEffect(() => {
    if (isDirectMode) return
    if (!autoDelayEnabled) return
    if (!selectedGroupName || !selectedProxyName) return

    let disposed = false
    let intervalTimer: ReturnType<typeof setTimeout> | null = null
    let initialTimer: ReturnType<typeof setTimeout> | null = null

    const runAndSchedule = async () => {
      if (disposed) return
      await checkCurrentProxyDelay()
      if (disposed) return
      intervalTimer = setTimeout(runAndSchedule, autoDelayIntervalMs)
    }

    initialTimer = setTimeout(async () => {
      await checkCurrentProxyDelay()
      if (disposed) return
      intervalTimer = setTimeout(runAndSchedule, autoDelayIntervalMs)
    }, AUTO_CHECK_INITIAL_DELAY_MS)

    return () => {
      disposed = true
      if (initialTimer) clearTimeout(initialTimer)
      if (intervalTimer) clearTimeout(intervalTimer)
    }
  }, [
    checkCurrentProxyDelay,
    autoDelayIntervalMs,
    isDirectMode,
    selectedGroupName,
    selectedProxyName,
    autoDelayEnabled,
  ])

  // 节点切换后自动延迟测试（无需开启定时检测）
  const prevDelayCheckRef = useRef<string>('')
  useEffect(() => {
    const prev = prevDelayCheckRef.current
    prevDelayCheckRef.current = selectedProxyName
    if (isDirectMode) return
    if (!prev || !selectedProxyName || prev === selectedProxyName) return
    const timer = setTimeout(() => {
      checkCurrentProxyDelay().catch(() => {})
    }, 500)
    return () => clearTimeout(timer)
  }, [isDirectMode, selectedProxyName, checkCurrentProxyDelay])

  // 排序类型变更
  const handleSortTypeChange = useCallback(() => {
    const newSortType = ((sortType + 1) % 3) as ProxySortType
    setSortType(newSortType)
    localStorage.setItem(STORAGE_KEY_SORT_TYPE, newSortType.toString())
  }, [sortType])

  // Node list for the primary group, filtered/sorted, then grouped by subscription
  // name - same presentation model as chain picker's add-from-subscription.
  const subscriptionProxyOptions = useMemo(() => {
    const sortWithLatency = (proxiesToSort: ProxyOption[]) => {
      if (!proxiesToSort || sortType === 0) return proxiesToSort

      const list = [...proxiesToSort]

      if (sortType === 1) {
        const effectiveTimeout =
          typeof defaultLatencyTimeout === 'number' && defaultLatencyTimeout > 0
            ? defaultLatencyTimeout
            : DEFAULT_DELAY_TIMEOUT

        list.sort((a, b) => {
          const byDelay = compareByDelay(
            delays.of(a.member),
            delays.of(b.member),
            effectiveTimeout,
          )
          if (byDelay !== 0) return byDelay
          return a.member.ref.name.localeCompare(b.member.ref.name)
        })
      } else {
        list.sort((a, b) => a.member.ref.name.localeCompare(b.member.ref.name))
      }

      return list
    }

    if (isDirectMode) {
      return [] as ProxyOption[]
    }

    let filtered =
      selectedSubscriptionUid === SUBSCRIPTION_FILTER_ALL
        ? [...unsortedProxyOptions]
        : unsortedProxyOptions.filter((option) => {
            if (option.member.kind === 'group') return true
            const owner = nodeProfileMap.get(option.member.ref.name)
            if (!owner) return true
            return owner === selectedSubscriptionUid
          })

    // Keep currently selected node visible under subscription filter.
    if (
      currentOption &&
      !filtered.some(
        (option) => optionValue(option) === optionValue(currentOption),
      ) &&
      unsortedProxyOptions.some(
        (option) => optionValue(option) === optionValue(currentOption),
      )
    ) {
      filtered = [currentOption, ...filtered]
    }

    return sortWithLatency(filtered)
  }, [
    currentOption,
    delays,
    defaultLatencyTimeout,
    isDirectMode,
    nodeProfileMap,
    selectedSubscriptionUid,
    sortType,
    unsortedProxyOptions,
  ])

  type ProxyOptionSection = {
    key: string
    title: string
    options: ProxyOption[]
  }

  const nodeServersForGeo = useMemo(() => {
    const servers: string[] = []
    for (const option of subscriptionProxyOptions) {
      if (option.member.kind !== 'node') continue
      const name = option.member.ref.name
      const server = nodeMetaMap.get(name)?.server || runtimeServerMap.get(name)
      if (server) servers.push(server)
    }
    return servers
  }, [subscriptionProxyOptions, nodeMetaMap, runtimeServerMap])

  const nodeGeoByServer = useServersGeoip(nodeServersForGeo)

  const groupedSubscriptionProxyOptions = useMemo((): ProxyOptionSection[] => {
    if (subscriptionProxyOptions.length === 0) return []

    const subName = (uid: string) =>
      subscriptions.find((item) => item.uid === uid)?.name || uid

    const sections: ProxyOptionSection[] = []
    const bucket = new Map<string, ProxyOption[]>()

    const ensure = (key: string, title: string) => {
      let list = bucket.get(key)
      if (!list) {
        list = []
        bucket.set(key, list)
        sections.push({ key, title, options: list })
      }
      return list
    }

    // Preserve subscription list order (profiles order) like chain picker.
    if (selectedSubscriptionUid === SUBSCRIPTION_FILTER_ALL) {
      for (const sub of subscriptions) {
        ensure(`sub:${sub.uid}`, sub.name)
      }
    } else if (selectedSubscriptionUid) {
      ensure(`sub:${selectedSubscriptionUid}`, subName(selectedSubscriptionUid))
    }

    const policyKey = 'policy-groups'
    const otherKey = 'other'

    for (const option of subscriptionProxyOptions) {
      if (option.member.kind === 'group') {
        ensure(
          policyKey,
          t('home.components.currentProxy.labels.policyGroups'),
        ).push(option)
        continue
      }

      const owner = nodeProfileMap.get(option.member.ref.name)
      if (!owner) {
        ensure(
          otherKey,
          t('home.components.currentProxy.labels.otherNodes'),
        ).push(option)
        continue
      }

      if (
        selectedSubscriptionUid !== SUBSCRIPTION_FILTER_ALL &&
        owner !== selectedSubscriptionUid
      ) {
        ensure(`sub:${owner}`, subName(owner)).push(option)
        continue
      }

      ensure(`sub:${owner}`, subName(owner)).push(option)
    }

    return sections.filter((section) => section.options.length > 0)
  }, [
    nodeProfileMap,
    selectedSubscriptionUid,
    subscriptionProxyOptions,
    subscriptions,
    t,
  ])

  // Delay test (nodes currently listed)
  const handleCheckDelay = useLockFn(async () => {
    const groupName = selectedGroupName
    if (!groupName || isDirectMode) return

    debugLog(`[ProfileProxyCard] start delay test, group: ${groupName}`)

    const timeout = verge?.default_latency_timeout || 10000

    const interactable = subscriptionProxyOptions
      .map(({ member }) => member)
      .filter(isInteractableMember)
      .filter(({ ref }) => ref.name !== 'DIRECT' && ref.name !== 'REJECT')

    if (interactable.length > 0) {
      const url = delayManager.getUrl(groupName)
      debugLog(`[ProfileProxyCard] test URL: ${url}, timeout: ${timeout}ms`)

      try {
        await delayManager.checkListDelay(interactable, groupName, timeout)
        debugLog(`[ProfileProxyCard] delay test done, group: ${groupName}`)
      } catch (error) {
        console.error(
          `[ProfileProxyCard] delay test error, group: ${groupName}`,
          error,
        )
      }
    }

    refreshProxy()

    if (autoMode && selectedGroup) {
      await applyAutoSelection(selectedGroup)
    }
  })

  const getSortLabel = (): string => {
    switch (sortType) {
      case 1:
        return t('proxies.page.tooltips.sortDelay')
      case 2:
        return t('proxies.page.tooltips.sortName')
      case 0:
      default:
        return t('proxies.page.tooltips.sortDefault')
    }
  }

  // ==================== 渲染 ====================
  const cardTitle = t('home.components.currentProxy.title')
  const cardIcon = (
    <Tooltip
      title={
        currentProxy
          ? `${signalInfo.text}: ${delayManager.formatDelay(currentDelay)}`
          : t('home.components.currentProxy.status.noProxyNode')
      }
    >
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Box
          sx={{
            display: 'flex',
            color: signalInfo.color,
            transition: 'color 0.3s',
            '& svg': { fontSize: dense ? 15 : 18 },
          }}
        >
          {currentProxy ? signalInfo.icon : <SignalNone color="disabled" />}
        </Box>
        {currentProxy && !isDirectMode && (
          <Typography
            component="span"
            sx={{
              mt: '1px',
              fontSize: dense ? 8 : 9,
              fontWeight: 700,
              lineHeight: 1.1,
              letterSpacing: 0.2,
              whiteSpace: 'nowrap',
              fontVariantNumeric: 'tabular-nums',
              color: signalInfo.color,
              transition: 'color 0.3s',
            }}
          >
            {delayManager.formatDelay(currentDelay)}
          </Typography>
        )}
      </Box>
    </Tooltip>
  )
  const cardAction = (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <Button
        variant="text"
        size="small"
        color="inherit"
        onClick={handleCheckDelay}
        disabled={isDirectMode || subscriptionProxyOptions.length === 0}
        sx={{
          minWidth: 0,
          px: 0.75,
          fontSize: dense ? 11 : 12,
          fontWeight: 600,
          lineHeight: 1.2,
          whiteSpace: 'nowrap',
        }}
      >
        {t('home.components.currentProxy.actions.refreshDelay')}
      </Button>
      <Button
        variant="text"
        size="small"
        color="inherit"
        onClick={handleSortTypeChange}
        sx={{
          minWidth: 0,
          px: 0.75,
          fontSize: dense ? 11 : 12,
          fontWeight: 600,
          lineHeight: 1.2,
          whiteSpace: 'nowrap',
        }}
      >
        {getSortLabel()}
      </Button>
      <Button
        variant="outlined"
        size="small"
        onClick={goToProfiles}
        endIcon={<StorageOutlined sx={{ fontSize: dense ? 14 : 18 }} />}
        sx={{
          borderRadius: dense ? 1 : 1.5,
          px: dense ? 1 : undefined,
          fontSize: dense ? 11 : undefined,
        }}
      >
        {t('layout.components.navigation.tabs.profiles')}
      </Button>
      <Button
        variant="outlined"
        size="small"
        onClick={goToProxies}
        sx={{
          borderRadius: dense ? 1 : 1.5,
          px: dense ? 1 : undefined,
          fontSize: dense ? 11 : undefined,
        }}
        endIcon={<ChevronRight sx={{ fontSize: dense ? 14 : 18 }} />}
      >
        {t('layout.components.navigation.tabs.proxies')}
      </Button>
    </Box>
  )
  const cardBody = (
    <>
      {isCoreDataPending ? (
        <Box sx={{ py: dense ? 2 : 4, height: 24 }} />
      ) : currentProxy || (!isDirectMode && selectedGroup) ? (
        <Box>
          {/* 代理节点信息显示 */}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              p: dense ? 0.75 : 1,
              mb: dense ? 1 : 2,
              borderRadius: 1,
              bgcolor: alpha(theme.palette.primary.main, 0.05),
              border: `1px solid ${alpha(theme.palette.primary.main, 0.1)}`,
            }}
          >
            <Box>
              <Typography variant="body1" sx={{ fontWeight: 'medium' }}>
                {currentProxy?.name ??
                  t('home.components.currentProxy.labels.noActiveNode')}
              </Typography>

              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                }}
              >
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ mr: 1 }}
                >
                  {currentProxy?.type}
                </Typography>
                {isGlobalMode && (
                  <Chip
                    size="small"
                    label={t('home.components.currentProxy.labels.globalMode')}
                    color="primary"
                    sx={{ mr: 0.5 }}
                  />
                )}
                {isDirectMode && (
                  <Chip
                    size="small"
                    label={t('home.components.currentProxy.labels.directMode')}
                    color="success"
                    sx={{ mr: 0.5 }}
                  />
                )}
                {/* 节点特性 */}
                {currentProxy?.udp && (
                  <Chip size="small" label="UDP" variant="outlined" />
                )}
                {currentProxy?.tfo && (
                  <Chip size="small" label="TFO" variant="outlined" />
                )}
                {currentProxy?.xudp && (
                  <Chip size="small" label="XUDP" variant="outlined" />
                )}
                {currentProxy?.mptcp && (
                  <Chip size="small" label="MPTCP" variant="outlined" />
                )}
                {currentProxy?.smux && (
                  <Chip size="small" label="SMUX" variant="outlined" />
                )}
              </Box>

              {/* 出口 IP 信息（直接显示，不提供隐藏） */}
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 0.75,
                  mt: 0.75,
                  pt: 0.75,
                  borderTop: `1px dashed ${alpha(theme.palette.divider, 0.6)}`,
                }}
              >
                <PublicRounded sx={{ fontSize: 14, color: 'text.secondary' }} />
                <Typography variant="caption" color="text.secondary">
                  {t('home.components.systemInfo.sections.network')}:
                </Typography>
                {ipLoading && !ipInfo ? (
                  <Typography variant="caption" color="text.secondary">
                    {t('home.components.currentProxy.status.ipLoading')}
                  </Typography>
                ) : ipInfo?.ip ? (
                  <>
                    <Typography
                      variant="caption"
                      sx={{
                        fontFamily: 'monospace',
                        letterSpacing: 0.3,
                      }}
                    >
                      {ipInfo.ip}
                    </Typography>
                    {(ipInfo.country_code || ipInfo.country) && (
                      <Typography variant="caption" color="text.secondary">
                        {getCountryFlag(ipInfo.country_code)}
                        {ipInfo.country ? ` ${ipInfo.country}` : ''}
                      </Typography>
                    )}
                    <Tooltip
                      title={t('home.components.currentProxy.tooltips.copyIp')}
                    >
                      <span>
                        <IconButton
                          size="small"
                          onClick={handleCopyIp}
                          disabled={!ipInfo?.ip}
                          sx={{ p: 0.25 }}
                        >
                          <ContentCopyRounded sx={{ fontSize: 14 }} />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </>
                ) : (
                  <Typography variant="caption" color="text.secondary">
                    {t('home.components.currentProxy.status.ipUnavailable')}
                  </Typography>
                )}
              </Box>
            </Box>

            {/* 显示延迟 */}
            {currentProxy && !isDirectMode && (
              <Chip
                size="small"
                label={delayManager.formatDelay(currentDelay)}
                color={convertDelayColor(currentDelay)}
              />
            )}
          </Box>

          {/* subscription chips: 全部节点 / BWH / HK ... */}
          <ToggleButtonGroup
            exclusive
            fullWidth
            size="small"
            value={selectedSubscriptionUid}
            onChange={(_, value: string | null) => {
              if (!value) return
              handleSubscriptionChange(value)
            }}
            disabled={isDirectMode || subscriptions.length === 0}
            sx={{
              mb: 1.25,
              flexWrap: 'wrap',
              '& .MuiToggleButton-root': {
                flex: '1 1 auto',
                minWidth: 0,
                px: 1,
                py: 0.5,
                textTransform: 'none',
                fontSize: 12,
                fontWeight: 600,
              },
            }}
          >
            <ToggleButton value={SUBSCRIPTION_FILTER_ALL}>
              {t('home.components.currentProxy.labels.allNodes')}
            </ToggleButton>
            {subscriptions.map((subscription) => (
              <ToggleButton key={subscription.uid} value={subscription.uid}>
                <Typography
                  noWrap
                  component="span"
                  sx={{ fontSize: 12, fontWeight: 600 }}
                >
                  {subscription.name}
                </Typography>
              </ToggleButton>
            ))}
          </ToggleButtonGroup>

          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              mb: 1,
              px: 0.25,
            }}
          >
            <Typography variant="body2" color="text.secondary">
              {t('home.components.currentProxy.labels.autoMode')}
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Tooltip
                title={t('home.components.currentProxy.tooltips.autoMode')}
                placement="left"
              >
                <FormControlLabel
                  sx={{ mr: 0 }}
                  control={
                    <Switch
                      size="small"
                      checked={autoMode}
                      onChange={handleAutoModeChange}
                      disabled={isGlobalMode || isDirectMode || !selectedGroup}
                    />
                  }
                  label={
                    <Typography variant="caption" color="text.secondary">
                      {autoMode
                        ? t('home.components.currentProxy.status.autoOn')
                        : t('home.components.currentProxy.status.autoOff')}
                    </Typography>
                  }
                  labelPlacement="start"
                />
              </Tooltip>

              <Tooltip
                title={t(
                  'home.components.currentProxy.tooltips.autoLogAlertThreshold',
                  { minutes: AUTO_LOG_ALERT_WINDOW_MS / 60000 },
                )}
                placement="left"
              >
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.5,
                    pl: 1,
                  }}
                >
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ whiteSpace: 'nowrap' }}
                  >
                    {t(
                      'home.components.currentProxy.labels.autoLogAlertThreshold',
                    )}
                  </Typography>
                  <TextField
                    size="small"
                    type="number"
                    value={autoLogAlertThresholdDraft}
                    onChange={(event) =>
                      setAutoLogAlertThresholdDraft(event.target.value)
                    }
                    onBlur={commitAutoLogAlertThreshold}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') commitAutoLogAlertThreshold()
                    }}
                    disabled={isGlobalMode || isDirectMode || !selectedGroup}
                    slotProps={{
                      htmlInput: {
                        min: 1,
                        step: 1,
                        style: { width: 68, textAlign: 'center' },
                      },
                    }}
                  />
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ whiteSpace: 'nowrap' }}
                  >
                    {t(
                      'home.components.currentProxy.labels.autoLogAlertThresholdUnit',
                    )}
                  </Typography>
                </Box>
              </Tooltip>
            </Box>
          </Box>

          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', mb: 0.75, px: 0.25 }}
          >
            {t('home.components.currentProxy.tooltips.enableNode')}
          </Typography>

          <Box
            sx={{
              maxHeight: dense ? 220 : 320,
              minHeight: dense ? 100 : 140,
              overflowY: 'auto',
              border: 1,
              borderColor: 'divider',
              borderRadius: 1.5,
              bgcolor: (theme) =>
                alpha(
                  theme.palette.background.default,
                  theme.palette.mode === 'dark' ? 0.35 : 0.6,
                ),
            }}
          >
            {isDirectMode ? (
              <Box sx={{ py: dense ? 1.5 : 3, textAlign: 'center' }}>
                <Typography variant="body2" color="text.secondary">
                  {t('home.components.currentProxy.labels.directMode')}
                </Typography>
              </Box>
            ) : subscriptionProxyOptions.length === 0 ? (
              <Box sx={{ py: dense ? 1.5 : 3, textAlign: 'center' }}>
                <Typography variant="body2" color="text.secondary">
                  {t('home.components.currentProxy.labels.noSubscriptionNodes')}
                </Typography>
              </Box>
            ) : (
              groupedSubscriptionProxyOptions.map((section) => (
                <Box key={section.key}>
                  <Box
                    sx={{
                      position: 'sticky',
                      top: 0,
                      zIndex: 1,
                      px: 1.25,
                      py: 0.5,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1,
                      bgcolor: (theme) =>
                        alpha(theme.palette.background.paper, 0.92),
                      borderBottom: 1,
                      borderColor: 'divider',
                    }}
                  >
                    <Typography
                      variant="caption"
                      sx={{ fontWeight: 700, color: 'primary.main' }}
                    >
                      {t('home.components.currentProxy.labels.nodeGroup')}:{' '}
                      {section.title}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {t('proxies.page.labels.nodeCount', {
                        count: section.options.length,
                      })}
                    </Typography>
                  </Box>
                  {section.options.map((option) => {
                    const interactable = isInteractableMember(option.member)
                    const name = option.member.ref.name
                    const active = !isDirectMode && name === selectedProxyName
                    const delayValue = interactable
                      ? delayManager.getDelayFix(
                          option.member,
                          selectedGroupName,
                        )
                      : -1
                    const display = resolveNodeDisplayMeta(option)
                    const geo = display.server
                      ? nodeGeoByServer[display.server]
                      : undefined
                    const { ip: geoIp, region: geoRegion } = formatGeoParts(
                      display.server,
                      geo,
                      getCountryFlag,
                    )
                    const titleParts = [
                      name,
                      geoIp,
                      geoRegion,
                      display.groupLabel,
                      display.typeLabel,
                    ].filter(Boolean)
                    return (
                      <Box
                        key={optionValue(option)}
                        onDoubleClick={() => {
                          if (interactable) activateProxyOption(option)
                        }}
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 1,
                          px: dense ? 1 : 1.25,
                          py: dense ? 0.4 : 0.75,
                          borderBottom: 1,
                          borderColor: 'divider',
                          cursor: interactable ? 'pointer' : 'default',
                          bgcolor: active
                            ? (theme) => alpha(theme.palette.primary.main, 0.12)
                            : 'transparent',
                          '&:hover': interactable
                            ? {
                                bgcolor: (theme) =>
                                  alpha(
                                    theme.palette.primary.main,
                                    active ? 0.16 : 0.06,
                                  ),
                              }
                            : undefined,
                        }}
                      >
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography
                            noWrap
                            variant="body2"
                            sx={{
                              fontWeight: active ? 700 : 500,
                              color: active ? 'primary.main' : 'text.primary',
                            }}
                            title={titleParts.join(' · ')}
                          >
                            {name}
                            {geoIp || geoRegion ? (
                              <Box
                                component="span"
                                sx={{
                                  ml: 0.75,
                                  color: 'text.secondary',
                                  fontWeight: 400,
                                  fontSize: 12,
                                }}
                              >
                                {[geoIp, geoRegion].filter(Boolean).join(' ')}
                              </Box>
                            ) : null}
                          </Typography>
                          {(display.groupLabel || display.typeLabel) && (
                            <Typography
                              noWrap
                              variant="caption"
                              color="text.secondary"
                              sx={{ display: 'block', lineHeight: 1.3 }}
                            >
                              {[display.groupLabel, display.typeLabel]
                                .filter(Boolean)
                                .join(' · ')}
                            </Typography>
                          )}
                        </Box>
                        {interactable && (
                          <Chip
                            size="small"
                            label={delayManager.formatDelay(delayValue)}
                            color={convertDelayColor(delayValue)}
                            sx={{
                              minWidth: dense ? 48 : 56,
                              height: dense ? 20 : 22,
                              flexShrink: 0,
                              pointerEvents: 'none',
                            }}
                          />
                        )}
                        <Button
                          size="small"
                          variant={active ? 'contained' : 'outlined'}
                          color={active ? 'primary' : 'inherit'}
                          disabled={!interactable || active || isDirectMode}
                          onClick={(event) => {
                            event.stopPropagation()
                            activateProxyOption(option)
                          }}
                          sx={{
                            flexShrink: 0,
                            minWidth: dense ? 48 : 56,
                            px: dense ? 0.75 : 1,
                            py: 0.15,
                            fontSize: dense ? 11 : 12,
                            fontWeight: 600,
                            lineHeight: 1.4,
                          }}
                        >
                          {active
                            ? t(
                                'home.components.currentProxy.actions.enabledNode',
                              )
                            : t(
                                'home.components.currentProxy.actions.enableNode',
                              )}
                        </Button>
                      </Box>
                    )
                  })}
                </Box>
              ))
            )}
          </Box>
        </Box>
      ) : (
        <Box sx={{ textAlign: 'center', py: dense ? 2 : 4 }}>
          <Typography
            sx={{ height: 24 }}
            variant="body1"
            color="text.secondary"
          >
            {t('home.components.currentProxy.labels.noActiveNode')}
          </Typography>
        </Box>
      )}
    </>
  )

  if (embedded) {
    return (
      <Box sx={{ px: dense ? 1.25 : 2, py: dense ? 1 : 1.5 }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 1,
            mb: dense ? 0.75 : 1.25,
            minWidth: 0,
          }}
        >
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: dense ? 0.75 : 1,
              minWidth: 0,
              flex: 1,
              overflow: 'hidden',
            }}
          >
            <Box sx={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
              {cardIcon}
            </Box>
            <Typography
              sx={{
                fontSize: dense ? 13 : 15,
                fontWeight: 600,
                lineHeight: 1.2,
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {cardTitle}
            </Typography>
          </Box>
          <Box sx={{ flexShrink: 0 }}>{cardAction}</Box>
        </Box>
        {cardBody}
      </Box>
    )
  }

  return (
    <EnhancedCard
      title={cardTitle}
      icon={cardIcon}
      iconColor={currentProxy ? 'primary' : 'info'}
      action={cardAction}
      dense={dense}
    >
      {cardBody}
    </EnhancedCard>
  )
}
