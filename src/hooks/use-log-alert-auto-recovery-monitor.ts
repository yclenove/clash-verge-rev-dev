import { useEffect, useRef } from 'react'
import { unfixedProxy } from 'tauri-plugin-mihomo-api'

import {
  AUTO_LOG_ALERT_RECOVERY_COOLDOWN_MS,
  AUTO_LOG_ALERT_REFRESH_POLL_MS,
  AUTO_LOG_ALERT_REFRESH_TIMEOUT_MS,
  AUTO_LOG_ALERT_THRESHOLD_DEFAULT,
  AUTO_LOG_ALERT_WINDOW_MS,
  STORAGE_KEY_AUTO,
  STORAGE_KEY_AUTO_LOG_ALERT_RECOVERED_AT,
  STORAGE_KEY_AUTO_LOG_ALERT_THRESHOLD,
  STORAGE_KEY_GROUP,
  STORAGE_KEY_SUBSCRIPTION,
  SUBSCRIPTION_FILTER_ALL,
} from '@/constants/profile-proxy-storage'
import { useProfiles } from '@/hooks/use-profiles'
import { useProxySelection } from '@/hooks/use-proxy-selection'
import { useSubscriptionNodes } from '@/hooks/use-subscription-nodes'
import { useVerge } from '@/hooks/use-verge'
import {
  useAppRefreshers,
  useClashConfigData,
  useProxiesData,
} from '@/providers/app-data-context'
import { updateProfile } from '@/services/cmds'
import delayManager from '@/services/delay'
import {
  getHighSeverityAlertCount,
  resetHighSeverityAlerts,
  subscribeHighSeverityAlerts,
} from '@/services/log-alert-rate'
import {
  isInteractableMember,
  resolveMember,
  type ProxyGroupView,
} from '@/types/proxy-view'
import { debugLog } from '@/utils/debug'
import {
  classifyDelay,
  compareByDelay,
  DEFAULT_DELAY_TIMEOUT,
} from '@/utils/delay'
import {
  readProfileScopedItem,
  writeProfileScopedItem,
} from '@/utils/profile-scoped-storage'

const readAutoModeForGroup = (
  profileId: string | null,
  group: ProxyGroupView | null,
): boolean => {
  if (!group) return false
  const saved = readProfileScopedItem(
    `${STORAGE_KEY_AUTO}:${group.name}`,
    profileId,
  )
  const urlTestDefault = group.type === 'URLTest' && !group.fixed
  return saved == null ? !!urlTestDefault : saved === '1'
}

const readAlertThreshold = (profileId: string | null): number => {
  const saved = readProfileScopedItem(
    STORAGE_KEY_AUTO_LOG_ALERT_THRESHOLD,
    profileId,
  )
  const parsed = saved == null ? Number.NaN : Number(saved)
  return Number.isFinite(parsed) && parsed >= 1
    ? Math.floor(parsed)
    : AUTO_LOG_ALERT_THRESHOLD_DEFAULT
}

/**
 * Runs log-alert auto recovery from the app shell so it still works when Home
 * is not mounted. Reads profile-scoped preferences from localStorage and uses
 * live proxy data from the shared app context.
 */
export const useLogAlertAutoRecoveryMonitor = () => {
  const { verge } = useVerge()
  const { proxyView } = useProxiesData()
  const { refreshProxy } = useAppRefreshers()
  const { clashConfig } = useClashConfigData()
  const { profiles, current, mutateProfiles } = useProfiles()
  const { nodeMetaMap } = useSubscriptionNodes()

  const profileId = current?.uid ?? null
  const profileIdRef = useRef(profileId)
  profileIdRef.current = profileId

  const { changeProxy } = useProxySelection({
    onSuccess: () => refreshProxy(),
    onError: (error) =>
      console.error('[LogAlertRecovery] proxy switch failed', error),
  })

  const liveStateRef = useRef({
    verge,
    proxyView,
    refreshProxy,
    clashMode: clashConfig?.mode,
    profileItems: profiles?.items,
    mutateProfiles,
    nodeMetaMap,
    changeProxy,
  })
  liveStateRef.current = {
    verge,
    proxyView,
    refreshProxy,
    clashMode: clashConfig?.mode,
    profileItems: profiles?.items,
    mutateProfiles,
    nodeMetaMap,
    changeProxy,
  }

  const runningRef = useRef(false)
  const attemptedAtRef = useRef(0)

  useEffect(() => {
    const saved = readProfileScopedItem(
      STORAGE_KEY_AUTO_LOG_ALERT_RECOVERED_AT,
      profileId,
    )
    const parsed = saved == null ? Number.NaN : Number(saved)
    attemptedAtRef.current = Number.isFinite(parsed) && parsed > 0 ? parsed : 0
  }, [profileId])

  useEffect(() => {
    let cancelled = false
    const pendingWaits = new Map<ReturnType<typeof setTimeout>, () => void>()

    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        if (cancelled) {
          resolve()
          return
        }
        const timer = setTimeout(() => {
          pendingWaits.delete(timer)
          resolve()
        }, ms)
        pendingWaits.set(timer, resolve)
      })

    const resolveSelectedGroup = (): ProxyGroupView | null => {
      const { proxyView: latestProxyView, clashMode } = liveStateRef.current
      if (!latestProxyView) return null
      const mode = clashMode?.toLowerCase()
      if (mode === 'direct' || mode === 'global') return null

      const groupName = readProfileScopedItem(
        STORAGE_KEY_GROUP,
        profileIdRef.current,
      )
      if (!groupName) return null
      return (
        latestProxyView.groups.find((group) => group.name === groupName) ?? null
      )
    }

    const groupMembersSignature = (group: ProxyGroupView | null) =>
      group ? group.members.map((member) => member.name).join('|') : ''

    const waitForRefreshedNodes = async (previousSignature: string) => {
      const deadline = Date.now() + AUTO_LOG_ALERT_REFRESH_TIMEOUT_MS
      while (!cancelled && Date.now() < deadline) {
        await wait(AUTO_LOG_ALERT_REFRESH_POLL_MS)
        const group = resolveSelectedGroup()
        if (groupMembersSignature(group) !== previousSignature) return
      }
    }

    const resolveTargetSubscriptionUid = (
      selectedProxyName: string,
      selectedSubscriptionUid: string,
    ) => {
      if (
        selectedSubscriptionUid &&
        selectedSubscriptionUid !== SUBSCRIPTION_FILTER_ALL
      ) {
        return selectedSubscriptionUid
      }
      if (!selectedProxyName) return null
      return (
        liveStateRef.current.nodeMetaMap.get(selectedProxyName)?.profileUid ??
        null
      )
    }

    const pickBestProxyName = (
      group: ProxyGroupView,
      excludeNodeName?: string,
    ): string | null => {
      const { proxyView: latestProxyView, verge: latestVerge } =
        liveStateRef.current
      if (!latestProxyView) return null
      const timeout =
        typeof latestVerge?.default_latency_timeout === 'number' &&
        latestVerge.default_latency_timeout > 0
          ? latestVerge.default_latency_timeout
          : DEFAULT_DELAY_TIMEOUT

      const candidates = group.members
        .map((member) => resolveMember(latestProxyView, member))
        .filter(isInteractableMember)
        .filter(({ ref }) => {
          const name = ref.name
          return (
            name !== 'DIRECT' && name !== 'REJECT' && name !== excludeNodeName
          )
        })

      if (candidates.length === 0) return null

      let best = candidates[0]
      for (const member of candidates.slice(1)) {
        const cmp = compareByDelay(
          delayManager.getDelayFix(member, group.name),
          delayManager.getDelayFix(best, group.name),
          timeout,
        )
        if (cmp < 0) best = member
      }

      const bestDelay = delayManager.getDelayFix(best, group.name)
      if (classifyDelay(bestDelay, timeout) !== 'measured') return null
      return best.ref.name
    }

    const applyAutoSelection = async (
      group: ProxyGroupView,
      opts?: { excludeNodeName?: string; forceDelayProbe?: boolean },
    ): Promise<string | null> => {
      const excludeNodeName = opts?.excludeNodeName
      const forceDelayProbe = Boolean(opts?.forceDelayProbe)

      if (group.type === 'URLTest' && !excludeNodeName && !forceDelayProbe) {
        try {
          await unfixedProxy(group.name)
          liveStateRef.current.refreshProxy()
        } catch (error) {
          console.error('[LogAlertRecovery] auto unfixed failed', error)
        }
        return null
      }

      const { proxyView: latestProxyView, verge: latestVerge } =
        liveStateRef.current
      if (!latestProxyView) return null
      const timeout = latestVerge?.default_latency_timeout || 10000
      let bestName = pickBestProxyName(group, excludeNodeName)

      if (forceDelayProbe || !bestName) {
        const interactable = group.members
          .map((member) => resolveMember(latestProxyView, member))
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
            console.error('[LogAlertRecovery] auto delay probe failed', error)
          }
          bestName = pickBestProxyName(group, excludeNodeName)
        }
      }

      if (!bestName) return null
      const changed = await liveStateRef.current.changeProxy(
        group.name,
        bestName,
        group.now,
      )
      return changed ? bestName : null
    }

    const updateTargetSubscription = async (selectedProxyName: string) => {
      const selectedSubscriptionUid =
        readProfileScopedItem(STORAGE_KEY_SUBSCRIPTION, profileIdRef.current) ??
        SUBSCRIPTION_FILTER_ALL
      const uid = resolveTargetSubscriptionUid(
        selectedProxyName,
        selectedSubscriptionUid,
      )
      if (!uid) return
      const profileItem = liveStateRef.current.profileItems?.find(
        (item) => item?.uid === uid,
      )
      if (profileItem?.type !== 'remote') {
        debugLog(`[LogAlertRecovery] skips non-remote subscription: ${uid}`)
        return
      }
      try {
        await updateProfile(uid)
      } catch (error) {
        console.error('[LogAlertRecovery] subscription update failed', error)
      }
    }

    const runRecovery = async () => {
      const group = resolveSelectedGroup()
      const previousSignature = groupMembersSignature(group)
      const selectedProxyName = group?.now ?? ''

      await updateTargetSubscription(selectedProxyName)
      if (cancelled) return false

      await liveStateRef.current.mutateProfiles().catch(() => {})
      liveStateRef.current.refreshProxy()
      await waitForRefreshedNodes(previousSignature)
      if (cancelled) return false

      const latestGroup = resolveSelectedGroup()
      if (!latestGroup) return false
      if (!readAutoModeForGroup(profileIdRef.current, latestGroup)) {
        return false
      }

      const switchedTo = await applyAutoSelection(latestGroup, {
        excludeNodeName: latestGroup.now || undefined,
        forceDelayProbe: true,
      })
      if (!switchedTo) {
        debugLog('[LogAlertRecovery] found no usable node to switch to')
        return false
      }
      debugLog(`[LogAlertRecovery] switched to ${switchedTo}`)
      return true
    }

    const watchingSince = Date.now()

    const unsubscribe = subscribeHighSeverityAlerts(() => {
      const mode = liveStateRef.current.clashMode?.toLowerCase()
      if (mode === 'direct' || mode === 'global') return

      const group = resolveSelectedGroup()
      if (!group) return
      if (!readAutoModeForGroup(profileIdRef.current, group)) return
      if (runningRef.current) return

      const now = Date.now()
      if (now - attemptedAtRef.current < AUTO_LOG_ALERT_RECOVERY_COOLDOWN_MS) {
        return
      }

      const countFrom = Math.max(watchingSince, attemptedAtRef.current)
      const threshold = readAlertThreshold(profileIdRef.current)
      if (
        getHighSeverityAlertCount(AUTO_LOG_ALERT_WINDOW_MS, now, countFrom) <
        threshold
      ) {
        return
      }

      runningRef.current = true
      attemptedAtRef.current = now
      writeProfileScopedItem(
        STORAGE_KEY_AUTO_LOG_ALERT_RECOVERED_AT,
        profileIdRef.current,
        String(now),
      )

      void runRecovery()
        .then((recovered) => {
          if (recovered) resetHighSeverityAlerts()
        })
        .catch((error) => {
          console.error('[LogAlertRecovery] failed', error)
        })
        .finally(() => {
          runningRef.current = false
        })
    })

    return () => {
      cancelled = true
      pendingWaits.forEach((resolve, timer) => {
        clearTimeout(timer)
        resolve()
      })
      pendingWaits.clear()
      unsubscribe()
    }
  }, [])
}
