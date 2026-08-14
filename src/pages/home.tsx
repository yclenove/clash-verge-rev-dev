import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
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
  ArrowDownwardRounded,
  ArrowUpwardRounded,
  DragIndicatorRounded,
  HelpOutlineRounded,
  HistoryEduOutlined,
  RestartAltRounded,
  SettingsEthernetRounded,
  SettingsOutlined,
} from '@mui/icons-material'
import {
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  IconButton,
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
import { useClash } from '@/hooks/use-clash'
import { useDisplayedMixedPort } from '@/hooks/use-displayed-mixed-port'
import { useSystemProxyState } from '@/hooks/use-system-proxy-state'
import { useVerge } from '@/hooks/use-verge'
import { entry_lightweight_mode, openWebUrl } from '@/services/cmds'
import { showNotice } from '@/services/notice-service'
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

const serializeCardFlags = (cards: HomeCardsSettings) =>
  Object.keys(cards)
    .sort()
    .map((key) => `${key}:${cards[key] ? 1 : 0}`)
    .join('|')

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

// 可排序的区块设置行：拖动手柄排序 + 复选框开关 + 上移/下移按钮
interface SortableCardRowProps {
  id: string
  label: string
  checked: boolean
  isFirst: boolean
  isLast: boolean
  onToggle: () => void
  onMoveUp: () => void
  onMoveDown: () => void
}

const SortableCardRow = ({
  id,
  label,
  checked,
  isFirst,
  isLast,
  onToggle,
  onMoveUp,
  onMoveDown,
}: SortableCardRowProps) => {
  const { t } = useTranslation()
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })

  return (
    <Box
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        px: 1,
        py: 0.5,
        mb: 0.75,
        borderRadius: 1.5,
        border: '1px solid transparent',
        transition: 'background-color 0.2s, border-color 0.2s, box-shadow 0.2s',
        '&:hover': {
          bgcolor: 'action.hover',
          borderColor: 'divider',
          '& .drag-handle': { color: 'primary.main' },
        },
        ...(isDragging
          ? {
              opacity: 0.92,
              zIndex: 1,
              bgcolor: 'action.selected',
              borderColor: 'primary.main',
              boxShadow: (theme) =>
                `0 4px 16px ${alpha(theme.palette.primary.main, 0.25)}`,
            }
          : {}),
      }}
    >
      <Box
        component="span"
        className="drag-handle"
        {...attributes}
        {...listeners}
        sx={{
          display: 'flex',
          alignItems: 'center',
          color: 'text.disabled',
          cursor: 'grab',
          transition: 'color 0.2s',
          '&:active': { cursor: 'grabbing' },
        }}
      >
        <DragIndicatorRounded fontSize="small" />
      </Box>
      <Checkbox
        size="small"
        checked={checked}
        onChange={onToggle}
        sx={{ p: 0.5 }}
      />
      <Typography
        sx={{
          flex: 1,
          fontSize: 14,
          userSelect: 'none',
          opacity: checked ? 1 : 0.55,
          transition: 'opacity 0.2s',
        }}
      >
        {label}
      </Typography>
      <Tooltip title={t('home.page.settings.tooltips.moveUp')}>
        <span>
          <IconButton size="small" onClick={onMoveUp} disabled={isFirst}>
            <ArrowUpwardRounded sx={{ fontSize: 16 }} />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title={t('home.page.settings.tooltips.moveDown')}>
        <span>
          <IconButton size="small" onClick={onMoveDown} disabled={isLast}>
            <ArrowDownwardRounded sx={{ fontSize: 16 }} />
          </IconButton>
        </span>
      </Tooltip>
    </Box>
  )
}

// 首页设置对话框组件接口
interface HomeSettingsDialogProps {
  onClose: () => void
  homeCards: HomeCardsSettings
  homeCardsOrder: string[]
}

// 首页设置对话框组件
const HomeSettingsDialog = ({
  onClose,
  homeCards,
  homeCardsOrder,
}: HomeSettingsDialogProps) => {
  const { t } = useTranslation()
  const [cards, setCards] = useState<HomeCardsSettings>(homeCards)
  const [order, setOrder] = useState<string[]>(homeCardsOrder)
  const { patchVerge } = useVerge()

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  const handleToggle = (key: string) => {
    setCards((prev: HomeCardsSettings) => ({
      ...prev,
      [key]: !prev[key],
    }))
  }

  const moveCard = (index: number, target: number) => {
    setOrder((prev) => arrayMove(prev, index, target))
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setOrder((prev) => {
      const oldIndex = prev.indexOf(String(active.id))
      const newIndex = prev.indexOf(String(over.id))
      if (oldIndex === -1 || newIndex === -1) return prev
      return arrayMove(prev, oldIndex, newIndex)
    })
  }

  const isDefaultOrder = order.every(
    (key, index) => key === DEFAULT_HOME_CARD_ORDER[index],
  )

  const handleSave = async () => {
    const cleanedCards: HomeCardsSettings = { ...DEFAULT_HOME_CARDS }
    for (const key of DEFAULT_HOME_CARD_ORDER) {
      cleanedCards[key] = Boolean(cards[key])
    }
    const cleanedOrder = resolveCardOrder(order)
    try {
      await patchVerge({
        home_cards: cleanedCards,
        home_cards_order: cleanedOrder,
      })
      onClose()
    } catch (error) {
      showNotice.error(error)
    }
  }

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t('home.page.settings.title')}</DialogTitle>
      <DialogContent>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: 'block', mb: 1.5 }}
        >
          {t('home.page.settings.orderHint')}
        </Typography>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={order} strategy={verticalListSortingStrategy}>
            {order.map((key, index) => {
              const meta = HOME_CARD_META.find((card) => card.key === key)
              if (!meta) return null
              return (
                <SortableCardRow
                  key={key}
                  id={key}
                  label={t(meta.labelKey)}
                  checked={cards[key] || false}
                  isFirst={index === 0}
                  isLast={index === order.length - 1}
                  onToggle={() => handleToggle(key)}
                  onMoveUp={() => moveCard(index, index - 1)}
                  onMoveDown={() => moveCard(index, index + 1)}
                />
              )
            })}
          </SortableContext>
        </DndContext>
        <Button
          size="small"
          startIcon={<RestartAltRounded />}
          onClick={() => setOrder([...DEFAULT_HOME_CARD_ORDER])}
          disabled={isDefaultOrder}
          sx={{ mt: 0.5 }}
        >
          {t('home.page.settings.restoreOrder')}
        </Button>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('shared.actions.cancel')}</Button>
        <Button onClick={handleSave} color="primary">
          {t('shared.actions.save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

const HomePage = () => {
  const { t } = useTranslation()
  const { verge, patchVerge } = useVerge()
  const { mutateClash } = useClash()
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
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [systemProxyBusy, setSystemProxyBusy] = useState(false)
  const dnsRef = useRef<DialogRef>(null)
  const portRef = useRef<DialogRef>(null)
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

  const toGithubDoc = useLockFn(() => {
    return openWebUrl('https://clash-verge-rev.github.io/index.html')
  })

  const openSettings = useCallback(() => {
    setSettingsOpen(true)
  }, [])

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
          <Tooltip title={t('home.page.tooltips.lightweightMode')} arrow>
            <IconButton
              onClick={async () => await entry_lightweight_mode()}
              size="small"
              color="inherit"
            >
              <HistoryEduOutlined />
            </IconButton>
          </Tooltip>
          <Tooltip title={t('home.page.tooltips.manual')} arrow>
            <IconButton onClick={toGithubDoc} size="small" color="inherit">
              <HelpOutlineRounded />
            </IconButton>
          </Tooltip>
          <Tooltip title={t('home.page.tooltips.settings')} arrow>
            <IconButton onClick={openSettings} size="small" color="inherit">
              <SettingsOutlined />
            </IconButton>
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

      {settingsOpen && (
        <HomeSettingsDialog
          key={`${serializeCardFlags(homeCards)}|${homeCardsOrder.join(',')}`}
          onClose={() => setSettingsOpen(false)}
          homeCards={homeCards}
          homeCardsOrder={homeCardsOrder}
        />
      )}
    </BasePage>
  )
}

export default HomePage
