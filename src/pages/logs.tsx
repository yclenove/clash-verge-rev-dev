import {
  ChevronLeftRounded,
  ChevronRightRounded,
  PauseCircleOutlineRounded,
  PlayCircleOutlineRounded,
  SwapVertRounded,
} from '@mui/icons-material'
import {
  Box,
  Button,
  CircularProgress,
  IconButton,
  Tab,
  Tabs,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  BaseEmpty,
  BasePage,
  BaseSearchBox,
  type SearchState,
  VirtualList,
  type VirtualListHandle,
} from '@/components/base'
import LogItem from '@/components/log/log-item'
import { useClashLog } from '@/hooks/use-clash-log'
import {
  LOG_PAGE_SIZE,
  type LogRangePreset,
  normalizeLogType,
  useLogData,
} from '@/hooks/use-log-data'
import { buildClashLogSearchText } from '@/utils/translate-clash-log'

const logIdentity = (log: ILogItem) =>
  `${log.time ?? ''}|${log.type}|${log.payload}`

const LogPage = () => {
  const { t, i18n } = useTranslation()
  const [clashLog, setClashLog] = useClashLog()
  const [rangePreset, setRangePreset] = useState<LogRangePreset>('today')
  const streamPaused = clashLog.streamPaused ?? false
  const streamActive = !streamPaused
  const logState = clashLog.logFilter
  const logOrder = clashLog.logOrder ?? 'desc'
  const isDescending = logOrder === 'desc'

  const [match, setMatch] = useState(() => (_: string) => true)
  const [searchState, setSearchState] = useState<SearchState>()
  const {
    response: { data: liveLogs },
    historyLogs,
    page,
    totalPages,
    hasNextPage,
    historyLoading,
    previousPage,
    nextPage,
    refreshGetClashLog,
  } = useLogData({
    level: logState,
    range: rangePreset,
    order: logOrder,
  })
  const searchActive = Boolean(searchState?.text.trim())

  const matchesLog = useCallback(
    (data: ILogItem): boolean => {
      const normalizedType = normalizeLogType(data.type)
      const matchesLevel =
        logState === 'all' ||
        (logState === 'warn'
          ? normalizedType === 'warning'
          : logState === 'err'
            ? normalizedType === 'error'
            : normalizedType === logState)
      if (!matchesLevel) return false
      if (!searchActive) return true
      return match(buildClashLogSearchText(data, { language: i18n.language }))
    },
    [i18n.language, logState, match, searchActive],
  )

  const filteredHistory = useMemo(
    () => historyLogs.filter(matchesLog),
    [historyLogs, matchesLog],
  )
  const filteredLive = useMemo(
    () => (liveLogs ?? []).filter(matchesLog),
    [liveLogs, matchesLog],
  )

  const filteredLogs = useMemo(() => {
    if (rangePreset !== 'today' || page !== 0 || !isDescending) {
      return filteredHistory
    }

    const seen = new Set<string>()
    const combined: ILogItem[] = []
    const add = (log: ILogItem) => {
      const identity = logIdentity(log)
      if (seen.has(identity)) return
      seen.add(identity)
      combined.push(log)
    }
    for (let i = filteredLive.length - 1; i >= 0; i--) {
      add(filteredLive[i])
      if (combined.length >= LOG_PAGE_SIZE) return combined
    }
    for (const log of filteredHistory) {
      add(log)
      if (combined.length >= LOG_PAGE_SIZE) break
    }
    return combined
  }, [filteredHistory, filteredLive, isDescending, page, rangePreset])

  const virtuosoRef = useRef<VirtualListHandle>(null)
  useEffect(() => {
    virtuosoRef.current?.scrollToIndex(0)
  }, [logOrder, logState, page, rangePreset])

  const handleLogLevelChange = (newLevel: LogFilter) => {
    setClashLog((pre) => ({ ...pre!, logFilter: newLevel }))
  }

  const handleToggleLog = () => {
    setClashLog((pre) => ({ ...pre!, streamPaused: !streamPaused }))
  }

  const handleToggleOrder = () => {
    setClashLog((pre) => ({
      ...pre!,
      logOrder: pre!.logOrder === 'desc' ? 'asc' : 'desc',
    }))
  }

  return (
    <BasePage
      full
      title={t('logs.page.title')}
      contentStyle={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
      header={
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <IconButton
            title={t(
              streamActive ? 'shared.actions.pause' : 'shared.actions.resume',
            )}
            aria-label={t(
              streamActive ? 'shared.actions.pause' : 'shared.actions.resume',
            )}
            size="small"
            color="inherit"
            onClick={handleToggleLog}
          >
            {streamActive ? (
              <PauseCircleOutlineRounded />
            ) : (
              <PlayCircleOutlineRounded />
            )}
          </IconButton>
          <IconButton
            title={t(
              isDescending
                ? 'logs.actions.showAscending'
                : 'logs.actions.showDescending',
            )}
            aria-label={t(
              isDescending
                ? 'logs.actions.showAscending'
                : 'logs.actions.showDescending',
            )}
            size="small"
            color="inherit"
            onClick={handleToggleOrder}
          >
            <SwapVertRounded
              sx={{
                transform: isDescending ? 'scaleY(-1)' : 'none',
                transition: 'transform 0.2s ease',
              }}
            />
          </IconButton>

          <Button
            size="small"
            variant="contained"
            onClick={() => refreshGetClashLog(true)}
          >
            {t('shared.actions.clear')}
          </Button>
        </Box>
      }
    >
      <Box
        sx={{
          px: 1.25,
          py: 1,
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          flexWrap: 'wrap',
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <Tabs
          value={logState}
          onChange={(_, value: LogFilter) => handleLogLevelChange(value)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{
            flex: '1 1 420px',
            minWidth: 0,
            minHeight: 36,
            '& .MuiTab-root': { minHeight: 36, py: 0.5 },
          }}
        >
          <Tab value="all" label={t('shared.filters.logLevels.all')} />
          <Tab value="debug" label={t('shared.filters.logLevels.debug')} />
          <Tab value="info" label={t('shared.filters.logLevels.info')} />
          <Tab value="warn" label={t('shared.filters.logLevels.warn')} />
          <Tab value="err" label={t('shared.filters.logLevels.error')} />
        </Tabs>

        <ToggleButtonGroup
          exclusive
          size="small"
          value={rangePreset}
          onChange={(_, value: LogRangePreset | null) => {
            if (value) setRangePreset(value)
          }}
          aria-label={t('logs.range.label')}
          sx={{ height: 32, flexShrink: 0 }}
        >
          <ToggleButton value="today">{t('logs.range.today')}</ToggleButton>
          <ToggleButton value="last3">{t('logs.range.last3')}</ToggleButton>
        </ToggleButtonGroup>

        <Box sx={{ flex: '1 1 240px', minWidth: 180 }}>
          <BaseSearchBox
            onSearch={(matcher, state) => {
              setMatch(() => matcher)
              setSearchState(state)
            }}
          />
        </Box>
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {historyLoading && filteredLogs.length === 0 ? (
          <Box sx={{ flex: 1, display: 'grid', placeItems: 'center' }}>
            <CircularProgress size={24} />
          </Box>
        ) : filteredLogs.length > 0 ? (
          <VirtualList
            ref={virtuosoRef}
            count={filteredLogs.length}
            estimateSize={50}
            renderItem={(i) => (
              <LogItem value={filteredLogs[i]} searchState={searchState} />
            )}
            style={{ flex: 1 }}
          />
        ) : (
          <BaseEmpty />
        )}
      </Box>

      <Box
        sx={{
          minHeight: 44,
          px: 1.5,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 0.75,
          borderTop: 1,
          borderColor: 'divider',
        }}
      >
        <IconButton
          size="small"
          disabled={page === 0 || historyLoading}
          title={t('shared.actions.previous')}
          aria-label={t('shared.actions.previous')}
          onClick={previousPage}
        >
          <ChevronLeftRounded />
        </IconButton>
        <Typography variant="body2" sx={{ minWidth: 72, textAlign: 'center' }}>
          {t('logs.pagination.page', { page: page + 1, total: totalPages })}
        </Typography>
        <IconButton
          size="small"
          disabled={!hasNextPage || historyLoading}
          title={t('shared.actions.next')}
          aria-label={t('shared.actions.next')}
          onClick={nextPage}
        >
          <ChevronRightRounded />
        </IconButton>
        <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
          {t('logs.pagination.pageSize', { count: LOG_PAGE_SIZE })}
        </Typography>
        {historyLoading && <CircularProgress size={14} sx={{ ml: 0.5 }} />}
      </Box>
    </BasePage>
  )
}

export default LogPage
