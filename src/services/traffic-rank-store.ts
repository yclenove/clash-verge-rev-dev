/**
 * Realtime + multi-day historical traffic ranking (process / host).
 *
 * Practical best approach inside Clash Verge (no kernel driver):
 * 1. Ingest every Mihomo /connections snapshot
 * 2. Account bytes by per-connection delta → process/host buckets
 * 3. Keep an in-memory ledger for the realtime view
 * 4. Persist historical process/host details in SQLite via saveConnections
 *
 * Also requires mihomo `find-process-mode: always` so process names appear.
 */

import { formatConnectionChains } from '@/components/connection/connection-row-view'
import {
  hostGroupKey,
  processGroupKey,
  resolveHostName,
  resolveProcessName,
  UNKNOWN_HOST_KEY,
  UNKNOWN_PROCESS_KEY,
} from '@/utils/connection-identity'

export type TrafficRankMode = 'process' | 'host'
export type TrafficRankRangePreset =
  | 'today'
  | 'last3'
  | 'last7'
  | 'last30'
  | 'all'

export interface TrafficRankBucket {
  key: string
  name: string
  subtitle: string
  chains: string
  upload: number
  download: number
  connectionIds: number
  lastSeen: number
}

interface ConnTrack {
  upload: number
  download: number
  processKey: string
  hostKey: string
  processName: string
  hostName: string
  chains: string
  processSubtitle: string
  hostSubtitle: string
  day: string
}

interface DayLedger {
  process: Record<string, TrafficRankBucket>
  host: Record<string, TrafficRankBucket>
  uploadTotal: number
  downloadTotal: number
}

const MAX_DAY_KEEP = 30
/** Cap per-day buckets so host-mode ledgers cannot grow without bound. */
const MAX_BUCKETS_PER_BAG = 512

const listeners = new Set<() => void>()
const days = new Map<string, DayLedger>()
const connTracks = new Map<string, ConnTrack>()

let revision = 0
/** Wall clock when this JS runtime first started ingesting (not persisted). */
let monitorAttachedAt = 0

if (typeof window !== 'undefined') {
  try {
    window.localStorage.removeItem('verge-traffic-rank-v1')
    window.localStorage.removeItem('verge-traffic-rank-v2')
  } catch {
    // Storage can be unavailable in private or restricted webviews.
  }
}

const emptyLedger = (): DayLedger => ({
  process: {},
  host: {},
  uploadTotal: 0,
  downloadTotal: 0,
})

export const trafficDayKey = (ts = Date.now()) => {
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${y}-${m}-${day}`
}

const parseDayKey = (key: string) => {
  const [y, m, d] = key.split('-').map((x) => Number(x))
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d)
}

const listRecentDayKeys = (count: number, end = trafficDayKey()) => {
  const endDate = parseDayKey(end) || new Date()
  const keys: string[] = []
  for (let i = 0; i < count; i++) {
    const dt = new Date(endDate)
    dt.setDate(endDate.getDate() - i)
    keys.push(trafficDayKey(dt.getTime()))
  }
  return keys
}

const ensureDay = (key: string): DayLedger => {
  let ledger = days.get(key)
  if (!ledger) {
    ledger = emptyLedger()
    days.set(key, ledger)
  }
  return ledger
}

const pruneOldDays = () => {
  if (days.size <= MAX_DAY_KEEP) return
  const keys = Array.from(days.keys()).sort()
  while (keys.length > MAX_DAY_KEEP) {
    const old = keys.shift()
    if (old) days.delete(old)
  }
}

const pruneBucketBag = (bag: Record<string, TrafficRankBucket>) => {
  const keys = Object.keys(bag)
  if (keys.length <= MAX_BUCKETS_PER_BAG) return
  const sorted = keys
    .map((key) => bag[key])
    .sort((a, b) => a.lastSeen - b.lastSeen)
  const dropCount = keys.length - MAX_BUCKETS_PER_BAG
  for (let i = 0; i < dropCount; i++) {
    delete bag[sorted[i].key]
  }
}

const pruneLedgerBuckets = (ledger: DayLedger) => {
  pruneBucketBag(ledger.process)
  pruneBucketBag(ledger.host)
}

const bump = () => {
  pruneOldDays()
  revision += 1
  listeners.forEach((l) => l())
}

const touchBucket = (
  bag: Record<string, TrafficRankBucket>,
  key: string,
  name: string,
  subtitle: string,
  chains: string,
  now: number,
): TrafficRankBucket => {
  const existing = bag[key]
  if (existing) {
    if (
      name &&
      existing.name !== name &&
      key !== UNKNOWN_PROCESS_KEY &&
      key !== UNKNOWN_HOST_KEY
    ) {
      existing.name = name
    }
    if (subtitle) existing.subtitle = subtitle
    if (chains) existing.chains = chains
    existing.lastSeen = now
    return existing
  }
  const created: TrafficRankBucket = {
    key,
    name,
    subtitle,
    chains,
    upload: 0,
    download: 0,
    connectionIds: 0,
    lastSeen: now,
  }
  bag[key] = created
  return created
}

const addDeltaToBag = (
  bag: Record<string, TrafficRankBucket>,
  key: string,
  name: string,
  subtitle: string,
  chains: string,
  upDelta: number,
  downDelta: number,
  now: number,
  isNewConn: boolean,
) => {
  if (upDelta <= 0 && downDelta <= 0 && !isNewConn) return false
  const bucket = touchBucket(bag, key, name, subtitle, chains, now)
  if (upDelta > 0) bucket.upload += upDelta
  if (downDelta > 0) bucket.download += downDelta
  if (isNewConn) bucket.connectionIds += 1
  bucket.lastSeen = now
  return true
}

/** Ingest active connections from one Mihomo snapshot (call on every WS message). */
export const ingestConnectionSnapshot = (connections: IConnectionsItem[]) => {
  const now = Date.now()
  if (!monitorAttachedAt) monitorAttachedAt = now

  const today = trafficDayKey(now)
  const ledger = ensureDay(today)
  const seen = new Set<string>()
  let changed = false

  const parseStart = (conn: IConnectionsItem) => {
    const raw = (conn as { start?: string }).start
    if (!raw) return 0
    const ts = Date.parse(raw)
    return Number.isFinite(ts) ? ts : 0
  }

  for (let i = 0; i < connections.length; i++) {
    const conn = connections[i]
    if (!conn?.id) continue
    seen.add(conn.id)

    const meta = conn.metadata || ({} as IConnectionsItem['metadata'])
    const processName = resolveProcessName(meta.process, meta.processPath)
    const hostName = resolveHostName(meta)
    const pKey = processGroupKey(meta.process, meta.processPath)
    const hKey = hostGroupKey(meta)
    const chains = formatConnectionChains(conn.chains || [])
    const upload = conn.upload ?? 0
    const download = conn.download ?? 0
    const displayProcess = processName || ''
    const displayHost = hostName || ''

    const prev = connTracks.get(conn.id)
    if (!prev) {
      // New id in this runtime:
      // - If the connection started after we attached, credit current totals
      //   (covers short-lived single-snapshot flows).
      // - Otherwise only arm a baseline so app restarts do not double-count.
      const startedAt = parseStart(conn)
      const isFreshConnection =
        startedAt >= monitorAttachedAt - 1_000 ||
        (startedAt === 0 && upload + download === 0)

      connTracks.set(conn.id, {
        upload,
        download,
        processKey: pKey,
        hostKey: hKey,
        processName: displayProcess,
        hostName: displayHost,
        chains,
        processSubtitle: displayHost,
        hostSubtitle: displayProcess,
        day: today,
      })

      const creditUp = isFreshConnection ? upload : 0
      const creditDown = isFreshConnection ? download : 0
      changed =
        addDeltaToBag(
          ledger.process,
          pKey,
          displayProcess,
          displayHost,
          chains,
          creditUp,
          creditDown,
          now,
          true,
        ) || changed
      changed =
        addDeltaToBag(
          ledger.host,
          hKey,
          displayHost,
          displayProcess,
          chains,
          creditUp,
          creditDown,
          now,
          true,
        ) || changed
      if (creditUp > 0) ledger.uploadTotal += creditUp
      if (creditDown > 0) ledger.downloadTotal += creditDown
      continue
    }

    const nextProcessName = displayProcess || prev.processName
    const nextHostName = displayHost || prev.hostName
    const nextPKey = displayProcess ? pKey : prev.processKey
    const nextHKey = displayHost ? hKey : prev.hostKey
    const nextChains = chains || prev.chains
    const upDelta = Math.max(0, upload - prev.upload)
    const downDelta = Math.max(0, download - prev.download)

    // Day rollover mid-connection: attribute further deltas to the new day
    const targetDay = today
    const targetLedger = ensureDay(targetDay)

    if (upDelta > 0 || downDelta > 0) {
      changed =
        addDeltaToBag(
          targetLedger.process,
          nextPKey,
          nextProcessName,
          nextHostName || prev.processSubtitle,
          nextChains,
          upDelta,
          downDelta,
          now,
          false,
        ) || changed
      changed =
        addDeltaToBag(
          targetLedger.host,
          nextHKey,
          nextHostName,
          nextProcessName || prev.hostSubtitle,
          nextChains,
          upDelta,
          downDelta,
          now,
          false,
        ) || changed
      if (upDelta > 0) targetLedger.uploadTotal += upDelta
      if (downDelta > 0) targetLedger.downloadTotal += downDelta
    } else if (
      nextProcessName !== prev.processName ||
      nextHostName !== prev.hostName ||
      nextPKey !== prev.processKey ||
      nextHKey !== prev.hostKey ||
      nextChains !== prev.chains
    ) {
      // Identity enrichment without byte changes — refresh labels.
      touchBucket(
        targetLedger.process,
        nextPKey,
        nextProcessName,
        nextHostName || prev.processSubtitle,
        nextChains,
        now,
      )
      touchBucket(
        targetLedger.host,
        nextHKey,
        nextHostName,
        nextProcessName || prev.hostSubtitle,
        nextChains,
        now,
      )
      changed = true
    }

    connTracks.set(conn.id, {
      upload,
      download,
      processKey: nextPKey,
      hostKey: nextHKey,
      processName: nextProcessName,
      hostName: nextHostName,
      chains: nextChains,
      processSubtitle: nextHostName || prev.processSubtitle,
      hostSubtitle: nextProcessName || prev.hostSubtitle,
      day: targetDay,
    })
  }

  for (const id of Array.from(connTracks.keys())) {
    if (!seen.has(id)) connTracks.delete(id)
  }

  if (changed) {
    for (const dayLedger of days.values()) {
      pruneLedgerBuckets(dayLedger)
    }
    bump()
  }
}

const mergeBags = (bags: Record<string, TrafficRankBucket>[]) => {
  const out = new Map<string, TrafficRankBucket>()
  for (const bag of bags) {
    for (const bucket of Object.values(bag)) {
      if (!bucket?.key) continue
      const existing = out.get(bucket.key)
      if (!existing) {
        out.set(bucket.key, { ...bucket })
        continue
      }
      existing.upload += bucket.upload || 0
      existing.download += bucket.download || 0
      existing.connectionIds += bucket.connectionIds || 0
      if ((bucket.lastSeen || 0) > (existing.lastSeen || 0)) {
        existing.lastSeen = bucket.lastSeen
        if (bucket.name) existing.name = bucket.name
        if (bucket.subtitle) existing.subtitle = bucket.subtitle
        if (bucket.chains) existing.chains = bucket.chains
      }
    }
  }
  return Array.from(out.values()).sort(
    (a, b) => b.upload + b.download - (a.upload + a.download),
  )
}

export const resolveRangeDayKeys = (
  preset: TrafficRankRangePreset,
  customStart?: string,
  customEnd?: string,
): string[] => {
  if (customStart && customEnd) {
    const start = parseDayKey(customStart)
    const end = parseDayKey(customEnd)
    if (!start || !end) return [trafficDayKey()]
    const from = start <= end ? start : end
    const to = start <= end ? end : start
    const keys: string[] = []
    const cursor = new Date(from)
    while (cursor <= to) {
      keys.push(trafficDayKey(cursor.getTime()))
      cursor.setDate(cursor.getDate() + 1)
      if (keys.length > 366) break
    }
    return keys
  }

  switch (preset) {
    case 'today':
      return listRecentDayKeys(1)
    case 'last3':
      return listRecentDayKeys(3)
    case 'last7':
      return listRecentDayKeys(7)
    case 'last30':
      return listRecentDayKeys(30)
    case 'all':
      return Array.from(days.keys()).sort().reverse()
    default:
      return listRecentDayKeys(1)
  }
}

export const queryHistoricalRank = (
  mode: TrafficRankMode,
  preset: TrafficRankRangePreset,
  customStart?: string,
  customEnd?: string,
) => {
  const keys = resolveRangeDayKeys(preset, customStart, customEnd)
  const ledgers = keys.map((k) => days.get(k)).filter(Boolean) as DayLedger[]
  const bags = ledgers.map((l) => (mode === 'process' ? l.process : l.host))
  const rows = mergeBags(bags)
  const uploadTotal = ledgers.reduce((s, l) => s + (l.uploadTotal || 0), 0)
  const downloadTotal = ledgers.reduce((s, l) => s + (l.downloadTotal || 0), 0)
  // fallback totals from rows if ledger totals missing (migrated data)
  const rowUp = rows.reduce((s, r) => s + r.upload, 0)
  const rowDown = rows.reduce((s, r) => s + r.download, 0)
  return {
    rows,
    uploadTotal: uploadTotal || rowUp,
    downloadTotal: downloadTotal || rowDown,
    dayKeys: keys,
    revision,
  }
}

export const getTrafficRankRevision = () => revision

export const subscribeTrafficRank = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const clearTrafficRankStore = (onlyToday = false) => {
  if (onlyToday) {
    days.delete(trafficDayKey())
  } else {
    days.clear()
  }
  connTracks.clear()
  // Re-baseline active connections so clearing history does not re-credit
  // their lifetime totals on the next snapshot.
  monitorAttachedAt = Date.now()
  bump()
}

export const buildActiveSpeedMap = (
  connections: IConnectionsItem[],
  mode: TrafficRankMode,
) => {
  const map = new Map<
    string,
    {
      uploadSpeed: number
      downloadSpeed: number
      activeConnections: number
      items: IConnectionsItem[]
    }
  >()

  for (const conn of connections) {
    const meta = conn.metadata || ({} as IConnectionsItem['metadata'])
    const key =
      mode === 'process'
        ? processGroupKey(meta.process, meta.processPath)
        : hostGroupKey(meta)
    const existing = map.get(key)
    const uploadSpeed = conn.curUpload ?? 0
    const downloadSpeed = conn.curDownload ?? 0
    if (existing) {
      existing.uploadSpeed += uploadSpeed
      existing.downloadSpeed += downloadSpeed
      existing.activeConnections += 1
      existing.items.push(conn)
    } else {
      map.set(key, {
        uploadSpeed,
        downloadSpeed,
        activeConnections: 1,
        items: [conn],
      })
    }
  }
  return map
}
