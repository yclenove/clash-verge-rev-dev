import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { useRuntimeConfig } from '@/hooks/use-clash'
import { useGroupsDelays } from '@/hooks/use-group-delays'
import { useSubscriptionNodes } from '@/hooks/use-subscription-nodes'
import { useVerge } from '@/hooks/use-verge'
import { useAppRefreshers, useProxiesData } from '@/providers/app-data-context'
import delayManager, { type DelaySnapshot } from '@/services/delay'
import {
  isInteractableMember,
  resolveMember,
  selectAllChainNodes,
  selectGlobalChainNodes,
  type ProxyGroupView,
  type ProxyViewV1,
  type ResolvedProxyMember,
} from '@/types/proxy-view'
import { debugLog } from '@/utils/debug'

import { filterSort } from './use-filter-sort'
import {
  DEFAULT_STATE,
  useHeadStateNew,
  type HeadState,
} from './use-head-state'
import { useWindowWidth } from './use-window-width'

export interface ResolvedMemberOccurrence {
  memberIndex: number
  member: ResolvedProxyMember
}

type ProxyGroup = ProxyGroupView

export interface IRenderItem {
  type: 0 | 1 | 2 | 3 | 4
  key: string
  group: ProxyGroup
  member?: ResolvedMemberOccurrence
  memberCol?: ResolvedMemberOccurrence[]
  col?: number
  headState?: HeadState
  icon?: string
  testUrl?: string
}

/**
 * Whether the list about to be drawn contains anything a user would call content.
 *
 * Derived from the list itself rather than predicted beside it. The prediction that used to
 * live in the empty-state model asked a different question in chain mode — whether any
 * Selector or URLTest group existed — which is unrelated to what the chain list is actually
 * built from, so both a false "empty" and a false "not empty" were reachable.
 *
 * A group header alone counts only when the group is visible; every other row is content by
 * definition, including the members of a group that is hidden but expanded.
 */
export const hasRenderableItems = (
  renderList: readonly IRenderItem[],
): boolean => renderList.some((item) => item.type !== 0 || !item.group.hidden)

type GroupCache = {
  now: string | undefined
  members: ProxyGroupView['members']
  headState: HeadState
  col: number
  latencyTimeout: number | undefined
  /// This group's own delays. Compared by identity so that a test settling in one group
  /// does not throw away every other group's sorted order.
  delays: DelaySnapshot | undefined
  items: IRenderItem[]
}

type RuntimeConfigWithProxySequence = IConfigData & { proxies?: unknown }

const resolveOccurrences = (view: ProxyViewV1, group: ProxyGroupView) =>
  group.members.map((member, memberIndex) => ({
    memberIndex,
    member: resolveMember(view, member),
  }))

const memberKey = (
  group: ProxyGroupView,
  occurrence: ResolvedMemberOccurrence,
) => {
  const { memberIndex, member } = occurrence
  const identity =
    member.kind === 'node' ? member.node.recordId : member.ref.name
  return `${group.name}:${memberIndex}:${identity}`
}

const calculateColumns = (width: number, configCol: number): number => {
  if (configCol > 0 && configCol < 6) return configCol
  if (width > 1920) return 5
  if (width > 1450) return 4
  if (width > 1024) return 3
  if (width >= 600) return 2
  return 1
}

const groupOccurrences = <T>(list: T[], size: number): T[][] =>
  list.reduce<T[][]>((acc, item) => {
    const lastGroup = acc[acc.length - 1]
    if (!lastGroup || lastGroup.length >= size) acc.push([item])
    else lastGroup.push(item)
    return acc
  }, [])

const CHAIN_DELAY_GROUP = 'chain-mode'

const virtualGroup = (
  members: ProxyGroupView['members'],
  name: string = CHAIN_DELAY_GROUP,
): ProxyGroupView => ({
  name,
  type: 'Selector',
  alive: true,
  udp: false,
  xudp: false,
  tfo: false,
  mptcp: false,
  smux: false,
  history: [],
  members,
})

type ChainSection = {
  key: string
  title: string
  occurrences: ResolvedMemberOccurrence[]
}

const occurrenceNodeName = (occurrence: ResolvedMemberOccurrence) =>
  occurrence.member.kind === 'node'
    ? occurrence.member.node.name
    : occurrence.member.ref.name

const buildChainSections = (
  occurrences: ResolvedMemberOccurrence[],
  subscriptions: readonly { uid: string; name: string }[],
  nodeProfileMap: ReadonlyMap<string, string>,
  otherTitle: string,
): ChainSection[] => {
  const sections: ChainSection[] = []
  const bucket = new Map<string, ResolvedMemberOccurrence[]>()

  const ensure = (key: string, title: string) => {
    let list = bucket.get(key)
    if (!list) {
      list = []
      bucket.set(key, list)
      sections.push({ key, title, occurrences: list })
    }
    return list
  }

  // Keep subscription order aligned with profiles / chain picker.
  for (const sub of subscriptions) {
    ensure(`sub:${sub.uid}`, sub.name)
  }

  const subName = (uid: string) =>
    subscriptions.find((item) => item.uid === uid)?.name || uid

  for (const occurrence of occurrences) {
    const owner = nodeProfileMap.get(occurrenceNodeName(occurrence))
    if (!owner) {
      ensure('other', otherTitle).push(occurrence)
      continue
    }
    ensure(`sub:${owner}`, subName(owner)).push(occurrence)
  }

  return sections.filter((section) => section.occurrences.length > 0)
}

export const useRenderList = (
  mode: string,
  isChainMode?: boolean,
  // Exit-group target is applied at connect time only; kept for call-site API.
  _selectedGroup?: string | null,
) => {
  const { t } = useTranslation()
  const { proxyView } = useProxiesData()
  const { refreshProxy } = useAppRefreshers()
  const { verge } = useVerge()
  const { width } = useWindowWidth()
  const [headStates, setHeadState] = useHeadStateNew()
  const { subscriptions, nodeProfileMap } = useSubscriptionNodes()
  const latencyTimeout = verge?.default_latency_timeout
  const { data: runtimeConfig } = useRuntimeConfig(!!isChainMode)
  const runtimeProxies = (
    runtimeConfig as RuntimeConfigWithProxySequence | null
  )?.proxies

  // Chain mode always uses single-column list rows (图2 style), not mini cards.
  const col = useMemo(
    () =>
      isChainMode
        ? 1
        : calculateColumns(width, verge?.proxy_layout_column || 6),
    [isChainMode, width, verge?.proxy_layout_column],
  )

  const chainOccurrences = useMemo(() => {
    if (!proxyView || !isChainMode) return []

    // Under multi-sub always-on, chain candidates come from the full merged
    // runtime. The exit group only decides which proxy-group receives the exit
    // node when connecting; it must not hide nodes from other groups/subs.
    const nodes =
      mode === 'global'
        ? runtimeConfig
          ? selectGlobalChainNodes(proxyView, runtimeProxies)
          : selectAllChainNodes(proxyView)
        : selectAllChainNodes(proxyView)

    return nodes.map((node, memberIndex) => ({
      memberIndex,
      member: {
        kind: 'node' as const,
        ref: {
          kind: 'node' as const,
          name: node.name,
          recordId: node.recordId,
        },
        node,
      },
    }))
  }, [isChainMode, mode, proxyView, runtimeConfig, runtimeProxies])

  const chainOccurrencesRef = useRef(chainOccurrences)
  chainOccurrencesRef.current = chainOccurrences
  // Chain delay identity is always the virtual pool — not the exit group.
  // Exit group only matters when connecting; binding list rows to it made
  // `group.now === node.name` light up nodes as if they were all selected.
  const chainDelayGroup = CHAIN_DELAY_GROUP
  const chainDelayKey = chainOccurrences
    .map(({ member }) => {
      if (member.kind !== 'node') return `${member.kind}:${member.ref.name}`
      const source = member.node.source
      return source.kind === 'provider'
        ? `provider:${source.providerName}:${source.proxyName}`
        : `core:${source.proxyName}`
    })
    .join('\u0000')

  useEffect(() => {
    if (!isChainMode || !chainDelayKey) return
    const interactable = chainOccurrencesRef.current
      .map(({ member }) => member)
      .filter(isInteractableMember)
    if (interactable.length === 0) return

    const handle = setTimeout(() => {
      const timeout = verge?.default_latency_timeout || 10000
      debugLog(`[ChainMode] 开始计算 ${interactable.length} 个节点的延迟`)
      void delayManager.checkListDelay(interactable, chainDelayGroup, timeout)
    }, 100)

    return () => {
      clearTimeout(handle)
    }
  }, [
    chainDelayGroup,
    chainDelayKey,
    isChainMode,
    verge?.default_latency_timeout,
  ])

  // Every group this list draws, so a test settling in any of them re-sorts that group.
  const renderedGroupNames = useMemo(() => {
    if (!proxyView) return []
    if (isChainMode) return [CHAIN_DELAY_GROUP]
    return mode === 'rule' || mode === 'script'
      ? proxyView.groups.map(({ name }) => name)
      : proxyView.global
        ? [proxyView.global.name]
        : []
  }, [isChainMode, mode, proxyView])
  const groupDelays = useGroupsDelays(renderedGroupNames)

  const groupCacheRef = useRef<Map<string, GroupCache>>(new Map())
  const prevListRef = useRef<IRenderItem[]>([])

  const renderList = useMemo<IRenderItem[]>(() => {
    if (!proxyView) return []

    if (isChainMode) {
      // List metadata is always the virtual chain pool. The selected exit group
      // is applied only at connect time (see proxy-groups / proxy-chain), so it
      // must not own row identity or selection highlighting.
      //
      // Display is grouped by subscription (same ownership map as the chain
      // picker / home card). Delay identity stays on CHAIN_DELAY_GROUP so
      // existing chain delay listeners keep working.
      const delayMembers = chainOccurrences.flatMap(({ member }) =>
        member.kind === 'node'
          ? [
              {
                kind: 'node' as const,
                name: member.node.name,
                recordId: member.node.recordId,
              },
            ]
          : [],
      )
      const delayGroup = virtualGroup(delayMembers, CHAIN_DELAY_GROUP)

      const canGroupBySubscription =
        subscriptions.length > 0 || nodeProfileMap.size > 0
      const sections = canGroupBySubscription
        ? buildChainSections(
            chainOccurrences,
            subscriptions,
            nodeProfileMap,
            t('proxies.page.chain.otherNodes'),
          )
        : [
            {
              key: 'all',
              title: CHAIN_DELAY_GROUP,
              occurrences: chainOccurrences,
            },
          ]

      const ret: IRenderItem[] = []

      for (const section of sections) {
        const sectionMembers = section.occurrences.flatMap(({ member }) =>
          member.kind === 'node'
            ? [
                {
                  kind: 'node' as const,
                  name: member.node.name,
                  recordId: member.node.recordId,
                },
              ]
            : [],
        )
        // Header uses subscription title for display / collapse state.
        // Node rows keep delayGroup so latency cache keys stay stable.
        const headerGroup =
          section.key === 'all'
            ? delayGroup
            : virtualGroup(sectionMembers, section.title)
        const storedHead = headStates[headerGroup.name]
        const headState: HeadState = {
          ...DEFAULT_STATE,
          ...storedHead,
          // First visit: expand every subscription section.
          open: storedHead?.open ?? true,
        }

        if (section.key !== 'all') {
          ret.push({
            type: 0,
            key: `chain-head:${section.key}`,
            group: headerGroup,
            headState,
          })
        }

        if (!(headState.open ?? true) && section.key !== 'all') {
          continue
        }

        const occurrences = filterSort(
          section.occurrences,
          CHAIN_DELAY_GROUP,
          headState.filterText || '',
          headState.sortType,
          latencyTimeout,
          {
            matchCase: headState.filterMatchCase,
            matchWholeWord: headState.filterMatchWholeWord,
            useRegularExpression: headState.filterUseRegularExpression,
          },
        )

        if (occurrences.length === 0) {
          ret.push({
            type: 3,
            key: `chain-empty:${section.key}`,
            group: headerGroup,
            headState,
          })
          continue
        }

        if (col > 1) {
          ret.push(
            ...groupOccurrences(occurrences, col).map((memberCol) => ({
              type: 4 as const,
              key: `chain-col:${section.key}:${memberKey(delayGroup, memberCol[0])}`,
              group: delayGroup,
              headState,
              col,
              memberCol,
            })),
          )
        } else {
          ret.push(
            ...occurrences.map((member) => ({
              type: 2 as const,
              key: `chain:${section.key}:${memberKey(delayGroup, member)}`,
              group: delayGroup,
              member,
              headState,
            })),
          )
        }
      }

      return ret
    }

    const useRule = mode === 'rule' || mode === 'script'
    const renderGroups = useRule
      ? proxyView.groups
      : proxyView.global === null
        ? []
        : [proxyView.global]
    const cache = groupCacheRef.current
    let anyChanged = false

    const retList = renderGroups.flatMap((group) => {
      const headState = headStates[group.name] || DEFAULT_STATE
      const cached = cache.get(group.name)
      if (
        cached &&
        cached.now === group.now &&
        cached.members === group.members &&
        cached.headState === headState &&
        cached.col === col &&
        cached.latencyTimeout === latencyTimeout &&
        cached.delays === groupDelays.get(group.name)
      ) {
        return cached.items
      }

      anyChanged = true
      const ret: IRenderItem[] = [
        {
          type: 0,
          key: group.name,
          group,
          headState,
          icon: group.icon,
          testUrl: group.testUrl,
        },
      ]

      if (headState.open || !useRule) {
        const occurrences = filterSort(
          resolveOccurrences(proxyView, group),
          group.name,
          headState.filterText,
          headState.sortType,
          latencyTimeout,
          {
            matchCase: headState.filterMatchCase,
            matchWholeWord: headState.filterMatchWholeWord,
            useRegularExpression: headState.filterUseRegularExpression,
          },
        )
        if (!useRule) {
          ret.push({ type: 1, key: `head-${group.name}`, group, headState })
        }
        if (occurrences.length === 0) {
          ret.push({ type: 3, key: `empty-${group.name}`, group, headState })
        } else if (col > 1) {
          ret.push(
            ...groupOccurrences(occurrences, col).map((memberCol) => ({
              type: 4 as const,
              key: `col:${memberKey(group, memberCol[0])}`,
              group,
              headState,
              col,
              memberCol,
            })),
          )
        } else {
          ret.push(
            ...occurrences.map((member) => ({
              type: 2 as const,
              key: memberKey(group, member),
              group,
              member,
              headState,
            })),
          )
        }
      }

      cache.set(group.name, {
        now: group.now,
        members: group.members,
        headState,
        col,
        latencyTimeout,
        delays: groupDelays.get(group.name),
        items: ret,
      })
      return ret
    })

    const filtered = !useRule
      ? retList.slice(1)
      : retList.filter((item) => !item.group.hidden)
    if (!anyChanged && prevListRef.current.length === filtered.length) {
      return prevListRef.current
    }
    prevListRef.current = filtered
    return filtered
  }, [
    chainOccurrences,
    col,
    groupDelays,
    headStates,
    isChainMode,
    latencyTimeout,
    mode,
    nodeProfileMap,
    proxyView,
    subscriptions,
    t,
  ])

  return {
    renderList,
    onProxies: refreshProxy,
    onHeadState: setHeadState,
    currentColumns: col,
  }
}
