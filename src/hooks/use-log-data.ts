import dayjs from 'dayjs'
import { useCallback, useEffect, useRef, useState } from 'react'
import { MihomoWebSocket, type LogLevel } from 'tauri-plugin-mihomo-api'

import { getClashLogs, type ClashLogItem } from '@/services/cmds'
import { recordHighSeverityAlert } from '@/services/log-alert-rate'
import { isHighSeverityLogType } from '@/services/log-alert-store'
import { setCacheData } from '@/services/query-client'

import { useClashLog } from './use-clash-log'
import { useMihomoWsSubscription } from './use-mihomo-ws-subscription'

export const LOG_PAGE_SIZE = 1000
const LOG_QUERY_SIZE = LOG_PAGE_SIZE + 1

export const getLogTotalPages = (total: number): number =>
  Math.max(1, Math.ceil(Math.max(0, total) / LOG_PAGE_SIZE))

export const canLoadNextLogPage = (
  page: number,
  total: number,
  fetchedEntryCount: number,
): boolean =>
  page + 1 < getLogTotalPages(total) && fetchedEntryCount > LOG_PAGE_SIZE
const MAX_LIVE_LOG_NUM = LOG_PAGE_SIZE
const MAX_HISTORY_LOG_NUM = 100_000
const FLUSH_DELAY_MS = 50
type LogType = ILogItem['type']

export type LogRangePreset = 'today' | 'last3'

interface UseLogDataOptions {
  level: LogFilter
  range: LogRangePreset
  order: LogOrder
}

interface LogCursor {
  ts: number
  id: number
}

const DEFAULT_LOG_TYPES: LogType[] = ['debug', 'info', 'warning', 'error']
const LOG_LEVEL_FILTERS: Record<LogLevel, LogType[]> = {
  DEBUG: DEFAULT_LOG_TYPES,
  INFO: ['info', 'warning', 'error'],
  WARNING: ['warning', 'error'],
  ERROR: ['error'],
  SILENT: [],
}

export const normalizeLogType = (type?: string): LogType | null => {
  const value = (type || '').trim().toLowerCase()
  if (value === 'warn' || value === 'warning') return 'warning'
  if (value === 'err' || value === 'error') return 'error'
  if (value === 'inf' || value === 'info') return 'info'
  if (value === 'debug') return 'debug'
  return null
}

const clampLogs = (logs: ILogItem[], max = MAX_LIVE_LOG_NUM): ILogItem[] =>
  logs.length > max ? logs.slice(-max) : logs

const appendLogs = (
  current: ILogItem[] | undefined,
  incoming: ILogItem[],
): ILogItem[] => {
  const base = current ?? []
  const total = base.length + incoming.length
  if (total <= MAX_LIVE_LOG_NUM) return base.concat(incoming)
  const dropFromBase = total - MAX_LIVE_LOG_NUM
  if (dropFromBase >= base.length) {
    return incoming.slice(incoming.length - MAX_LIVE_LOG_NUM)
  }
  return base.slice(dropFromBase).concat(incoming)
}

const logIdentity = (log: ILogItem): string =>
  `${log.time ?? ''}|${log.type}|${log.payload}`

export const mergeInitialLogs = (
  current: ILogItem[] | undefined,
  history: ILogItem[],
): ILogItem[] => {
  if (!current || current.length === 0) {
    return clampLogs(history, MAX_HISTORY_LOG_NUM)
  }
  const seen = new Set(current.map(logIdentity))
  const missing = history.filter((log) => !seen.has(logIdentity(log)))
  return clampLogs([...missing, ...current], MAX_HISTORY_LOG_NUM)
}

const mapLogEntries = (logs: ClashLogItem[]): ILogItem[] =>
  logs.map((log) => ({
    time: dayjs(log.ts).format('MM-DD HH:mm:ss'),
    type: normalizeLogType(log.level) ?? log.level,
    payload: log.payload,
  }))

const queryLevel = (level: LogFilter): string | undefined => {
  if (level === 'all') return undefined
  if (level === 'warn') return 'warning'
  if (level === 'err') return 'error'
  return level
}

export const getLogRangeStart = (
  range: LogRangePreset,
  now = Date.now(),
): number =>
  dayjs(now)
    .startOf('day')
    .subtract(range === 'last3' ? 2 : 0, 'day')
    .valueOf()

export const useLogData = ({ level, range, order }: UseLogDataOptions) => {
  const [clashLog] = useClashLog()
  const [historyLogs, setHistoryLogs] = useState<ILogItem[]>([])
  const [page, setPage] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const [hasNextPage, setHasNextPage] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const totalPages = getLogTotalPages(totalCount)
  const streamPaused = clashLog.streamPaused === true
  const logLevel = clashLog.logLevel.toUpperCase() as LogLevel
  const allowedTypes = LOG_LEVEL_FILTERS[logLevel] ?? DEFAULT_LOG_TYPES
  const cursorsRef = useRef<Array<LogCursor | null>>([null])
  const totalPagesRef = useRef(1)
  const rangeEndRef = useRef(0)
  const requestIdRef = useRef(0)
  const loadingHistoryRef = useRef(false)
  const clearPendingRef = useRef<(() => void) | null>(null)

  const { response, subscriptionCacheKey } = useMihomoWsSubscription<
    ILogItem[]
  >({
    storageKey: 'mihomo_logs_date',
    buildSubscriptKey: (date) =>
      !streamPaused && logLevel !== 'SILENT'
        ? `getClashLog-${logLevel}-${date}`
        : null,
    fallbackData: [],
    connect: () => MihomoWebSocket.connect_logs(logLevel),
    setupHandlers: ({ next, scheduleReconnect, isMounted }) => {
      let flushTimer: ReturnType<typeof setTimeout> | null = null
      const buffer: ILogItem[] = []

      const clearFlushTimer = () => {
        if (flushTimer) {
          clearTimeout(flushTimer)
          flushTimer = null
        }
      }

      const clearPending = () => {
        buffer.splice(0, buffer.length)
        clearFlushTimer()
      }
      clearPendingRef.current = clearPending

      const flush = () => {
        if (!buffer.length || !isMounted()) {
          flushTimer = null
          return
        }
        const pendingLogs = buffer.splice(0, buffer.length)
        next(null, (current) => appendLogs(current, pendingLogs))
        flushTimer = null
      }

      return {
        handleMessage: (data) => {
          if (data.startsWith('Websocket error')) {
            next(data)
            void scheduleReconnect()
            return
          }

          try {
            const parsed = JSON.parse(data) as ILogItem
            if (allowedTypes.length === 0) return
            const normalizedType = normalizeLogType(parsed.type)
            if (!normalizedType || !allowedTypes.includes(normalizedType)) {
              return
            }
            parsed.type = normalizedType
            if (isHighSeverityLogType(normalizedType)) {
              recordHighSeverityAlert()
            }
            parsed.time = dayjs().format('MM-DD HH:mm:ss')
            buffer.push(parsed)
            if (buffer.length > MAX_LIVE_LOG_NUM) {
              buffer.splice(0, buffer.length - MAX_LIVE_LOG_NUM)
            }
            if (!flushTimer) {
              flushTimer = setTimeout(flush, FLUSH_DELAY_MS)
            }
          } catch (error) {
            console.warn('[useLogData] failed to parse log message', error)
            next(error)
          }
        },
        cleanup: () => {
          clearPendingRef.current = null
          clearFlushTimer()
        },
      }
    },
  })

  const loadPage = useCallback(
    async (targetPage: number, reset = false) => {
      if (loadingHistoryRef.current && !reset) return
      if (targetPage < 0) return
      if (reset) {
        cursorsRef.current = [null]
        totalPagesRef.current = 1
        rangeEndRef.current = Date.now()
      }
      if (!reset && targetPage >= totalPagesRef.current) return
      const cursor = cursorsRef.current[targetPage]
      if (targetPage > 0 && !cursor) return

      const requestId = ++requestIdRef.current
      loadingHistoryRef.current = true
      setHistoryLoading(true)
      try {
        const result = await getClashLogs({
          from_ts: getLogRangeStart(range),
          to_ts: rangeEndRef.current,
          level: queryLevel(level),
          source: 'core',
          limit: LOG_QUERY_SIZE,
          cursor_ts: cursor?.ts,
          cursor_id: cursor?.id,
          descending: order === 'desc',
        })
        if (requestId !== requestIdRef.current) return

        const total = Math.max(0, result.total)
        const resultTotalPages = getLogTotalPages(total)
        const pageEntries = result.entries.slice(0, LOG_PAGE_SIZE)
        const hasMore = canLoadNextLogPage(
          targetPage,
          total,
          result.entries.length,
        )
        const nextCursorSource = pageEntries[pageEntries.length - 1]
        const cursors = cursorsRef.current.slice(0, targetPage + 1)
        if (hasMore && nextCursorSource) {
          cursors[targetPage + 1] = {
            ts: nextCursorSource.ts,
            id: nextCursorSource.id,
          }
        }
        cursorsRef.current = cursors
        totalPagesRef.current = resultTotalPages
        setHistoryLogs(mapLogEntries(pageEntries))
        setTotalCount(total)
        setHasNextPage(hasMore)
        setPage(Math.min(targetPage, resultTotalPages - 1))
      } catch (error) {
        if (requestId === requestIdRef.current) {
          console.warn('[useLogData] failed to query log page', error)
        }
      } finally {
        if (requestId === requestIdRef.current) {
          loadingHistoryRef.current = false
          setHistoryLoading(false)
        }
      }
    },
    [level, order, range],
  )

  useEffect(() => {
    void loadPage(0, true)
    return () => {
      requestIdRef.current += 1
      loadingHistoryRef.current = false
    }
  }, [loadPage])

  const previousPage = useCallback(() => {
    void loadPage(page - 1)
  }, [loadPage, page])

  const nextPage = useCallback(() => {
    if (hasNextPage) void loadPage(page + 1)
  }, [hasNextPage, loadPage, page])

  const refreshGetClashLog = useCallback(
    (clear = false) => {
      if (!clear) {
        void loadPage(0, true)
        return
      }
      requestIdRef.current += 1
      loadingHistoryRef.current = false
      cursorsRef.current = [null]
      totalPagesRef.current = 1
      clearPendingRef.current?.()
      setHistoryLogs([])
      setPage(0)
      setTotalCount(0)
      setHasNextPage(false)
      setHistoryLoading(false)
      if (subscriptionCacheKey) {
        setCacheData<ILogItem[]>([subscriptionCacheKey], [])
      }
    },
    [loadPage, subscriptionCacheKey],
  )

  return {
    response,
    historyLogs,
    page,
    totalCount,
    totalPages,
    hasNextPage,
    historyLoading,
    previousPage,
    nextPage,
    refreshGetClashLog,
  }
}
