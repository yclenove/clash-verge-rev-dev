import { Close, ExpandMoreRounded } from '@mui/icons-material'
import {
  Alert,
  Box,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Snackbar,
  TextField,
  Typography,
  alpha,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import {
  type Key,
  type MouseEvent,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  closeAllConnections,
  selectNodeForGroup,
} from 'tauri-plugin-mihomo-api'

import { useRecordSelection } from '@/hooks/use-record-selection'
import { useServersGeoip } from '@/hooks/use-servers-geoip'
import { useSubscriptionNodes } from '@/hooks/use-subscription-nodes'
import { useAppRefreshers, useProxiesData } from '@/providers/app-data-context'
import {
  patchVergeConfig,
  updateProxyChainConfigInRuntime,
} from '@/services/cmds'
import { showNotice } from '@/services/notice-service'
import {
  isInteractableMember,
  selectAllChainNodes,
  type ProxyGroupView,
  type ResolvedProxyMember,
} from '@/types/proxy-view'
import { translateGroupType } from '@/utils/proxy-type'

import { ScrollTopButton } from '../layout/scroll-top-button'

import { ProxyChain } from './proxy-chain'
import { type ProxyChainItem, rebindProxyChainItems } from './proxy-chain-model'
import { ProxyNodeMetaContext } from './proxy-node-meta-context'
import { ProxyRender } from './proxy-render'
import type { HeadState } from './use-head-state'
import type { IRenderItem } from './use-render-list'

// ---- Types ----

type VirtualListItem = {
  key: Key
  index: number
  start: number
  end: number
}

type ProxyGroupOption = ProxyGroupView

// ---- Props ----

interface ChainRuleHeaderProps {
  title: string
  selectLabel: string
  currentGroup: ProxyGroupOption | null
  canSelectGroup: boolean
  onMenuOpen: (event: MouseEvent<HTMLElement>) => void
}

interface GroupSelectDialogProps {
  open: boolean
  groups: ProxyGroupOption[]
  selectedGroup: string | null
  emptyText: string
  nodeCountLabel: (count: number) => string
  onClose: () => void
  onSelect: (groupName: string) => void | Promise<void>
}

interface ProxyGroupsChainProps {
  mode: string
  chainConfigData?: string | null
  availableGroups: any[]
  activeSelectedGroup: string | null
  showScrollTop: boolean

  // Virtual list data (from parent's virtualizer)
  parentRef: RefObject<HTMLDivElement | null>
  totalSize: number
  virtualItems: VirtualListItem[]
  renderList: IRenderItem[]
  activeStickyIndex: number | null
  measureElement: (node: Element | null) => void

  // Shared callbacks
  onCheckAll: (groupName: string) => void
  onHeadState: (groupName: string, patch: Partial<HeadState>) => void
  onLocation: (group: any) => void
  onGroupSelect: (groupName: string) => void
  onScrollToTop: () => void
}

// ---- Sub-components ----

function ChainRuleHeader({
  title,
  selectLabel,
  currentGroup,
  canSelectGroup,
  onMenuOpen,
}: ChainRuleHeaderProps) {
  const { t } = useTranslation()

  return (
    <Box sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
      <Box
        sx={{
          px: 2,
          py: 1.5,
          borderBottom: '1px solid',
          borderColor: 'divider',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Typography variant="h6" sx={{ fontWeight: 600, fontSize: '16px' }}>
            {title}
          </Typography>

          {currentGroup && (
            <Chip
              size="small"
              label={`${currentGroup.name} (${translateGroupType(currentGroup.type, t)})`}
              variant="outlined"
              sx={{
                fontSize: '12px',
                maxWidth: '200px',
                '& .MuiChip-label': {
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                },
              }}
            />
          )}
        </Box>

        {canSelectGroup && (
          <IconButton
            size="small"
            onClick={onMenuOpen}
            sx={{
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: '4px',
              padding: '4px 8px',
            }}
          >
            <Typography variant="body2" sx={{ mr: 0.5, fontSize: '12px' }}>
              {selectLabel}
            </Typography>
            <ExpandMoreRounded fontSize="small" />
          </IconButton>
        )}
      </Box>
    </Box>
  )
}

function GroupSelectDialog({
  open,
  groups,
  selectedGroup,
  emptyText,
  nodeCountLabel,
  onClose,
  onSelect,
}: GroupSelectDialogProps) {
  const { t } = useTranslation()
  const theme = useTheme()
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return groups
    return groups.filter((group) => group.name.toLowerCase().includes(q))
  }, [groups, query])

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        {t('proxies.page.rules.select')}
        <IconButton size="small" onClick={onClose}>
          <Close fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <TextField
          size="small"
          fullWidth
          placeholder={t('proxies.page.rules.search')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          sx={{ mb: 1.5 }}
        />
        {filtered.length === 0 ? (
          <Typography
            color="text.secondary"
            sx={{ textAlign: 'center', py: 6 }}
          >
            {emptyText}
          </Typography>
        ) : (
          <Box sx={{ maxHeight: 420, overflow: 'auto' }}>
            <List dense disablePadding>
              {filtered.map((group) => {
                const selected = selectedGroup === group.name
                return (
                  <ListItemButton
                    key={group.name}
                    onClick={() => void onSelect(group.name)}
                    sx={{
                      borderRadius: 1,
                      py: 0.75,
                      mb: 0.5,
                      border: '1px solid',
                      borderColor: selected
                        ? theme.palette.primary.main
                        : 'transparent',
                      backgroundColor: selected
                        ? alpha(theme.palette.primary.main, 0.08)
                        : 'transparent',
                      '&:hover': {
                        backgroundColor: selected
                          ? alpha(theme.palette.primary.main, 0.12)
                          : theme.palette.action.hover,
                      },
                    }}
                  >
                    <ListItemText
                      primary={
                        <Box
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 0.75,
                          }}
                        >
                          <Typography
                            variant="body2"
                            sx={{ fontWeight: selected ? 700 : 500 }}
                          >
                            {group.name}
                          </Typography>
                          <Chip
                            label={translateGroupType(group.type, t)}
                            size="small"
                            color={selected ? 'primary' : 'default'}
                            variant="outlined"
                            sx={{ height: 18, fontSize: '0.65rem' }}
                          />
                        </Box>
                      }
                      secondary={nodeCountLabel(group.members.length)}
                    />
                  </ListItemButton>
                )
              })}
            </List>
          </Box>
        )}
      </DialogContent>
    </Dialog>
  )
}

function ProxyVirtualList({
  parentRef,
  height,
  totalSize,
  virtualItems,
  renderList,
  activeStickyIndex,
  isChainMode,
  measureElement,
  onLocation,
  onCheckAll,
  onHeadState,
  onChangeProxy,
}: {
  parentRef: RefObject<HTMLDivElement | null>
  height: string
  totalSize: number
  virtualItems: VirtualListItem[]
  renderList: IRenderItem[]
  activeStickyIndex: number | null
  isChainMode?: boolean
  measureElement: (node: Element | null) => void
  onLocation: (group: any) => void
  onCheckAll: (groupName: string) => void
  onHeadState: (groupName: string, patch: Partial<HeadState>) => void
  onChangeProxy: (group: ProxyGroupView, member: ResolvedProxyMember) => void
}) {
  const theme = useTheme()
  const stickyBackground =
    theme.palette.mode === 'dark' ? '#1e1f27' : 'var(--background-color)'

  return (
    <div ref={parentRef} style={{ height, overflow: 'auto' }}>
      <div style={{ height: totalSize, position: 'relative' }}>
        {virtualItems.map((virtualItem) => (
          <div
            key={virtualItem.key}
            data-index={virtualItem.index}
            ref={measureElement}
            style={{
              position:
                virtualItem.index === activeStickyIndex ? 'sticky' : 'absolute',
              top: 0,
              left: 0,
              zIndex: virtualItem.index === activeStickyIndex ? 5 : undefined,
              display:
                virtualItem.index === activeStickyIndex
                  ? 'flow-root'
                  : undefined,
              backgroundColor:
                virtualItem.index === activeStickyIndex
                  ? stickyBackground
                  : undefined,
              width: '100%',
              transform:
                virtualItem.index === activeStickyIndex
                  ? undefined
                  : `translateY(${virtualItem.start}px)`,
            }}
          >
            <ProxyRender
              item={renderList[virtualItem.index]}
              stickyed={virtualItem.index === activeStickyIndex}
              onLocation={onLocation}
              onCheckAll={onCheckAll}
              onHeadState={onHeadState}
              onChangeProxy={onChangeProxy}
              isChainMode={isChainMode}
            />
          </div>
        ))}
        <div style={{ height: 8 }} />
      </div>
    </div>
  )
}

// ---- Main Chain Component ----

export function ProxyGroupsChain(props: ProxyGroupsChainProps) {
  const { t } = useTranslation()
  const {
    mode,
    chainConfigData,
    availableGroups,
    activeSelectedGroup,
    showScrollTop,
    parentRef,
    totalSize,
    virtualItems,
    renderList,
    activeStickyIndex,
    measureElement,
    onCheckAll,
    onHeadState,
    onLocation,
    onGroupSelect,
    onScrollToTop,
  } = props
  const { proxyView } = useProxiesData()
  const { refreshProxy } = useAppRefreshers()
  const recordSelection = useRecordSelection()
  const { subscriptions, nodeProfileMap, nodeMetaMap } = useSubscriptionNodes()

  // Chain-specific state
  const [proxyChain, setProxyChain] = useState<ProxyChainItem[]>(() => {
    try {
      const saved = localStorage.getItem('proxy-chain-items')
      if (saved) {
        return JSON.parse(saved)
      }
    } catch {
      // ignore
    }
    return []
  })

  // Always use the full chain pool ? not the visible/collapsed render rows ?
  // so folding a subscription section does not drop rebind candidates.
  const candidateNodes = useMemo(
    () => (proxyView ? selectAllChainNodes(proxyView) : []),
    [proxyView],
  )

  const currentProxyChain = useMemo(() => {
    const base = proxyView
      ? rebindProxyChainItems(proxyChain, candidateNodes, proxyView)
      : proxyChain.map((item) => ({
          ...item,
          recordId: undefined,
          delay: undefined,
        }))

    if (nodeMetaMap.size === 0) return base

    return base.map((item) => {
      if (item.server) return item
      const server = nodeMetaMap.get(item.name)?.server
      return server ? { ...item, server } : item
    })
  }, [candidateNodes, proxyChain, proxyView, nodeMetaMap])

  useEffect(() => {
    if (currentProxyChain.length > 0) {
      // Keep definition / profile metadata so multi-sub picks survive reload
      // even when a node is briefly missing from the runtime view.
      const persistedChain = currentProxyChain.map(
        ({
          id,
          name,
          type,
          delay,
          definition,
          profileName,
          profileUid,
          server,
          countryCode,
          country,
          source,
          recordId,
        }) => ({
          id,
          name,
          type,
          delay,
          definition,
          profileName,
          profileUid,
          server,
          countryCode,
          country,
          source,
          recordId,
        }),
      )
      localStorage.setItem('proxy-chain-items', JSON.stringify(persistedChain))
    } else {
      localStorage.removeItem('proxy-chain-items')
    }
  }, [currentProxyChain])

  const [ruleDialogOpen, setRuleDialogOpen] = useState(false)
  const [duplicateWarning, setDuplicateWarning] = useState<{
    open: boolean
    message: string
  }>({ open: false, message: '' })

  // Compute current group for rule header
  const currentGroup = useMemo(() => {
    if (!activeSelectedGroup) return null
    return (
      availableGroups.find(
        (group: ProxyGroupView) => group.name === activeSelectedGroup,
      ) ?? null
    )
  }, [activeSelectedGroup, availableGroups])

  // Handlers
  const handleGroupMenuOpen = (_event: React.MouseEvent<HTMLElement>) => {
    setRuleDialogOpen(true)
  }

  const handleGroupMenuClose = () => {
    setRuleDialogOpen(false)
  }

  const handleGroupSelect = async (groupName: string) => {
    // Selecting a rule group only changes the chain exit target. Keep the
    // drafted chain so users can reconnect against another group without
    // rebuilding the hop list after multi-sub merge.
    if (groupName === activeSelectedGroup) {
      handleGroupMenuClose()
      return
    }

    if (mode === 'rule') {
      try {
        await updateProxyChainConfigInRuntime(null)
        if (activeSelectedGroup) {
          try {
            await selectNodeForGroup(activeSelectedGroup, 'DIRECT')
            recordSelection(activeSelectedGroup, 'DIRECT')
          } catch {
            const firstNode = currentProxyChain[0]?.name
            if (firstNode) {
              await selectNodeForGroup(activeSelectedGroup, firstNode)
              recordSelection(activeSelectedGroup, firstNode)
            }
          }
        }
        await patchVergeConfig({
          proxy_chain_nodes: [],
          proxy_chain_group: null,
        })
        localStorage.removeItem('proxy-chain-group')
        localStorage.removeItem('proxy-chain-exit-node')
        await closeAllConnections()
        await refreshProxy()
      } catch (error) {
        console.error(
          'Failed to disconnect chain before changing group:',
          error,
        )
        showNotice.error(error)
        return
      }
    }

    onGroupSelect(groupName)
    handleGroupMenuClose()
    showNotice.info(
      'proxies.feedback.notifications.chainDisconnectedForGroupChange',
    )
  }

  const handleCloseDuplicateWarning = useCallback(() => {
    setDuplicateWarning({ open: false, message: '' })
  }, [])

  const handleChangeProxy = useCallback(
    (_group: ProxyGroupView, member: ResolvedProxyMember) => {
      if (!isInteractableMember(member) || member.kind !== 'node') return
      const { node } = member
      setProxyChain((prev) => {
        const current = proxyView
          ? rebindProxyChainItems(prev, candidateNodes, proxyView)
          : prev
        if (
          current.some(
            (item) =>
              (item.recordId !== undefined &&
                item.recordId === node.recordId) ||
              item.name === node.name,
          )
        ) {
          const warningMessage = t('proxies.page.chain.duplicateNode')
          setDuplicateWarning({
            open: true,
            message: warningMessage,
          })
          return prev // 返回原来的状态，不做任何更改
        }

        // 安全获取延迟数据，如果没有延迟数据则设为 undefined
        const delay =
          node.history.length > 0
            ? node.history[node.history.length - 1].delay
            : undefined

        const profileUid = nodeProfileMap.get(node.name)
        const profileName = profileUid
          ? subscriptions.find((item) => item.uid === profileUid)?.name
          : undefined
        const meta = nodeMetaMap.get(node.name)
        const chainItem: ProxyChainItem = {
          id: `${node.name}_${Date.now()}`,
          name: node.name,
          recordId: node.recordId,
          source: node.source,
          type: node.type || meta?.type,
          delay,
          profileUid: profileUid ?? meta?.profileUid,
          profileName,
          server: meta?.server,
        }

        return [...current, chainItem]
      })
    },
    [candidateNodes, nodeMetaMap, nodeProfileMap, proxyView, subscriptions, t],
  )

  const serverByName = useMemo(() => {
    const map = new Map<string, string>()
    for (const [name, meta] of nodeMetaMap.entries()) {
      if (meta.server) map.set(name, meta.server)
    }
    return map
  }, [nodeMetaMap])

  const chainListGeo = useServersGeoip(serverByName.values())

  const nodeMetaContextValue = useMemo(
    () => ({
      serverByName,
      geoByServer: chainListGeo,
    }),
    [serverByName, chainListGeo],
  )

  // Render virtual list for chain mode
  const renderProxyList = (height: string) => (
    <ProxyNodeMetaContext value={nodeMetaContextValue}>
      <ProxyVirtualList
        parentRef={parentRef}
        height={height}
        totalSize={totalSize}
        virtualItems={virtualItems}
        renderList={renderList}
        activeStickyIndex={activeStickyIndex}
        isChainMode
        measureElement={measureElement}
        onLocation={onLocation}
        onCheckAll={onCheckAll}
        onHeadState={onHeadState}
        onChangeProxy={handleChangeProxy}
      />
    </ProxyNodeMetaContext>
  )

  const showRuleHeader = mode === 'rule' && availableGroups.length > 0

  return (
    <>
      <Box sx={{ display: 'flex', height: '100%', gap: 2 }}>
        <Box sx={{ flex: 1, position: 'relative' }}>
          {showRuleHeader && (
            <ChainRuleHeader
              title={t('proxies.page.rules.title')}
              selectLabel={t('proxies.page.rules.select')}
              currentGroup={currentGroup}
              canSelectGroup={availableGroups.length > 0}
              onMenuOpen={handleGroupMenuOpen}
            />
          )}

          {renderProxyList(
            showRuleHeader ? 'calc(100% - 80px)' : 'calc(100% - 14px)',
          )}
          <ScrollTopButton show={showScrollTop} onClick={onScrollToTop} />
        </Box>

        <Box sx={{ width: '400px', minWidth: '300px' }}>
          <ProxyChain
            proxyChain={currentProxyChain}
            onUpdateChain={setProxyChain}
            chainConfigData={chainConfigData}
            mode={mode}
            selectedGroup={activeSelectedGroup}
          />
        </Box>
      </Box>

      <Snackbar
        open={duplicateWarning.open}
        autoHideDuration={3000}
        onClose={handleCloseDuplicateWarning}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Alert
          onClose={handleCloseDuplicateWarning}
          severity="warning"
          variant="filled"
        >
          {duplicateWarning.message}
        </Alert>
      </Snackbar>

      <GroupSelectDialog
        open={ruleDialogOpen}
        groups={availableGroups}
        selectedGroup={activeSelectedGroup}
        emptyText={t('proxies.page.empty.noAvailableGroups')}
        nodeCountLabel={(count) =>
          t('proxies.page.labels.nodeCount', { count })
        }
        onClose={handleGroupMenuClose}
        onSelect={handleGroupSelect}
      />
    </>
  )
}
