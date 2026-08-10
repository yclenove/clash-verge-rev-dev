import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Add,
  ArrowDownward,
  Delete as DeleteIcon,
  DragIndicator,
  Link,
  LinkOff,
  WarningRounded,
} from '@mui/icons-material'
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  Paper,
  Typography,
  useTheme,
} from '@mui/material'
import * as yaml from 'js-yaml'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  closeAllConnections,
  selectNodeForGroup,
} from 'tauri-plugin-mihomo-api'

import { TooltipIcon } from '@/components/base'
import { useRuntimeConfig } from '@/hooks/use-clash'
import { useRecordSelection } from '@/hooks/use-record-selection'
import { formatGeoParts, useServersGeoip } from '@/hooks/use-servers-geoip'
import { useSubscriptionNodes } from '@/hooks/use-subscription-nodes'
import { useAppRefreshers, useProxiesData } from '@/providers/app-data-context'
import {
  patchVergeConfig,
  updateProxyChainConfigInRuntime,
} from '@/services/cmds'
import { selectAllChainNodes, selectGlobalChainNodes } from '@/types/proxy-view'
import { getCountryFlag } from '@/utils/country'
import { debugLog } from '@/utils/debug'

import { rebindProxyChainItems, type ProxyChainItem } from './proxy-chain-model'
import { ProxyChainPicker } from './proxy-chain-picker'

type RuntimeConfigWithProxySequence = IConfigData & { proxies?: unknown }

interface ParsedChainConfig {
  proxies?: Array<{
    name: string
    type: string
    [key: string]: any
  }>
}

interface ProxyChainProps {
  proxyChain: ProxyChainItem[]
  onUpdateChain: (chain: ProxyChainItem[]) => void
  chainConfigData?: string | null
  onMarkUnsavedChanges?: () => void
  mode?: string
  selectedGroup?: string | null
}

interface SortableItemProps {
  proxy: ProxyChainItem
  geo?: IServerGeoInfo
  index: number
  isFirst: boolean
  isLast: boolean
  onRemove: (id: string) => void
}

const toChainItems = (
  parsedConfig: ParsedChainConfig | null | undefined,
): ProxyChainItem[] => {
  const timestamp = Date.now()

  return (
    parsedConfig?.proxies?.map((proxy, index) => ({
      id: `${proxy.name}_${timestamp}_${index}`,
      name: proxy.name,
      type: proxy.type,
      delay: undefined,
    })) || []
  )
}

const SortableItem = ({
  proxy,
  geo,
  index,
  isFirst,
  isLast,
  onRemove,
}: SortableItemProps) => {
  const theme = useTheme()
  const { t } = useTranslation()
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: proxy.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const roleLabel = isFirst
    ? t('proxies.page.chain.entryNode')
    : isLast
      ? t('proxies.page.chain.exitNode')
      : undefined

  const roleColor = isFirst
    ? theme.palette.success.main
    : isLast
      ? theme.palette.warning.main
      : undefined

  const mergedGeo: IServerGeoInfo = {
    ip: geo?.ip,
    countryCode: geo?.countryCode ?? proxy.countryCode,
    country: geo?.country ?? proxy.country,
  }
  const { ip: geoIp, region: geoRegion } = formatGeoParts(
    proxy.server,
    mergedGeo,
    getCountryFlag,
  )
  const geoLine = [geoIp, geoRegion].filter(Boolean).join(' ')

  return (
    <Box
      ref={setNodeRef}
      style={style}
      sx={{
        mb: 0,
        display: 'flex',
        alignItems: 'center',
        p: 1,
        backgroundColor: isDragging
          ? theme.palette.action.selected
          : theme.palette.background.default,
        borderRadius: 1,
        border: roleColor
          ? `1.5px solid ${roleColor}`
          : `1px solid ${theme.palette.divider}`,
        boxShadow: isDragging ? theme.shadows[4] : theme.shadows[1],
        transition: 'box-shadow 0.2s, background-color 0.2s',
        opacity: proxy.recordId === undefined ? 0.55 : undefined,
      }}
    >
      <Box
        {...attributes}
        {...listeners}
        sx={{
          display: 'flex',
          alignItems: 'center',
          mr: 1,
          color: theme.palette.text.secondary,
          cursor: 'grab',
          '&:active': {
            cursor: 'grabbing',
          },
        }}
      >
        <DragIndicator />
      </Box>

      {roleLabel ? (
        <Chip
          label={roleLabel}
          size="small"
          sx={{
            mr: 1,
            fontWeight: 700,
            color: '#fff',
            backgroundColor: roleColor,
          }}
        />
      ) : (
        <Chip
          label={`${index + 1}`}
          size="small"
          color="primary"
          sx={{ mr: 1, minWidth: 32 }}
        />
      )}

      <Box sx={{ flex: 1, minWidth: 0, mr: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Typography
            variant="body2"
            sx={{
              fontWeight: 500,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {proxy.name}
          </Typography>
          {proxy.profileName && (
            <Chip
              label={proxy.profileName}
              size="small"
              color="primary"
              variant="outlined"
              sx={{
                height: 16,
                fontSize: '0.6rem',
                maxWidth: 90,
                '& .MuiChip-label': {
                  px: 0.5,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                },
              }}
            />
          )}
        </Box>
        {geoLine ? (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{
              display: 'block',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={geoLine}
          >
            {geoLine}
          </Typography>
        ) : null}
      </Box>

      {proxy.type && (
        <Chip
          label={proxy.type}
          size="small"
          variant="outlined"
          sx={{ mr: 1 }}
        />
      )}

      {proxy.delay !== undefined && (
        <Chip
          label={
            proxy.delay > 0 ? `${proxy.delay}ms` : t('shared.labels.timeout')
          }
          size="small"
          color={
            proxy.delay > 0 && proxy.delay < 200
              ? 'success'
              : proxy.delay > 0 && proxy.delay < 800
                ? 'warning'
                : 'error'
          }
          sx={{ mr: 1, fontSize: '0.7rem', minWidth: 50 }}
        />
      )}

      <IconButton
        size="small"
        onClick={() => onRemove(proxy.id)}
        sx={{
          color: theme.palette.error.main,
          '&:hover': {
            backgroundColor: theme.palette.error.light + '20',
          },
        }}
      >
        <DeleteIcon fontSize="small" />
      </IconButton>
    </Box>
  )
}

export const ProxyChain = ({
  proxyChain,
  onUpdateChain,
  chainConfigData,
  onMarkUnsavedChanges,
  mode,
  selectedGroup,
}: ProxyChainProps) => {
  const theme = useTheme()
  const { t } = useTranslation()
  const chainWarning = t('proxies.page.chain.warning')
  const { proxyView } = useProxiesData()
  const { refreshProxy } = useAppRefreshers()
  const { data: runtimeConfig } = useRuntimeConfig(true)
  const [isConnecting, setIsConnecting] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const recordSelection = useRecordSelection()
  const markUnsavedChanges = useCallback(() => {
    onMarkUnsavedChanges?.()
  }, [onMarkUnsavedChanges])

  const candidates = useMemo(() => {
    if (!proxyView) return []
    // Rebind against the full merged node set so chain items from any
    // subscription stay resolved when the rule target group changes.
    if (mode === 'global') {
      if (!runtimeConfig) return selectAllChainNodes(proxyView)
      const runtimeProxies = (
        runtimeConfig as RuntimeConfigWithProxySequence | null
      )?.proxies
      return selectGlobalChainNodes(proxyView, runtimeProxies)
    }
    return selectAllChainNodes(proxyView)
  }, [mode, proxyView, runtimeConfig])

  const { nodeMetaMap } = useSubscriptionNodes()

  const currentProxyChain = useMemo(() => {
    const base = proxyView
      ? rebindProxyChainItems(proxyChain, candidates, proxyView)
      : proxyChain.map((item) => ({
          ...item,
          recordId: undefined,
          delay: undefined,
        }))
    // Backfill server from subscription YAML when hop was added without meta.
    return base.map((item) =>
      item.server
        ? item
        : {
            ...item,
            server: nodeMetaMap.get(item.name)?.server,
          },
    )
  }, [candidates, nodeMetaMap, proxyChain, proxyView])

  const chainGeo = useServersGeoip(currentProxyChain.map((item) => item.server))

  const isConnected = useMemo(() => {
    if (!proxyView || currentProxyChain.length < 2) {
      return false
    }

    const lastNode = currentProxyChain[currentProxyChain.length - 1]

    if (mode === 'global') {
      return proxyView.global?.now === lastNode.name
    }

    if (!selectedGroup) {
      return false
    }

    const proxyChainGroup = proxyView.groups.find(
      (group) => group.name === selectedGroup,
    )

    return proxyChainGroup?.now === lastNode.name
  }, [proxyView, currentProxyChain, mode, selectedGroup])

  const disconnectChain = useCallback(async () => {
    await updateProxyChainConfigInRuntime(null)

    const targetGroup =
      mode === 'global'
        ? 'GLOBAL'
        : selectedGroup || localStorage.getItem('proxy-chain-group')

    if (targetGroup) {
      try {
        await selectNodeForGroup(targetGroup, 'DIRECT')
        recordSelection(targetGroup, 'DIRECT')
      } catch {
        if (currentProxyChain.length >= 1) {
          try {
            await selectNodeForGroup(targetGroup, currentProxyChain[0].name)
            recordSelection(targetGroup, currentProxyChain[0].name)
          } catch {
            // ignore
          }
        }
      }
    }

    localStorage.removeItem('proxy-chain-group')
    localStorage.removeItem('proxy-chain-exit-node')
    localStorage.removeItem('proxy-chain-items')

    await patchVergeConfig({
      proxy_chain_nodes: [],
      proxy_chain_group: null,
    })

    await closeAllConnections()
    await refreshProxy()
    onUpdateChain([])
  }, [
    currentProxyChain,
    mode,
    onUpdateChain,
    recordSelection,
    refreshProxy,
    selectedGroup,
  ])

  // 监听链的变化，但排除从配置加载的情况
  const chainLengthRef = useRef(currentProxyChain.length)
  const chainConfigHydratedRef = useRef<string | null>(null)
  useEffect(() => {
    // 只有当链长度发生变化且不是初始加载时，才标记为未保存
    if (
      chainLengthRef.current !== currentProxyChain.length &&
      chainLengthRef.current !== 0
    ) {
      markUnsavedChanges()
    }
    chainLengthRef.current = currentProxyChain.length
  }, [currentProxyChain.length, markUnsavedChanges])

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id) return

      const oldIndex = currentProxyChain.findIndex(
        (item) => item.id === active.id,
      )
      const newIndex = currentProxyChain.findIndex(
        (item) => item.id === over.id,
      )
      if (oldIndex === -1 || newIndex === -1) return

      onUpdateChain(arrayMove(currentProxyChain, oldIndex, newIndex))
      markUnsavedChanges()
    },
    [currentProxyChain, onUpdateChain, markUnsavedChanges],
  )

  const handleRemoveProxy = useCallback(
    (id: string) => {
      const newChain = currentProxyChain.filter((item) => item.id !== id)
      onUpdateChain(newChain)
      markUnsavedChanges()
    },
    [currentProxyChain, onUpdateChain, markUnsavedChanges],
  )

  const handleAddFromPicker = useCallback(
    (item: ProxyChainItem) => {
      if (
        currentProxyChain.some(
          (existing) =>
            existing.name === item.name ||
            (item.recordId !== undefined &&
              existing.recordId === item.recordId),
        )
      ) {
        return
      }
      onUpdateChain([...currentProxyChain, item])
      markUnsavedChanges()
    },
    [currentProxyChain, onUpdateChain, markUnsavedChanges],
  )

  const handleConnect = useCallback(async () => {
    if (isConnected) {
      setIsConnecting(true)
      try {
        await disconnectChain()
      } catch (error) {
        console.error('Failed to disconnect from proxy chain:', error)
        alert(t('proxies.page.chain.disconnectFailed'))
      } finally {
        setIsConnecting(false)
      }
      return
    }

    if (mode === 'global' && proxyView?.global === null) {
      alert(t('proxies.page.chain.connectFailed'))
      return
    }

    if (
      currentProxyChain.length < 2 ||
      currentProxyChain.some(
        (node) => node.recordId === undefined && node.definition === undefined,
      )
    ) {
      alert(t('proxies.page.chain.minimumNodes'))
      return
    }

    setIsConnecting(true)
    try {
      // 第一步：保存链式代理配置
      // Prefer runtime names for nodes already present after multi-sub merge;
      // only inject full definitions for nodes still missing from runtime.
      const chainProxies = currentProxyChain.map((node) =>
        node.recordId !== undefined
          ? node.name
          : (node.definition ?? node.name),
      )
      debugLog('Saving chain config:', chainProxies)
      const chainGroup =
        mode === 'global' ? 'GLOBAL' : (selectedGroup ?? undefined)
      await updateProxyChainConfigInRuntime(chainProxies, chainGroup)
      // L1: 持久化链式代理配置到 verge，配置重建时自动恢复
      await patchVergeConfig({
        proxy_chain_nodes: chainProxies,
        proxy_chain_group: chainGroup ?? null,
      })
      debugLog('Chain configuration saved successfully')

      // 第二步：连接到代理链的最后一个节点
      const lastNode = currentProxyChain[currentProxyChain.length - 1]
      debugLog(`Connecting to proxy chain, last node: ${lastNode.name}`)

      // 根据模式确定使用的代理组名称
      if (mode !== 'global' && !selectedGroup) {
        throw new Error('规则模式下必须选择代理组')
      }

      const targetGroup = mode === 'global' ? 'GLOBAL' : selectedGroup

      await selectNodeForGroup(targetGroup || 'GLOBAL', lastNode.name)
      // The chain moves the group like any other selection, so the profile has to learn about
      // it: what the profile holds is what gets re-applied the next time the core starts.
      recordSelection(targetGroup || 'GLOBAL', lastNode.name)
      localStorage.setItem('proxy-chain-group', targetGroup || 'GLOBAL')
      if (mode !== 'global' && targetGroup) {
        localStorage.setItem('proxy-chain-rule-group', targetGroup)
      }
      localStorage.setItem('proxy-chain-exit-node', lastNode.name)

      // 刷新代理信息以更新连接状态
      refreshProxy()
      debugLog('Successfully connected to proxy chain')
    } catch (error) {
      console.error('Failed to connect to proxy chain:', error)
      alert(t('proxies.page.chain.connectFailed'))
    } finally {
      setIsConnecting(false)
    }
  }, [
    currentProxyChain,
    disconnectChain,
    isConnected,
    t,
    refreshProxy,
    mode,
    proxyView,
    selectedGroup,
    recordSelection,
  ])

  useEffect(() => {
    if (!chainConfigData) {
      chainConfigHydratedRef.current = null
      return
    }
    if (chainConfigHydratedRef.current === chainConfigData) return
    try {
      // JSON is valid YAML, so one parser covers both persisted formats.
      const parsedConfig = yaml.load(chainConfigData) as ParsedChainConfig
      const chainItems = toChainItems(parsedConfig)

      if (chainItems.length > 0) {
        onUpdateChain(chainItems)
      }
      chainConfigHydratedRef.current = chainConfigData
    } catch (error) {
      console.error('Failed to process chain config data:', error)
    }
  }, [chainConfigData, onUpdateChain])

  return (
    <Paper
      elevation={1}
      sx={{
        height: '100%',
        p: 2,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          mb: 2,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <Typography variant="h6">{t('proxies.page.chain.header')}</Typography>
          <TooltipIcon
            title={chainWarning}
            icon={WarningRounded}
            color="warning"
            sx={{ p: 0.25 }}
          />
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <IconButton
            size="small"
            color="primary"
            onClick={() => setPickerOpen(true)}
            title={t('proxies.page.chain.picker.addButton')}
          >
            <Add fontSize="small" />
          </IconButton>
          {currentProxyChain.length > 0 && (
            <IconButton
              size="small"
              onClick={async () => {
                setIsConnecting(true)
                try {
                  await disconnectChain()
                } catch (error) {
                  console.error('Failed to clear proxy chain:', error)
                  alert(t('proxies.page.chain.disconnectFailed'))
                } finally {
                  setIsConnecting(false)
                }
              }}
              sx={{
                color: theme.palette.error.main,
                '&:hover': {
                  backgroundColor: theme.palette.error.light + '20',
                },
              }}
              title={t('proxies.page.actions.clearChainConfig')}
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          )}
          <Button
            size="small"
            variant="contained"
            startIcon={isConnected ? <LinkOff /> : <Link />}
            onClick={handleConnect}
            disabled={
              isConnecting ||
              (!isConnected &&
                (currentProxyChain.length < 2 ||
                  currentProxyChain.some(
                    (node) =>
                      node.recordId === undefined &&
                      node.definition === undefined,
                  ) ||
                  (mode === 'global' && proxyView?.global === null) ||
                  (mode !== 'global' && !selectedGroup)))
            }
            color={isConnected ? 'error' : 'success'}
            sx={{
              minWidth: 90,
            }}
            title={
              !isConnected && currentProxyChain.length < 2
                ? t('proxies.page.chain.minimumNodes')
                : undefined
            }
          >
            {isConnecting
              ? t('proxies.page.actions.connecting')
              : isConnected
                ? t('proxies.page.actions.disconnect')
                : t('proxies.page.actions.connect')}
          </Button>
        </Box>
      </Box>

      <Alert
        severity={currentProxyChain.length === 1 ? 'warning' : 'info'}
        sx={{ mb: 2 }}
      >
        {currentProxyChain.length === 1
          ? t('proxies.page.chain.minimumNodesHint')
          : t('proxies.page.chain.instruction')}
      </Alert>

      <Box sx={{ flex: 1, overflow: 'auto' }}>
        {currentProxyChain.length === 0 ? (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: theme.palette.text.secondary,
            }}
          >
            <Typography>{t('proxies.page.chain.empty')}</Typography>
          </Box>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={currentProxyChain.map((proxy) => proxy.id)}
              strategy={verticalListSortingStrategy}
            >
              <Box
                sx={{
                  borderRadius: 1,
                  minHeight: 60,
                  p: 1,
                }}
              >
                {currentProxyChain.map((proxy, index) => (
                  <Box key={proxy.id}>
                    <SortableItem
                      proxy={proxy}
                      geo={proxy.server ? chainGeo[proxy.server] : undefined}
                      index={index}
                      isFirst={index === 0}
                      isLast={
                        index === currentProxyChain.length - 1 &&
                        currentProxyChain.length > 1
                      }
                      onRemove={handleRemoveProxy}
                    />
                    {index < currentProxyChain.length - 1 && (
                      <Box
                        sx={{
                          display: 'flex',
                          justifyContent: 'center',
                          py: 0.25,
                        }}
                      >
                        <ArrowDownward
                          sx={{
                            fontSize: 20,
                            color: theme.palette.primary.main,
                            opacity: 0.7,
                          }}
                        />
                      </Box>
                    )}
                  </Box>
                ))}
              </Box>
            </SortableContext>
          </DndContext>
        )}
      </Box>
      <ProxyChainPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onAdd={handleAddFromPicker}
        existingNames={new Set(currentProxyChain.map((node) => node.name))}
      />
    </Paper>
  )
}
