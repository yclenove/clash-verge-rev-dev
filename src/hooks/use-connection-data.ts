import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { MihomoWebSocket } from 'tauri-plugin-mihomo-api'

import { saveConnections, type ConnectionEntry } from '@/services/cmds'
import { ingestConnectionSnapshot } from '@/services/traffic-rank-store'
import { resolveProcessName } from '@/utils/connection-identity'

const MAX_CLOSED_CONNS_NUM = 2000
const CONNECTION_UPDATE_THROTTLE_MS = 500
const CONNECTION_RECONNECT_DELAY_MS = 1_000
const CONNECTION_DB_FLUSH_MS = 1_000
const CONNECTION_DB_MAX_RETRY_MS = 30_000
const CONNECTION_DB_HEARTBEAT_MS = 5 * 60 * 1_000

type ConnectionMetadata = IConnectionsItem['metadata']
type ConnectionListener = () => void

const metadataValue = (value?: string) => value || ''

const initConnData: ConnectionMonitorData = {
  uploadTotal: 0,
  downloadTotal: 0,
  activeConnections: [],
  closedConnections: [],
}

interface ConnectionMonitorData {
  uploadTotal: number
  downloadTotal: number
  activeConnections: IConnectionsItem[]
  closedConnections: IConnectionsItem[]
}

interface ConnectionSummaryData {
  activeConnectionCount: number
}

const initConnSummaryData: ConnectionSummaryData = {
  activeConnectionCount: 0,
}

let connectionData: ConnectionMonitorData = initConnData
let connectionSummary: ConnectionSummaryData = initConnSummaryData
let connectionSocket: MihomoWebSocket | null = null
let connectionConnecting = false
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let flushTimer: ReturnType<typeof setTimeout> | null = null
let lastFlushAt = 0
let backgroundRankCollector = false
const lastConnectionSnapshot = new Map<string, ConnectionEntry>()
const lastConnectionPersistedAt = new Map<string, number>()
const pendingConnectionEntries = new Map<string, ConnectionEntry>()
let connectionDbFlushTimer: ReturnType<typeof setTimeout> | null = null
let connectionDbFlushChain: Promise<void> = Promise.resolve()
let connectionDbRetryMs = CONNECTION_DB_FLUSH_MS

const connectionListeners = new Set<ConnectionListener>()
const summaryListeners = new Set<ConnectionListener>()

const notifyConnectionListeners = () => {
  connectionListeners.forEach((listener) => listener())
}

const notifySummaryListeners = () => {
  summaryListeners.forEach((listener) => listener())
}

const hasConnectionSubscribers = () =>
  connectionListeners.size > 0 ||
  summaryListeners.size > 0 ||
  backgroundRankCollector

const sameMetadata = (left: ConnectionMetadata, right: ConnectionMetadata) =>
  metadataValue(left.network) === metadataValue(right.network) &&
  metadataValue(left.type) === metadataValue(right.type) &&
  metadataValue(left.host) === metadataValue(right.host) &&
  metadataValue(left.sourceIP) === metadataValue(right.sourceIP) &&
  metadataValue(left.sourcePort) === metadataValue(right.sourcePort) &&
  metadataValue(left.destinationPort) ===
    metadataValue(right.destinationPort) &&
  metadataValue(left.destinationIP) === metadataValue(right.destinationIP) &&
  metadataValue(left.remoteDestination) ===
    metadataValue(right.remoteDestination) &&
  metadataValue(left.process) === metadataValue(right.process) &&
  metadataValue(left.processPath) === metadataValue(right.processPath)

const normalizeMetadata = (
  metadata: ConnectionMetadata,
  previous?: ConnectionMetadata,
): ConnectionMetadata => {
  if (previous && sameMetadata(previous, metadata)) return previous

  // Keep process identity sticky: mihomo sometimes omits process on later ticks
  const process = metadata.process || previous?.process || ''
  const processPath = metadata.processPath || previous?.processPath || ''
  return {
    network: metadata.network || '',
    type: metadata.type || '',
    host: metadata.host || '',
    sourceIP: metadata.sourceIP || '',
    sourcePort: metadata.sourcePort || '',
    destinationPort: metadata.destinationPort || '',
    destinationIP: metadata.destinationIP || '',
    remoteDestination: metadata.remoteDestination || '',
    process,
    processPath,
  }
}

const sameChains = (left: string[], right: string[]) => {
  if (left.length !== right.length) return false
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return false
  }
  return true
}

const normalizeChains = (chains: string[], previous?: string[]) => {
  if (previous && sameChains(previous, chains)) return previous
  return chains.slice()
}

const normalizeConnection = (
  connection: IConnectionsItem,
  previous?: IConnectionsItem,
): IConnectionsItem => {
  const metadata = normalizeMetadata(connection.metadata, previous?.metadata)
  const chains = normalizeChains(connection.chains || [], previous?.chains)
  const upload = connection.upload ?? 0
  const download = connection.download ?? 0
  const curUpload = previous ? upload - previous.upload : 0
  const curDownload = previous ? download - previous.download : 0
  const rule = connection.rule || ''
  const rulePayload = connection.rulePayload || ''
  const start = connection.start || ''

  if (
    previous &&
    previous.metadata === metadata &&
    previous.chains === chains &&
    previous.upload === upload &&
    previous.download === download &&
    previous.curUpload === curUpload &&
    previous.curDownload === curDownload &&
    previous.rule === rule &&
    previous.rulePayload === rulePayload &&
    previous.start === start
  ) {
    return previous
  }

  return {
    id: connection.id,
    metadata,
    upload,
    download,
    start,
    chains,
    rule,
    rulePayload,
    curUpload,
    curDownload,
  }
}

const mergeConnectionSnapshot = (
  payload: IConnections,
  previous: ConnectionMonitorData = initConnData,
): ConnectionMonitorData => {
  const nextConnections = payload.connections ?? []
  const previousActive = previous.activeConnections ?? []
  const previousClosed = previous.closedConnections ?? []
  const previousActiveById = new Map<string, IConnectionsItem>()

  for (let i = 0; i < previousActive.length; i++) {
    const previousConnection = previousActive[i]
    previousActiveById.set(previousConnection.id, previousConnection)
  }

  const activeConnections: IConnectionsItem[] = []
  for (let i = 0; i < nextConnections.length; i++) {
    const connection = nextConnections[i]
    const previousConnection = previousActiveById.get(connection.id)
    if (previousConnection) previousActiveById.delete(connection.id)
    activeConnections.push(normalizeConnection(connection, previousConnection))
  }

  if (previousActiveById.size === 0) {
    return {
      uploadTotal: payload.uploadTotal ?? 0,
      downloadTotal: payload.downloadTotal ?? 0,
      activeConnections,
      closedConnections: previousClosed,
    }
  }

  const removedConnectionCount = previousActiveById.size
  const dropFromClosed = Math.max(
    0,
    previousClosed.length + removedConnectionCount - MAX_CLOSED_CONNS_NUM,
  )
  const closedConnections =
    dropFromClosed >= previousClosed.length
      ? []
      : previousClosed.slice(dropFromClosed)

  const keepFromRemoved = MAX_CLOSED_CONNS_NUM - closedConnections.length
  let skipRemoved = Math.max(0, removedConnectionCount - keepFromRemoved)

  for (let i = 0; i < previousActive.length; i++) {
    const connection = previousActive[i]
    if (!previousActiveById.has(connection.id)) continue
    if (skipRemoved > 0) {
      skipRemoved -= 1
      continue
    }
    closedConnections.push({
      ...connection,
      curUpload: 0,
      curDownload: 0,
    })
  }

  return {
    uploadTotal: payload.uploadTotal ?? 0,
    downloadTotal: payload.downloadTotal ?? 0,
    activeConnections,
    closedConnections,
  }
}

export const __testing__mergeConnectionSnapshot = mergeConnectionSnapshot

const mergeConnectionSummary = (
  payload: IConnections,
): ConnectionSummaryData => ({
  activeConnectionCount: payload.connections?.length ?? 0,
})

const parseConnectionStart = (conn: IConnectionsItem): number => {
  const raw = (conn as { start?: string }).start
  if (!raw) return Date.now()
  const ts = Date.parse(raw)
  return Number.isFinite(ts) ? ts : Date.now()
}

const sameConnectionEntry = (left: ConnectionEntry, right: ConnectionEntry) =>
  left.started_at === right.started_at &&
  left.closed_at === right.closed_at &&
  left.process === right.process &&
  left.host === right.host &&
  left.ip === right.ip &&
  left.port === right.port &&
  left.source_port === right.source_port &&
  left.destination_port === right.destination_port &&
  left.rule === right.rule &&
  left.proxy === right.proxy &&
  left.upload === right.upload &&
  left.download === right.download &&
  left.confidence === right.confidence

const connectionDayKey = (observedAt: number): string => {
  const date = new Date(observedAt)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return [year, month, day].join('-')
}

const connectionPendingKey = (entry: ConnectionEntry): string =>
  connectionDayKey(entry.observed_at) + '\u0000' + entry.connection_id

export const __testing__connectionPendingKey = connectionPendingKey

const flushConnectionDbOnce = async (throwOnError: boolean) => {
  connectionDbFlushTimer = null
  if (pendingConnectionEntries.size === 0) return
  const entries = Array.from(pendingConnectionEntries.values()).sort(
    (left, right) => left.observed_at - right.observed_at,
  )
  pendingConnectionEntries.clear()
  try {
    await saveConnections(entries)
    connectionDbRetryMs = CONNECTION_DB_FLUSH_MS
  } catch (error) {
    console.warn('[Connections] sqlite flush failed', error)
    for (const entry of entries) {
      const key = connectionPendingKey(entry)
      if (!pendingConnectionEntries.has(key)) {
        pendingConnectionEntries.set(key, entry)
      }
    }
    connectionDbRetryMs = Math.min(
      CONNECTION_DB_MAX_RETRY_MS,
      connectionDbRetryMs * 2,
    )
    scheduleConnectionDbFlush(connectionDbRetryMs)
    if (throwOnError) throw error
  }
}

const flushConnectionDb = (throwOnError = false): Promise<void> => {
  const operation = connectionDbFlushChain.then(() =>
    flushConnectionDbOnce(throwOnError),
  )
  connectionDbFlushChain = operation.catch(() => {})
  return operation
}

const scheduleConnectionDbFlush = (delay = CONNECTION_DB_FLUSH_MS) => {
  if (connectionDbFlushTimer) return
  connectionDbFlushTimer = setTimeout(() => {
    void flushConnectionDb()
  }, delay)
}

const applyConnectionPayload = (payload: IConnections) => {
  // Always update internal state + cumulative rank ledger on every message so
  // short-lived connections are not dropped by UI throttle.
  connectionSummary = mergeConnectionSummary(payload)
  // Keep connectionData fresh even without UI subscribers (background ingest /
  // first paint of the traffic page can reuse the latest snapshot).
  connectionData = mergeConnectionSnapshot(payload, connectionData)
  try {
    ingestConnectionSnapshot(payload.connections ?? [])
  } catch (err) {
    console.error('[Connections] traffic rank ingest failed', err)
  }

  const now = Date.now()
  const activeIds = new Set<string>()
  const entries: ConnectionEntry[] = []
  let hasClosedEntries = false
  for (const conn of payload.connections ?? []) {
    if (!conn?.id) continue
    activeIds.add(conn.id)
    const meta = conn.metadata || ({} as ConnectionMetadata)
    const previousEntry = lastConnectionSnapshot.get(conn.id)
    const upload = conn.upload ?? 0
    const download = conn.download ?? 0
    const entry: ConnectionEntry = {
      connection_id: conn.id,
      started_at: parseConnectionStart(conn),
      observed_at: now,
      closed_at: null,
      process:
        resolveProcessName(meta.process, meta.processPath) ||
        previousEntry?.process ||
        null,
      host: meta.host || previousEntry?.host || null,
      ip: meta.destinationIP || previousEntry?.ip || null,
      port: Number(meta.destinationPort) || previousEntry?.port || null,
      source_port:
        Number(meta.sourcePort) || previousEntry?.source_port || null,
      destination_port:
        Number(meta.destinationPort) || previousEntry?.destination_port || null,
      rule: (conn as { rule?: string }).rule || previousEntry?.rule || null,
      proxy:
        (conn.chains?.length ? conn.chains.join(' > ') : null) ||
        previousEntry?.proxy ||
        null,
      upload,
      download,
      confidence: 'high',
    }
    lastConnectionSnapshot.set(conn.id, entry)
    const lastPersistedAt = lastConnectionPersistedAt.get(conn.id) ?? 0
    if (
      !previousEntry ||
      !sameConnectionEntry(previousEntry, entry) ||
      now - lastPersistedAt >= CONNECTION_DB_HEARTBEAT_MS
    ) {
      entries.push(entry)
      lastConnectionPersistedAt.set(conn.id, now)
    }
  }
  for (const [id, entry] of lastConnectionSnapshot) {
    if (activeIds.has(id)) continue
    entries.push({ ...entry, observed_at: now, closed_at: now })
    hasClosedEntries = true
    lastConnectionSnapshot.delete(id)
    lastConnectionPersistedAt.delete(id)
  }
  if (entries.length > 0) {
    for (const entry of entries) {
      pendingConnectionEntries.set(connectionPendingKey(entry), entry)
    }
    if (hasClosedEntries) {
      if (connectionDbFlushTimer) {
        window.clearTimeout(connectionDbFlushTimer)
        connectionDbFlushTimer = null
      }
      void flushConnectionDb()
    } else {
      scheduleConnectionDbFlush()
    }
  }
}

const flushUiNotifications = () => {
  flushTimer = null
  lastFlushAt = Date.now()
  notifySummaryListeners()
  if (connectionListeners.size > 0) {
    notifyConnectionListeners()
  }
}

const scheduleUiNotify = () => {
  if (flushTimer) return
  const elapsed = Date.now() - lastFlushAt
  if (elapsed >= CONNECTION_UPDATE_THROTTLE_MS) {
    flushUiNotifications()
    return
  }
  flushTimer = window.setTimeout(
    flushUiNotifications,
    CONNECTION_UPDATE_THROTTLE_MS - elapsed,
  )
}

const enqueueConnectionMessage = (messageData: string) => {
  // Even without UI subscribers, keep ingesting for historical ranking.
  let payload: IConnections
  try {
    payload = JSON.parse(messageData) as IConnections
  } catch (err) {
    console.error('[Connections] Failed to parse websocket payload', err)
    return
  }

  applyConnectionPayload(payload)
  // Rank store already updated; throttle UI/summary notifications only.
  if (connectionListeners.size > 0 || summaryListeners.size > 0) {
    scheduleUiNotify()
  }
}

const clearReconnectTimer = () => {
  if (!reconnectTimer) return
  window.clearTimeout(reconnectTimer)
  reconnectTimer = null
}

const closeConnectionSocket = async () => {
  const socket = connectionSocket
  connectionSocket = null
  if (!socket) return

  try {
    await socket.close()
  } catch (err) {
    console.warn('Failed to close connection websocket', err)
  }
}

const scheduleReconnect = () => {
  if (!hasConnectionSubscribers()) return
  if (reconnectTimer) return
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null
    void connectConnectionSocket()
  }, CONNECTION_RECONNECT_DELAY_MS)
}

async function reconnectConnectionSocket() {
  if (!hasConnectionSubscribers()) return
  await closeConnectionSocket()
  scheduleReconnect()
}

async function connectConnectionSocket() {
  if (connectionSocket || connectionConnecting) return
  if (!hasConnectionSubscribers()) return

  clearReconnectTimer()
  connectionConnecting = true

  try {
    const socket = await MihomoWebSocket.connect_connections()
    if (!hasConnectionSubscribers()) {
      await socket.close()
      return
    }
    connectionSocket = socket
    socket.addListener((message) => {
      if (connectionSocket !== socket) return
      if (message.type !== 'Text') return
      if (message.data.startsWith('Websocket error')) {
        void reconnectConnectionSocket()
        return
      }

      enqueueConnectionMessage(message.data)
    })
  } catch {
    scheduleReconnect()
  } finally {
    connectionConnecting = false
  }
}

const startConnectionMonitor = () => {
  void connectConnectionSocket()
}

const stopConnectionMonitorIfIdle = () => {
  if (hasConnectionSubscribers()) return

  clearReconnectTimer()
  if (flushTimer) {
    window.clearTimeout(flushTimer)
    flushTimer = null
  }
  void closeConnectionSocket()
}

const getConnectionSnapshot = () => connectionData
const getConnectionSummarySnapshot = () => connectionSummary

const subscribeConnectionData = (listener: ConnectionListener) => {
  connectionListeners.add(listener)
  startConnectionMonitor()
  return () => {
    connectionListeners.delete(listener)
    stopConnectionMonitorIfIdle()
  }
}

const subscribeConnectionSummary = (listener: ConnectionListener) => {
  summaryListeners.add(listener)
  startConnectionMonitor()
  return () => {
    summaryListeners.delete(listener)
    stopConnectionMonitorIfIdle()
  }
}

const refreshConnectionData = () => {
  if (flushTimer) {
    window.clearTimeout(flushTimer)
    flushTimer = null
  }

  void reconnectConnectionSocket()
}

const clearClosedConnectionData = () => {
  if (connectionData.closedConnections.length === 0) return
  connectionData = {
    ...connectionData,
    closedConnections: [],
  }
  notifyConnectionListeners()
}

/** Keep /connections WS alive so historical rank can accumulate in background. */
export const ensureBackgroundConnectionIngest = () => {
  if (backgroundRankCollector) return
  backgroundRankCollector = true
  startConnectionMonitor()
}

export const flushConnectionHistory = async () => {
  if (connectionDbFlushTimer) {
    window.clearTimeout(connectionDbFlushTimer)
    connectionDbFlushTimer = null
  }
  await flushConnectionDb(true)
}

export const useConnectionData = (options?: { enabled?: boolean }) => {
  const enabled = options?.enabled ?? true
  const subscribe = useCallback(
    (listener: ConnectionListener) =>
      enabled ? subscribeConnectionData(listener) : () => {},
    [enabled],
  )
  const data = useSyncExternalStore(
    subscribe,
    getConnectionSnapshot,
    getConnectionSnapshot,
  )
  const response = useMemo(() => ({ data }), [data])
  const refreshGetClashConnection = useCallback(() => {
    refreshConnectionData()
  }, [])
  const clearClosedConnections = useCallback(() => {
    clearClosedConnectionData()
  }, [])

  return {
    response,
    refreshGetClashConnection,
    clearClosedConnections,
  }
}

export const useConnectionSummaryData = (options?: { enabled?: boolean }) => {
  const enabled = options?.enabled ?? true
  const subscribe = useCallback(
    (listener: ConnectionListener) =>
      enabled ? subscribeConnectionSummary(listener) : () => {},
    [enabled],
  )
  const data = useSyncExternalStore(
    subscribe,
    getConnectionSummarySnapshot,
    getConnectionSummarySnapshot,
  )
  const response = useMemo(() => ({ data }), [data])
  const refreshGetClashConnectionSummary = useCallback(() => {
    refreshConnectionData()
  }, [])

  return {
    response,
    refreshGetClashConnectionSummary,
  }
}
