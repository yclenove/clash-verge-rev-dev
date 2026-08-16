import { describe, expect, test } from 'vitest'

import {
  canLoadNextLogPage,
  getLogRangeStart,
  getLogTotalPages,
  mergeInitialLogs,
  mergeLiveAndHistoryLogs,
} from './use-log-data'

const log = (time: string, type: string, payload: string): ILogItem => ({
  time,
  type,
  payload,
})

describe('mergeInitialLogs', () => {
  test('fills an empty cache with the fetched history', () => {
    const history = [log('08-03 10:00:00', 'warning', 'w1')]

    expect(mergeInitialLogs(undefined, history)).toEqual(history)
  })

  test('prepends warnings missing from a stale cache', () => {
    const current = [log('08-03 10:05:00', 'info', 'i1')]
    const history = [
      log('08-03 10:00:00', 'warning', 'w1'),
      log('08-03 10:05:00', 'info', 'i1'),
    ]

    const merged = mergeInitialLogs(current, history)

    expect(merged).toHaveLength(2)
    expect(merged[0]).toEqual(history[0])
    expect(merged[1]).toEqual(current[0])
  })

  test('does not duplicate entries already in the cache', () => {
    const current = [log('08-03 10:05:00', 'warning', 'w1')]
    const history = [log('08-03 10:05:00', 'warning', 'w1')]

    expect(mergeInitialLogs(current, history)).toHaveLength(1)
  })
})

describe('getLogRangeStart', () => {
  test('uses local midnight for today', () => {
    const now = new Date(2026, 7, 3, 12, 30).getTime()

    expect(getLogRangeStart('today', now)).toBe(new Date(2026, 7, 3).getTime())
  })

  test('includes today and the previous two calendar days', () => {
    const now = new Date(2026, 7, 3, 12, 30).getTime()

    expect(getLogRangeStart('last3', now)).toBe(new Date(2026, 7, 1).getTime())
  })
})

describe('log pagination bounds', () => {
  test('computes finite page counts from the filtered total', () => {
    expect(getLogTotalPages(0)).toBe(1)
    expect(getLogTotalPages(101)).toBe(1)
    expect(getLogTotalPages(8144)).toBe(9)
  })

  test('stops at the final partial page', () => {
    expect(canLoadNextLogPage(0, 101, 101)).toBe(false)
    expect(canLoadNextLogPage(7, 8144, 1001)).toBe(true)
    expect(canLoadNextLogPage(7, 8144, 1000)).toBe(false)
    expect(canLoadNextLogPage(8, 8144, 144)).toBe(false)
  })
})

describe('mergeLiveAndHistoryLogs', () => {
  const history = [log('08-15 10:00:00', 'warning', 'old')]
  const live = [log('08-15 10:01:00', 'warning', 'live')]

  test('appends live lines after history on the last ascending page', () => {
    expect(
      mergeLiveAndHistoryLogs(history, live, {
        range: 'today',
        page: 0,
        descending: false,
        hasNextPage: false,
      }),
    ).toEqual([...history, ...live])
  })

  test('keeps live lines when ascending history already fills the page', () => {
    const fullHistory = [
      log('08-15 10:00:00', 'warning', 'old-1'),
      log('08-15 10:00:01', 'warning', 'old-2'),
    ]
    expect(
      mergeLiveAndHistoryLogs(fullHistory, live, {
        range: 'today',
        page: 0,
        descending: false,
        hasNextPage: false,
        pageSize: 2,
      }),
    ).toEqual([fullHistory[1], live[0]])
  })

  test('does not merge live lines onto an earlier ascending page', () => {
    expect(
      mergeLiveAndHistoryLogs(history, live, {
        range: 'today',
        page: 0,
        descending: false,
        hasNextPage: true,
      }),
    ).toEqual(history)
  })

  test('prepends live lines before history in descending order', () => {
    expect(
      mergeLiveAndHistoryLogs(history, live, {
        range: 'today',
        page: 0,
        descending: true,
      }),
    ).toEqual([...live, ...history])
  })

  test('does not merge live lines on later pages or older ranges', () => {
    expect(
      mergeLiveAndHistoryLogs(history, live, {
        range: 'today',
        page: 1,
        descending: true,
      }),
    ).toEqual(history)
    expect(
      mergeLiveAndHistoryLogs(history, live, {
        range: 'last3',
        page: 0,
        descending: false,
        hasNextPage: false,
      }),
    ).toEqual(history)
  })
})
