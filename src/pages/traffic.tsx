import {
  ArrowDownwardRounded,
  ArrowUpwardRounded,
  ClearRounded,
  CloudDownloadRounded,
  CloudUploadRounded,
  DeleteOutlineRounded,
  ExpandMoreRounded,
  InsightsRounded,
  LinkRounded,
  MemoryRounded,
  PauseRounded,
  PlayArrowRounded,
  SearchRounded,
  ShowChartRounded,
} from '@mui/icons-material'
import {
  Box,
  Button,
  ButtonGroup,
  Chip,
  Collapse,
  IconButton,
  InputAdornment,
  LinearProgress,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
  alpha,
  useTheme,
} from '@mui/material'
import dayjs from 'dayjs'
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { useTranslation } from 'react-i18next'

import { BasePage } from '@/components/base'
import {
  formatConnectionChains,
  formatConnectionTraffic,
  getConnectionDestination,
  getConnectionProcess,
  getConnectionRule,
  getConnectionSource,
  getConnectionStartTime,
  getConnectionTypeLabel,
} from '@/components/connection/connection-row-view'
import {
  EnhancedCanvasTrafficGraph,
  type EnhancedCanvasTrafficGraphRef,
} from '@/components/home/enhanced-canvas-traffic-graph'
import { TrafficErrorBoundary } from '@/components/shared/traffic-error-boundary'
import {
  ensureBackgroundConnectionIngest,
  flushConnectionHistory,
  useConnectionData,
} from '@/hooks/use-connection-data'
import { useMemoryData } from '@/hooks/use-memory-data'
import { useTrafficData } from '@/hooks/use-traffic-data'
import { useVisibility } from '@/hooks/use-visibility'
import {
  clearTrafficHistory,
  getTrafficRank,
  getTrafficTotals,
  type TrafficBucket,
  type TrafficTotals,
} from '@/services/cmds'
import {
  buildActiveSpeedMap,
  clearTrafficRankStore,
  getTrafficRankRevision,
  queryHistoricalRank,
  subscribeTrafficRank,
  type TrafficRankRangePreset,
} from '@/services/traffic-rank-store'
import {
  hostGroupKey,
  processGroupKey,
  resolveHostName,
  resolveProcessName,
  UNKNOWN_HOST_KEY,
  UNKNOWN_PROCESS_KEY,
} from '@/utils/connection-identity'
import parseTraffic from '@/utils/parse-traffic'

// ---- 流量排行聚合 ----------------------------------------------------------

type GroupMode = 'process' | 'host' | 'connection'
type RankView = 'realtime' | 'history'

const PAGE_SIZE = 50
const MAX_DETAIL_CONNECTIONS = 50
const HISTORY_REFRESH_MS = 15_000
const EMPTY_TRAFFIC_TOTALS: TrafficTotals = {
  today_upload: 0,
  today_download: 0,
  total_upload: 0,
  total_download: 0,
}

let tickingNow = Date.now()
let tickingTimer: number | null = null
const tickingListeners = new Set<() => void>()

const subscribeTickingNow = (onStoreChange: () => void) => {
  tickingListeners.add(onStoreChange)
  if (!tickingTimer) {
    tickingNow = Date.now()
    tickingTimer = window.setInterval(() => {
      tickingNow = Date.now()
      tickingListeners.forEach((listener) => listener())
    }, 1000)
  }
  return () => {
    tickingListeners.delete(onStoreChange)
    if (tickingListeners.size === 0 && tickingTimer) {
      window.clearInterval(tickingTimer)
      tickingTimer = null
    }
  }
}

const getTickingNow = () => tickingNow

const useTickingNow = () =>
  useSyncExternalStore(subscribeTickingNow, getTickingNow, getTickingNow)

// 表格列网格模板：排名 | 目标 | 代理链 | 上传 | 下载 | 展开箭头
// 小屏隐藏代理链列
const GRID_TEMPLATE = {
  xs: '32px minmax(0,1fr) 88px 88px 32px',
  sm: '32px minmax(0,2fr) minmax(0,1.5fr) 88px 88px 32px',
} as const

interface ConsumerRow {
  key: string
  name: string
  subtitle: string
  detailRows?: ConsumerDetailRow[]
  chains: string
  upload: number
  download: number
  uploadSpeed: number
  downloadSpeed: number
  connections: number
  items: IConnectionsItem[]
}

interface ConsumerDetailRow {
  key: string
  name: string
  upload: number
  download: number
  connections: number
}

const connectionHost = (conn: IConnectionsItem) =>
  resolveHostName(conn.metadata || {})

const connectionProcess = (conn: IConnectionsItem) =>
  resolveProcessName(conn.metadata?.process, conn.metadata?.processPath)

const displayProcessName = (name: string, unknownProcess: string) => {
  if (!name || name === UNKNOWN_PROCESS_KEY) return unknownProcess
  return name
}

const displayHostName = (name: string, unknownHost: string) => {
  if (!name || name === UNKNOWN_HOST_KEY) return unknownHost
  return name
}

const formatDuration = (ms: number) => {
  const safe = Number.isFinite(ms) && ms > 0 ? ms : 0
  const totalSec = Math.floor(safe / 1000)
  const hours = Math.floor(totalSec / 3600)
  const minutes = Math.floor((totalSec % 3600) / 60)
  const seconds = totalSec % 60
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

const buildConsumers = (
  connections: IConnectionsItem[],
  mode: GroupMode,
  unknownProcess: string,
  unknownHost: string,
): ConsumerRow[] => {
  const map = new Map<string, ConsumerRow>()

  for (const conn of connections) {
    const host = connectionHost(conn)
    const process = connectionProcess(conn)
    const chains = formatConnectionChains(conn.chains || [])
    const upload = conn.upload ?? 0
    const download = conn.download ?? 0
    const uploadSpeed = conn.curUpload ?? 0
    const downloadSpeed = conn.curDownload ?? 0

    let key: string
    let name: string
    let subtitle: string

    if (mode === 'process') {
      key = processGroupKey(conn.metadata?.process, conn.metadata?.processPath)
      name = displayProcessName(process, unknownProcess)
      subtitle = displayHostName(host, unknownHost)
    } else if (mode === 'host') {
      key = hostGroupKey(conn.metadata || {})
      name = displayHostName(host, unknownHost)
      subtitle = displayProcessName(process, unknownProcess)
    } else {
      key = `conn:${conn.id}`
      name = host
        ? `${host}:${conn.metadata?.destinationPort || ''}`
        : unknownHost
      subtitle = displayProcessName(process, unknownProcess)
    }

    const existing = map.get(key)
    if (existing) {
      existing.upload += upload
      existing.download += download
      existing.uploadSpeed += uploadSpeed
      existing.downloadSpeed += downloadSpeed
      existing.connections += 1
      existing.items.push(conn)
      if (chains && (!existing.chains || existing.chains === '-')) {
        existing.chains = chains
      }
    } else {
      map.set(key, {
        key,
        name,
        subtitle,
        chains,
        upload,
        download,
        uploadSpeed,
        downloadSpeed,
        connections: 1,
        items: [conn],
      })
    }
  }

  return Array.from(map.values()).sort(
    (a, b) => b.upload + b.download - (a.upload + a.download),
  )
}

/** Merge multi-day ledger rows with live speeds from active connections. */
const buildRankRowsFromStore = (
  mode: 'process' | 'host',
  rangePreset: TrafficRankRangePreset,
  activeConnections: IConnectionsItem[],
  unknownProcess: string,
  unknownHost: string,
): { rows: ConsumerRow[]; uploadTotal: number; downloadTotal: number } => {
  const historical = queryHistoricalRank(mode, rangePreset)
  const speedMap = buildActiveSpeedMap(activeConnections, mode)
  const used = new Set<string>()
  const rows: ConsumerRow[] = []

  for (const bucket of historical.rows) {
    used.add(bucket.key)
    const live = speedMap.get(bucket.key)
    const name =
      mode === 'process'
        ? displayProcessName(bucket.name, unknownProcess)
        : displayHostName(bucket.name, unknownHost)
    const subtitle =
      mode === 'process'
        ? displayHostName(bucket.subtitle, unknownHost)
        : displayProcessName(bucket.subtitle, unknownProcess)

    rows.push({
      key: bucket.key,
      name,
      subtitle,
      chains: bucket.chains || '',
      upload: bucket.upload || 0,
      download: bucket.download || 0,
      uploadSpeed: live?.uploadSpeed || 0,
      downloadSpeed: live?.downloadSpeed || 0,
      connections: live?.activeConnections || bucket.connectionIds || 0,
      items: live?.items || [],
    })
  }

  // Include brand-new active groups that have not yet landed in the ledger.
  for (const [key, live] of speedMap.entries()) {
    if (used.has(key)) continue
    const sample = live.items[0]
    const process = sample ? connectionProcess(sample) : ''
    const host = sample ? connectionHost(sample) : ''
    const chains = sample ? formatConnectionChains(sample.chains || []) : ''
    rows.push({
      key,
      name:
        mode === 'process'
          ? displayProcessName(process, unknownProcess)
          : displayHostName(host, unknownHost),
      subtitle:
        mode === 'process'
          ? displayHostName(host, unknownHost)
          : displayProcessName(process, unknownProcess),
      chains,
      upload: live.items.reduce((s, c) => s + (c.upload || 0), 0),
      download: live.items.reduce((s, c) => s + (c.download || 0), 0),
      uploadSpeed: live.uploadSpeed,
      downloadSpeed: live.downloadSpeed,
      connections: live.activeConnections,
      items: live.items,
    })
  }

  rows.sort((a, b) => b.upload + b.download - (a.upload + a.download))
  return {
    rows,
    uploadTotal: historical.uploadTotal,
    downloadTotal: historical.downloadTotal,
  }
}

const buildRankRowsFromSqlite = (
  buckets: TrafficBucket[],
  mode: 'process' | 'host',
  activeConnections: IConnectionsItem[],
  unknownProcess: string,
  unknownHost: string,
): { rows: ConsumerRow[]; uploadTotal: number; downloadTotal: number } => {
  const rows = new Map<string, ConsumerRow>()
  const details = new Map<string, Map<string, ConsumerDetailRow>>()
  const speedMap = buildActiveSpeedMap(activeConnections, mode)
  let uploadTotal = 0
  let downloadTotal = 0

  for (const bucket of buckets) {
    const process = resolveProcessName(bucket.process)
    const host = bucket.host || bucket.ip
    const key =
      mode === 'process'
        ? processGroupKey(process)
        : hostGroupKey({ host: bucket.host, destinationIP: bucket.ip })
    const live = speedMap.get(key)
    const existing = rows.get(key)
    uploadTotal += bucket.upload
    downloadTotal += bucket.download

    if (existing) {
      existing.upload += bucket.upload
      existing.download += bucket.download
      existing.connections += bucket.connection_count
      if (!existing.chains && bucket.proxy) existing.chains = bucket.proxy
    } else {
      rows.set(key, {
        key,
        name:
          mode === 'process'
            ? displayProcessName(process, unknownProcess)
            : displayHostName(host, unknownHost),
        subtitle:
          mode === 'process'
            ? displayHostName(host, unknownHost)
            : displayProcessName(process, unknownProcess),
        chains: bucket.proxy,
        upload: bucket.upload,
        download: bucket.download,
        uploadSpeed: live?.uploadSpeed || 0,
        downloadSpeed: live?.downloadSpeed || 0,
        connections: bucket.connection_count,
        items: live?.items || [],
      })
    }

    if (mode === 'process') {
      const processDetails = details.get(key) ?? new Map()
      const detailKey = `${bucket.host}|${bucket.ip}`
      const detail = processDetails.get(detailKey)
      if (detail) {
        detail.upload += bucket.upload
        detail.download += bucket.download
        detail.connections += bucket.connection_count
      } else {
        processDetails.set(detailKey, {
          key: detailKey,
          name: bucket.host
            ? bucket.ip
              ? `${bucket.host} (${bucket.ip})`
              : bucket.host
            : displayHostName(bucket.ip, unknownHost),
          upload: bucket.upload,
          download: bucket.download,
          connections: bucket.connection_count,
        })
      }
      details.set(key, processDetails)
    }
  }

  const result = Array.from(rows.values())
  for (const row of result) {
    const detailRows = Array.from(details.get(row.key)?.values() ?? []).sort(
      (a, b) => b.upload + b.download - (a.upload + a.download),
    )
    if (detailRows.length > 0) {
      row.detailRows = detailRows.slice(0, 10)
      row.subtitle = detailRows[0].name
    }
  }
  result.sort((a, b) => b.upload + b.download - (a.upload + a.download))
  return { rows: result, uploadTotal, downloadTotal }
}

// ---- 大数字实时速度 --------------------------------------------------------

const BigSpeed = memo(
  ({
    icon,
    label,
    value,
    unit,
    color,
  }: {
    icon: React.ReactNode
    label: string
    value: string
    unit: string
    color: string
  }) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
      <Box
        sx={{
          width: 44,
          height: 44,
          borderRadius: '12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color,
          bgcolor: alpha(color, 0.12),
        }}
      >
        {icon}
      </Box>
      <Box>
        <Typography
          variant="caption"
          sx={{ color: 'text.secondary', fontWeight: 600, lineHeight: 1.2 }}
        >
          {label}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5 }}>
          <Typography
            sx={{
              fontSize: 26,
              fontWeight: 800,
              lineHeight: 1.1,
              color,
              fontVariantNumeric: 'tabular-nums',
              letterSpacing: -0.5,
            }}
          >
            {value}
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {unit}
          </Typography>
        </Box>
      </Box>
    </Box>
  ),
)
BigSpeed.displayName = 'BigSpeed'

// ---- 统计卡片 --------------------------------------------------------------

const StatCard = memo(
  ({
    icon,
    title,
    value,
    unit,
    color,
  }: {
    icon: React.ReactNode
    title: string
    value: string | number
    unit: string
    color: string
  }) => (
    <Paper
      elevation={0}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.25,
        borderRadius: 2,
        px: 1.75,
        py: 1.5,
        bgcolor: alpha(color, 0.05),
        border: `1px solid ${alpha(color, 0.15)}`,
        transition: 'all 0.2s ease-in-out',
        '&:hover': {
          bgcolor: alpha(color, 0.1),
          border: `1px solid ${alpha(color, 0.3)}`,
          transform: 'translateY(-1px)',
        },
      }}
    >
      <Box
        sx={{
          width: 36,
          height: 36,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color,
          bgcolor: alpha(color, 0.12),
          flexShrink: 0,
        }}
      >
        {icon}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="caption" color="text.secondary" noWrap>
          {title}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5 }}>
          <Typography
            sx={{
              fontWeight: 700,
              fontSize: 17,
              lineHeight: 1.2,
              fontVariantNumeric: 'tabular-nums',
            }}
            noWrap
          >
            {value}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {unit}
          </Typography>
        </Box>
      </Box>
    </Paper>
  ),
)
StatCard.displayName = 'StatCard'
// ---- 展开详情：字段单元 ----------------------------------------------------

const DetailField = memo(
  ({
    label,
    value,
    mono,
  }: {
    label: string
    value: string
    mono?: boolean
  }) => (
    <Box sx={{ minWidth: 0 }}>
      <Typography
        variant="caption"
        sx={{ color: 'text.disabled', fontWeight: 600, display: 'block' }}
      >
        {label}
      </Typography>
      <Typography
        variant="body2"
        sx={{
          fontFamily: mono ? 'monospace' : undefined,
          fontSize: 12.5,
          wordBreak: 'break-all',
          color: 'text.primary',
        }}
      >
        {value || '-'}
      </Typography>
    </Box>
  ),
)
DetailField.displayName = 'DetailField'

// ---- 展开详情：单连接 ------------------------------------------------------

const SingleConnectionDetail = ({ conn }: { conn: IConnectionsItem }) => {
  const { t } = useTranslation()
  const now = useTickingNow()
  const start = getConnectionStartTime(conn)
  const duration = start > 0 ? formatDuration(now - start) : '-'
  const startTimeText =
    start > 0 ? dayjs(start).format('YYYY-MM-DD HH:mm:ss') : '-'

  return (
    <Box
      sx={{
        display: 'grid',
        gap: 1.5,
        gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)' },
      }}
    >
      <DetailField
        label={t('traffic.page.consumers.detail.chains')}
        value={formatConnectionChains(conn.chains || [])}
      />
      <DetailField
        label={t('traffic.page.consumers.detail.source')}
        value={getConnectionSource(conn)}
        mono
      />
      <DetailField
        label={t('traffic.page.consumers.detail.destination')}
        value={getConnectionDestination(conn)}
        mono
      />
      <DetailField
        label={t('traffic.page.consumers.detail.process')}
        value={getConnectionProcess(conn)}
      />
      <DetailField
        label={t('traffic.page.consumers.detail.type')}
        value={getConnectionTypeLabel(conn)}
      />
      <DetailField
        label={t('traffic.page.consumers.detail.rule')}
        value={getConnectionRule(conn)}
      />
      <DetailField
        label={t('traffic.page.consumers.detail.startTime')}
        value={startTimeText}
        mono
      />
      <DetailField
        label={t('traffic.page.consumers.detail.duration')}
        value={duration}
        mono
      />
    </Box>
  )
}

// ---- 展开详情：聚合连接列表 ------------------------------------------------

const AggregateConnectionList = ({ items }: { items: IConnectionsItem[] }) => {
  const { t } = useTranslation()
  const now = useTickingNow()
  const shown = items.slice(0, MAX_DETAIL_CONNECTIONS)

  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography
        variant="caption"
        sx={{
          color: 'text.disabled',
          fontWeight: 600,
          display: 'block',
          mb: 0.75,
        }}
      >
        {t('traffic.page.consumers.detail.connections')} ({items.length})
        {items.length > MAX_DETAIL_CONNECTIONS
          ? ` · ${t('traffic.page.consumers.detail.truncated')}`
          : ''}
      </Typography>
      <Stack spacing={0.75}>
        {shown.map((conn) => {
          const start = getConnectionStartTime(conn)
          return (
            <Box
              key={conn.id}
              sx={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'baseline',
                gap: 1,
                px: 1.25,
                py: 0.75,
                borderRadius: 1,
                bgcolor: 'action.hover',
              }}
            >
              <Typography
                sx={{
                  fontSize: 12.5,
                  fontWeight: 600,
                  fontFamily: 'monospace',
                }}
              >
                {getConnectionDestination(conn)}
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ fontFamily: 'monospace' }}
              >
                {getConnectionSource(conn)}
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                noWrap
                sx={{ maxWidth: 240, fontFamily: 'monospace' }}
              >
                {formatConnectionChains(conn.chains || [])}
              </Typography>
              <Box sx={{ flex: 1 }} />
              <Typography
                variant="caption"
                sx={{ fontFamily: 'monospace', color: 'text.secondary' }}
              >
                {formatConnectionTraffic(conn.upload)} ↑ /{' '}
                {formatConnectionTraffic(conn.download)} ↓
              </Typography>
              <Typography
                variant="caption"
                sx={{ fontFamily: 'monospace', color: 'text.disabled' }}
              >
                {start > 0 ? formatDuration(now - start) : '-'}
              </Typography>
            </Box>
          )
        })}
      </Stack>
    </Box>
  )
}
// ---- 流量排行行 ------------------------------------------------------------

const ConsumerRowItem = memo(
  ({
    row,
    rank,
    maxTotal,
    showConnections,
    upColor,
    downColor,
    expanded,
    onToggle,
  }: {
    row: ConsumerRow
    rank: number
    maxTotal: number
    showConnections: boolean
    upColor: string
    downColor: string
    expanded: boolean
    onToggle: (key: string) => void
  }) => {
    const { t } = useTranslation()
    const [upText, upUnit] = parseTraffic(row.upload)
    const [downText, downUnit] = parseTraffic(row.download)
    const [upSpeedText, upSpeedUnit] = parseTraffic(row.uploadSpeed)
    const [downSpeedText, downSpeedUnit] = parseTraffic(row.downloadSpeed)
    const total = row.upload + row.download
    const percent = maxTotal > 0 ? Math.max(2, (total / maxTotal) * 100) : 2

    return (
      <Box>
        {/* 表格行 */}
        <Box
          onClick={() => onToggle(row.key)}
          sx={{
            px: 1.75,
            py: 1,
            display: 'grid',
            alignItems: 'center',
            gap: 1.5,
            gridTemplateColumns: GRID_TEMPLATE,
            cursor: 'pointer',
            transition: 'background-color 0.15s ease',
            '&:hover': { bgcolor: 'action.hover' },
          }}
        >
          {/* 排名 */}
          <Typography
            sx={{
              fontWeight: 800,
              fontSize: 14,
              color: rank <= 3 ? 'primary.main' : 'text.disabled',
              fontVariantNumeric: 'tabular-nums',
              textAlign: 'center',
            }}
          >
            {rank}
          </Typography>

          {/* 目标 / 进程 */}
          <Tooltip
            title={`${row.name}${row.subtitle ? ` · ${row.subtitle}` : ''}`}
            arrow
            disableInteractive
          >
            <Box sx={{ minWidth: 0 }}>
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 1,
                  minWidth: 0,
                }}
              >
                <Typography
                  noWrap
                  sx={{
                    fontWeight: 600,
                    fontSize: 14,
                    minWidth: 0,
                    flexShrink: 1,
                  }}
                >
                  {row.name}
                </Typography>
                <Typography
                  noWrap
                  variant="caption"
                  color="text.secondary"
                  sx={{ minWidth: 0, flexShrink: 1 }}
                >
                  {row.subtitle}
                </Typography>
              </Box>
              {showConnections && row.connections > 1 && (
                <Typography
                  variant="caption"
                  sx={{ color: 'text.disabled', fontSize: 11 }}
                >
                  {t('traffic.page.consumers.connectionCount', {
                    count: row.connections,
                  })}
                </Typography>
              )}
            </Box>
          </Tooltip>

          {/* 代理链（小屏隐藏） */}
          <Tooltip title={row.chains} arrow disableInteractive>
            <Typography
              noWrap
              variant="caption"
              sx={{
                color: 'text.secondary',
                display: { xs: 'none', sm: 'block' },
                fontFamily: 'monospace',
                fontSize: 11.5,
              }}
            >
              {row.chains}
            </Typography>
          </Tooltip>

          {/* 上传 */}
          <Box sx={{ textAlign: 'right', minWidth: 0 }}>
            <Typography
              sx={{
                fontSize: 13,
                fontWeight: 700,
                color: upColor,
                fontVariantNumeric: 'tabular-nums',
                lineHeight: 1.3,
              }}
            >
              {upSpeedText} {upSpeedUnit}/s
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {upText} {upUnit}
            </Typography>
          </Box>

          {/* 下载 */}
          <Box sx={{ textAlign: 'right', minWidth: 0 }}>
            <Typography
              sx={{
                fontSize: 13,
                fontWeight: 700,
                color: downColor,
                fontVariantNumeric: 'tabular-nums',
                lineHeight: 1.3,
              }}
            >
              {downSpeedText} {downSpeedUnit}/s
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {downText} {downUnit}
            </Typography>
          </Box>

          {/* 展开箭头 */}
          <ExpandMoreRounded
            sx={{
              fontSize: 18,
              color: 'text.disabled',
              justifySelf: 'center',
              transition: 'transform 0.2s ease',
              transform: expanded ? 'rotate(180deg)' : 'none',
            }}
          />
        </Box>

        {/* 占比进度条 */}
        <Box sx={{ px: 1.75, pb: 1 }}>
          <Box sx={{ ml: '44px' }}>
            <LinearProgress
              variant="determinate"
              value={percent}
              sx={{
                height: 3,
                borderRadius: 2,
                bgcolor: alpha(upColor, 0.1),
                '& .MuiLinearProgress-bar': {
                  bgcolor: upColor,
                  borderRadius: 2,
                  transition: 'transform 0.4s ease',
                },
              }}
            />
          </Box>
        </Box>

        {/* 展开详情 */}
        <Collapse in={expanded} timeout="auto" unmountOnExit>
          <Box sx={{ px: 2.5, pb: 1.75, ml: '44px', mr: 1.75 }}>
            {row.detailRows && row.detailRows.length > 0 && (
              <Box sx={{ mb: 1 }}>
                {row.detailRows.map((detail) => {
                  const [upText, upUnit] = parseTraffic(detail.upload)
                  const [downText, downUnit] = parseTraffic(detail.download)
                  return (
                    <Box
                      key={detail.key}
                      sx={{
                        display: 'grid',
                        gridTemplateColumns: 'minmax(0,1fr) 88px 88px',
                        gap: 1,
                        alignItems: 'center',
                        py: 0.5,
                      }}
                    >
                      <Typography
                        noWrap
                        variant="caption"
                        sx={{ fontWeight: 600 }}
                      >
                        {detail.name}
                      </Typography>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ textAlign: 'right' }}
                      >
                        {upText} {upUnit}
                      </Typography>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ textAlign: 'right' }}
                      >
                        {downText} {downUnit}
                      </Typography>
                    </Box>
                  )
                })}
              </Box>
            )}
            {row.items.length === 1 ? (
              <SingleConnectionDetail conn={row.items[0]} />
            ) : (
              <AggregateConnectionList items={row.items} />
            )}
          </Box>
        </Collapse>
      </Box>
    )
  },
)
ConsumerRowItem.displayName = 'ConsumerRowItem'
// ---- 页面 ------------------------------------------------------------------

const TrafficPage = () => {
  const { t } = useTranslation()
  const theme = useTheme()
  const pageVisible = useVisibility()
  const graphRef = useRef<EnhancedCanvasTrafficGraphRef>(null)

  const [groupMode, setGroupMode] = useState<GroupMode>('process')
  const [rankView, setRankView] = useState<RankView>('realtime')
  const [rangePreset, setRangePreset] =
    useState<TrafficRankRangePreset>('today')
  const [sqliteRankBuckets, setSqliteRankBuckets] = useState<TrafficBucket[]>(
    [],
  )
  const [trafficTotals, setTrafficTotals] =
    useState<TrafficTotals>(EMPTY_TRAFFIC_TOTALS)
  const [paused, setPaused] = useState(false)
  const [search, setSearch] = useState('')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [expandedKeys, setExpandedKeys] = useState(() => new Set<string>())

  const upColor = theme.palette.secondary.main
  const downColor = theme.palette.primary.main

  useEffect(() => {
    ensureBackgroundConnectionIngest()
  }, [])

  useEffect(() => {
    if (rankView !== 'history' || !pageVisible || paused) return
    let cancelled = false
    let loading = false
    const days =
      rangePreset === 'last3'
        ? 2
        : rangePreset === 'last7'
          ? 6
          : rangePreset === 'last30'
            ? 29
            : 0
    const fromTs =
      rangePreset === 'all'
        ? 0
        : dayjs().startOf('day').subtract(days, 'day').valueOf()
    const refreshRank = async () => {
      if (loading) return
      loading = true
      try {
        const buckets = await getTrafficRank(fromTs)
        if (!cancelled) setSqliteRankBuckets(buckets)
      } catch (error) {
        console.warn('[Traffic] sqlite rank fetch failed', error)
      } finally {
        loading = false
      }
    }
    void refreshRank()
    const timer = window.setInterval(refreshRank, HISTORY_REFRESH_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [pageVisible, paused, rangePreset, rankView])

  useEffect(() => {
    if (!pageVisible || paused) return
    let cancelled = false
    let loading = false
    const refreshTotals = async () => {
      if (loading) return
      loading = true
      try {
        const totals = await getTrafficTotals()
        if (!cancelled) setTrafficTotals(totals)
      } catch (error) {
        console.warn('[Traffic] sqlite totals fetch failed', error)
      } finally {
        loading = false
      }
    }
    void refreshTotals()
    const timer = window.setInterval(refreshTotals, 2_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [pageVisible, paused])

  // 暂停时停止 UI 订阅，画面冻结在最后一次快照；后台仍持续记账
  const dataEnabled = pageVisible && !paused

  const {
    response: { data: traffic },
  } = useTrafficData({ enabled: dataEnabled })
  const {
    response: { data: memory },
  } = useMemoryData({ enabled: dataEnabled })
  const {
    response: { data: connectionData },
  } = useConnectionData({ enabled: dataEnabled })

  const rankRevision = useSyncExternalStore(
    subscribeTrafficRank,
    getTrafficRankRevision,
    getTrafficRankRevision,
  )

  const activeConnections = useMemo(
    () => connectionData?.activeConnections ?? [],
    [connectionData?.activeConnections],
  )
  const closedConnections = useMemo(
    () => connectionData?.closedConnections ?? [],
    [connectionData?.closedConnections],
  )

  const parsed = useMemo(() => {
    const [up, upUnit] = parseTraffic(traffic?.up || 0)
    const [down, downUnit] = parseTraffic(traffic?.down || 0)
    const [todayUp, todayUpUnit] = parseTraffic(trafficTotals.today_upload)
    const [todayDown, todayDownUnit] = parseTraffic(
      trafficTotals.today_download,
    )
    const [upTotal, upTotalUnit] = parseTraffic(trafficTotals.total_upload)
    const [downTotal, downTotalUnit] = parseTraffic(
      trafficTotals.total_download,
    )
    const [inuse, inuseUnit] = parseTraffic(memory?.inuse || 0)
    return {
      up,
      upUnit,
      down,
      downUnit,
      todayUp,
      todayUpUnit,
      todayDown,
      todayDownUnit,
      upTotal,
      upTotalUnit,
      downTotal,
      downTotalUnit,
      inuse,
      inuseUnit,
    }
  }, [traffic, memory, trafficTotals])

  const unknownProcess = t('traffic.page.consumers.unknownProcess')
  const unknownHost = t('traffic.page.consumers.unknownHost')

  const rankBundle = useMemo(() => {
    // Keep dependency on rankRevision so store ingest re-renders the list.
    void rankRevision

    if (groupMode === 'connection') {
      // Per-connection view only makes sense for live sockets.
      const source =
        rankView === 'realtime'
          ? [...activeConnections, ...closedConnections]
          : activeConnections
      return {
        rows: buildConsumers(source, 'connection', unknownProcess, unknownHost),
        uploadTotal: 0,
        downloadTotal: 0,
      }
    }

    if (rankView === 'history') {
      return buildRankRowsFromSqlite(
        sqliteRankBuckets,
        groupMode,
        activeConnections,
        unknownProcess,
        unknownHost,
      )
    }

    // Realtime process/host: prefer today's cumulative ledger so short-lived
    // connections remain visible after they close, with live speeds overlaid.
    return buildRankRowsFromStore(
      groupMode,
      'today',
      activeConnections,
      unknownProcess,
      unknownHost,
    )
  }, [
    activeConnections,
    closedConnections,
    groupMode,
    rankRevision,
    rankView,
    sqliteRankBuckets,
    unknownHost,
    unknownProcess,
  ])

  // Freeze ranking snapshot while paused so the list does not jump.
  const frozenRankRef = useRef(rankBundle)
  if (!paused) {
    frozenRankRef.current = rankBundle
  }
  const stableRank = paused ? frozenRankRef.current : rankBundle
  const consumers = stableRank.rows

  const historyTotals = useMemo(() => {
    const [downText, downUnit] = parseTraffic(stableRank.downloadTotal || 0)
    const [upText, upUnit] = parseTraffic(stableRank.uploadTotal || 0)
    return { downText, downUnit, upText, upUnit }
  }, [stableRank.downloadTotal, stableRank.uploadTotal])

  const filteredConsumers = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return consumers
    return consumers.filter(
      (row) =>
        row.name.toLowerCase().includes(q) ||
        row.subtitle.toLowerCase().includes(q) ||
        row.chains.toLowerCase().includes(q),
    )
  }, [consumers, search])

  const visibleConsumers = useMemo(
    () => filteredConsumers.slice(0, visibleCount),
    [filteredConsumers, visibleCount],
  )

  const maxTotal = useMemo(
    () =>
      filteredConsumers.reduce(
        (max, row) => Math.max(max, row.upload + row.download),
        0,
      ),
    [filteredConsumers],
  )

  const handleGroupMode = (mode: GroupMode) => {
    setGroupMode(mode)
    setVisibleCount(PAGE_SIZE)
    setExpandedKeys(new Set())
  }

  const handleRankView = (view: RankView) => {
    setRankView(view)
    setVisibleCount(PAGE_SIZE)
    setExpandedKeys(new Set())
    if (view === 'history' && groupMode === 'connection') {
      setGroupMode('process')
    }
  }

  const handleRangePreset = (preset: TrafficRankRangePreset) => {
    setRangePreset(preset)
    setVisibleCount(PAGE_SIZE)
  }

  const handleSearch = (value: string) => {
    setSearch(value)
    setVisibleCount(PAGE_SIZE)
  }

  const handleClearHistory = async () => {
    const ok = window.confirm(t('traffic.page.consumers.clearHistoryConfirm'))
    if (!ok) return
    try {
      await flushConnectionHistory()
      await clearTrafficHistory()
      clearTrafficRankStore(false)
      setSqliteRankBuckets([])
      setTrafficTotals(EMPTY_TRAFFIC_TOTALS)
      setExpandedKeys(new Set())
      setVisibleCount(PAGE_SIZE)
    } catch (error) {
      console.warn('[Traffic] sqlite history clear failed', error)
    }
  }

  const handleToggle = useCallback((key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }, [])

  const shownCount = Math.min(visibleCount, filteredConsumers.length)
  const emptyLabel =
    rankView === 'history'
      ? t('traffic.page.consumers.emptyHistory')
      : t('traffic.page.consumers.empty')
  const subtitleLabel =
    rankView === 'history'
      ? t('traffic.page.consumers.subtitleHistory')
      : t('traffic.page.consumers.subtitle')

  return (
    <BasePage title={t('traffic.page.title')} contentStyle={{ padding: 2 }}>
      <TrafficErrorBoundary
        onError={(error, errorInfo) => {
          console.error('[TrafficPage] 组件错误:', error, errorInfo)
        }}
      >
        <Stack spacing={1.5}>
          {/* 实时速度总览 */}
          <Paper
            elevation={0}
            sx={{
              borderRadius: 2,
              px: 2.5,
              py: 2,
              display: 'flex',
              alignItems: 'center',
              gap: 3,
              flexWrap: 'wrap',
              background: `linear-gradient(120deg, ${alpha(downColor, 0.07)} 0%, ${alpha(upColor, 0.05)} 100%)`,
              border: `1px solid ${alpha(theme.palette.divider, 0.4)}`,
            }}
          >
            <BigSpeed
              icon={<ArrowDownwardRounded />}
              label={t('traffic.page.hero.download')}
              value={parsed.down}
              unit={`${parsed.downUnit}/s`}
              color={downColor}
            />
            <BigSpeed
              icon={<ArrowUpwardRounded />}
              label={t('traffic.page.hero.upload')}
              value={parsed.up}
              unit={`${parsed.upUnit}/s`}
              color={upColor}
            />
            <Box sx={{ flex: 1 }} />
            <BigSpeed
              icon={<LinkRounded />}
              label={t('traffic.page.hero.connections')}
              value={String(activeConnections.length)}
              unit=""
              color={theme.palette.success.main}
            />
            <BigSpeed
              icon={<MemoryRounded />}
              label={t('traffic.page.hero.memory')}
              value={parsed.inuse}
              unit={parsed.inuseUnit}
              color={theme.palette.error.main}
            />
          </Paper>

          {/* 实时流量曲线（点击图表切换样式，左上角按钮切换时间范围） */}
          <Paper
            elevation={0}
            sx={{
              height: 240,
              borderRadius: 2,
              overflow: 'hidden',
              cursor: 'pointer',
              border: `1px solid ${alpha(theme.palette.divider, 0.3)}`,
            }}
            onClick={() => graphRef.current?.toggleStyle()}
            title={t('traffic.page.graph.hint')}
          >
            <div style={{ height: '100%', position: 'relative' }}>
              <EnhancedCanvasTrafficGraph
                ref={graphRef}
                enabled={dataEnabled}
              />
            </div>
          </Paper>

          {/* 统计卡片 */}
          <Box
            sx={{
              display: 'grid',
              gap: 1.5,
              gridTemplateColumns: {
                xs: 'repeat(2, 1fr)',
                sm: 'repeat(3, 1fr)',
                md: 'repeat(6, 1fr)',
              },
            }}
          >
            <StatCard
              icon={<ArrowDownwardRounded fontSize="small" />}
              title={t('traffic.page.metrics.todayDownload')}
              value={parsed.todayDown}
              unit={parsed.todayDownUnit}
              color={downColor}
            />
            <StatCard
              icon={<ArrowUpwardRounded fontSize="small" />}
              title={t('traffic.page.metrics.todayUpload')}
              value={parsed.todayUp}
              unit={parsed.todayUpUnit}
              color={upColor}
            />
            <StatCard
              icon={<CloudDownloadRounded fontSize="small" />}
              title={t('traffic.page.metrics.downloadTotal')}
              value={parsed.downTotal}
              unit={parsed.downTotalUnit}
              color={downColor}
            />
            <StatCard
              icon={<CloudUploadRounded fontSize="small" />}
              title={t('traffic.page.metrics.uploadTotal')}
              value={parsed.upTotal}
              unit={parsed.upTotalUnit}
              color={upColor}
            />
            <StatCard
              icon={<MemoryRounded fontSize="small" />}
              title={t('traffic.page.metrics.memoryUsage')}
              value={parsed.inuse}
              unit={parsed.inuseUnit}
              color={theme.palette.error.main}
            />
            <StatCard
              icon={<LinkRounded fontSize="small" />}
              title={t('traffic.page.metrics.activeConnections')}
              value={activeConnections.length}
              unit=""
              color={theme.palette.success.main}
            />
          </Box>
          {/* 流量排行 */}
          <Paper
            elevation={0}
            sx={{
              borderRadius: 2,
              border: `1px solid ${alpha(theme.palette.divider, 0.3)}`,
              overflow: 'hidden',
            }}
          >
            {/* 工具栏：标题 + 实时/历史 + 搜索 + 暂停 + 分组 */}
            <Box
              sx={{
                px: 2,
                py: 1.25,
                display: 'flex',
                alignItems: 'center',
                gap: 1.25,
                flexWrap: 'wrap',
                borderBottom: 1,
                borderColor: 'divider',
              }}
            >
              <Box
                sx={{ display: 'flex', alignItems: 'center', gap: 1, mr: 0.5 }}
              >
                <InsightsRounded color="primary" sx={{ fontSize: 20 }} />
                <Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography
                      sx={{ fontWeight: 700, fontSize: 15, lineHeight: 1.2 }}
                    >
                      {t('traffic.page.consumers.title')}
                    </Typography>
                    {paused && (
                      <Chip
                        size="small"
                        color="warning"
                        label={t('traffic.page.consumers.paused')}
                        sx={{ height: 20, fontSize: 11 }}
                      />
                    )}
                  </Box>
                  <Typography variant="caption" color="text.secondary">
                    {subtitleLabel}
                  </Typography>
                </Box>
              </Box>

              <ButtonGroup size="small" variant="outlined">
                <Button
                  variant={rankView === 'realtime' ? 'contained' : 'outlined'}
                  onClick={() => handleRankView('realtime')}
                  sx={{ textTransform: 'none' }}
                >
                  {t('traffic.page.consumers.viewRealtime')}
                </Button>
                <Button
                  variant={rankView === 'history' ? 'contained' : 'outlined'}
                  onClick={() => handleRankView('history')}
                  sx={{ textTransform: 'none' }}
                >
                  {t('traffic.page.consumers.viewHistory')}
                </Button>
              </ButtonGroup>

              <TextField
                size="small"
                value={search}
                onChange={(e) => handleSearch(e.target.value)}
                placeholder={t('traffic.page.consumers.search')}
                sx={{
                  width: { xs: '100%', sm: 220 },
                  flexGrow: { xs: 1, sm: 0 },
                }}
                slotProps={{
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchRounded sx={{ fontSize: 18 }} color="disabled" />
                      </InputAdornment>
                    ),
                    endAdornment: search ? (
                      <InputAdornment position="end">
                        <IconButton
                          size="small"
                          onClick={() => handleSearch('')}
                          aria-label={t('traffic.page.consumers.search')}
                        >
                          <ClearRounded sx={{ fontSize: 16 }} />
                        </IconButton>
                      </InputAdornment>
                    ) : undefined,
                  },
                }}
              />

              <Tooltip
                title={
                  paused
                    ? t('traffic.page.consumers.resume')
                    : t('traffic.page.consumers.pause')
                }
                arrow
              >
                <IconButton
                  size="small"
                  onClick={() => setPaused((p) => !p)}
                  color={paused ? 'warning' : 'default'}
                >
                  {paused ? (
                    <PlayArrowRounded fontSize="small" />
                  ) : (
                    <PauseRounded fontSize="small" />
                  )}
                </IconButton>
              </Tooltip>

              {rankView === 'history' && (
                <Tooltip title={t('traffic.page.consumers.clearHistory')} arrow>
                  <IconButton
                    size="small"
                    onClick={handleClearHistory}
                    color="default"
                  >
                    <DeleteOutlineRounded fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}

              <ButtonGroup size="small" variant="outlined">
                <Button
                  variant={groupMode === 'process' ? 'contained' : 'outlined'}
                  onClick={() => handleGroupMode('process')}
                  sx={{ textTransform: 'none' }}
                >
                  {t('traffic.page.consumers.groupProcess')}
                </Button>
                <Button
                  variant={groupMode === 'host' ? 'contained' : 'outlined'}
                  onClick={() => handleGroupMode('host')}
                  sx={{ textTransform: 'none' }}
                >
                  {t('traffic.page.consumers.groupHost')}
                </Button>
                {rankView === 'realtime' && (
                  <Button
                    variant={
                      groupMode === 'connection' ? 'contained' : 'outlined'
                    }
                    onClick={() => handleGroupMode('connection')}
                    sx={{ textTransform: 'none' }}
                  >
                    {t('traffic.page.consumers.groupConnection')}
                  </Button>
                )}
              </ButtonGroup>
            </Box>

            {rankView === 'history' && (
              <Box
                sx={{
                  px: 2,
                  py: 1,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.5,
                  flexWrap: 'wrap',
                  borderBottom: 1,
                  borderColor: 'divider',
                  bgcolor: alpha(theme.palette.action.hover, 0.25),
                }}
              >
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {t('traffic.page.consumers.historyDownloadTotal')}:{' '}
                  <Box
                    component="span"
                    sx={{ color: downColor, fontWeight: 800 }}
                  >
                    {historyTotals.downText}
                    {historyTotals.downUnit}
                  </Box>
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {t('traffic.page.consumers.historyUploadTotal')}:{' '}
                  <Box
                    component="span"
                    sx={{ color: upColor, fontWeight: 800 }}
                  >
                    {historyTotals.upText}
                    {historyTotals.upUnit}
                  </Box>
                </Typography>
                <Box sx={{ flex: 1 }} />
                <ButtonGroup size="small" variant="outlined">
                  <Button
                    variant={rangePreset === 'today' ? 'contained' : 'outlined'}
                    onClick={() => handleRangePreset('today')}
                    sx={{ textTransform: 'none' }}
                  >
                    {t('traffic.page.consumers.rangeToday')}
                  </Button>
                  <Button
                    variant={rangePreset === 'last3' ? 'contained' : 'outlined'}
                    onClick={() => handleRangePreset('last3')}
                    sx={{ textTransform: 'none' }}
                  >
                    {t('traffic.page.consumers.rangeLast3')}
                  </Button>
                  <Button
                    variant={rangePreset === 'last7' ? 'contained' : 'outlined'}
                    onClick={() => handleRangePreset('last7')}
                    sx={{ textTransform: 'none' }}
                  >
                    {t('traffic.page.consumers.rangeLast7')}
                  </Button>
                  <Button
                    variant={
                      rangePreset === 'last30' ? 'contained' : 'outlined'
                    }
                    onClick={() => handleRangePreset('last30')}
                    sx={{ textTransform: 'none' }}
                  >
                    {t('traffic.page.consumers.rangeLast30')}
                  </Button>
                  <Button
                    variant={rangePreset === 'all' ? 'contained' : 'outlined'}
                    onClick={() => handleRangePreset('all')}
                    sx={{ textTransform: 'none' }}
                  >
                    {t('traffic.page.consumers.rangeAll')}
                  </Button>
                </ButtonGroup>
              </Box>
            )}

            {/* 列标题 */}
            <Box
              sx={{
                px: 1.75,
                py: 0.75,
                display: 'grid',
                alignItems: 'center',
                gap: 1.5,
                gridTemplateColumns: GRID_TEMPLATE,
                borderBottom: 1,
                borderColor: 'divider',
                bgcolor: alpha(theme.palette.action.hover, 0.3),
              }}
            >
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ fontWeight: 700, textAlign: 'center' }}
              >
                #
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ fontWeight: 700 }}
              >
                {t('traffic.page.consumers.columnTarget')}
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ fontWeight: 700, display: { xs: 'none', sm: 'block' } }}
              >
                {t('traffic.page.consumers.columnChain')}
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ fontWeight: 700, textAlign: 'right' }}
              >
                {t('traffic.page.consumers.columnUpload')}
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ fontWeight: 700, textAlign: 'right' }}
              >
                {t('traffic.page.consumers.columnDownload')}
              </Typography>
              <Box />
            </Box>

            {filteredConsumers.length === 0 ? (
              <Box sx={{ py: 5, textAlign: 'center' }}>
                <ShowChartRounded
                  sx={{ fontSize: 40, color: 'text.disabled', mb: 1 }}
                />
                <Typography variant="body2" color="text.secondary">
                  {search ? t('traffic.page.consumers.noMatch') : emptyLabel}
                </Typography>
              </Box>
            ) : (
              <Box sx={{ py: 0.5, maxHeight: 520, overflowY: 'auto' }}>
                {visibleConsumers.map((row, index) => (
                  <ConsumerRowItem
                    key={row.key}
                    row={row}
                    rank={index + 1}
                    maxTotal={maxTotal}
                    showConnections={groupMode !== 'connection'}
                    upColor={upColor}
                    downColor={downColor}
                    expanded={expandedKeys.has(row.key)}
                    onToggle={handleToggle}
                  />
                ))}
              </Box>
            )}

            {/* 底部：计数 + 加载更多 */}
            {filteredConsumers.length > 0 && (
              <Box
                sx={{
                  px: 2,
                  py: 1,
                  borderTop: 1,
                  borderColor: 'divider',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.5,
                }}
              >
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {t('traffic.page.consumers.showing', {
                    shown: shownCount,
                    total: filteredConsumers.length,
                  })}
                </Typography>
                <Box sx={{ flex: 1 }} />
                {filteredConsumers.length > visibleCount && (
                  <Button
                    size="small"
                    onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                  >
                    {t('traffic.page.consumers.loadMore')}
                  </Button>
                )}
              </Box>
            )}
          </Paper>
        </Stack>
      </TrafficErrorBoundary>
    </BasePage>
  )
}

export default TrafficPage
