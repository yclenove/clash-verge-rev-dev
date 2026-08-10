import { describe, expect, test } from 'vitest'

import {
  canLoadNextLogPage,
  getLogRangeStart,
  getLogTotalPages,
  mergeInitialLogs,
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
