import { afterEach, describe, expect, test, vi } from 'vitest'

import {
  getHighSeverityAlertCount,
  recordHighSeverityAlert,
  resetHighSeverityAlerts,
  resetHighSeverityAlertRateForTests,
  subscribeHighSeverityAlerts,
} from './log-alert-rate'

afterEach(() => {
  resetHighSeverityAlertRateForTests()
})

describe('high severity alert rate window', () => {
  test('counts only samples inside the requested window', () => {
    const now = 1_000_000
    recordHighSeverityAlert(now - 10_000)
    recordHighSeverityAlert(now - 4_000)
    recordHighSeverityAlert(now - 1_000)

    expect(getHighSeverityAlertCount(5_000, now)).toBe(2)
    expect(getHighSeverityAlertCount(30_000, now)).toBe(3)
    expect(getHighSeverityAlertCount(500, now)).toBe(0)
  })

  test('since raises the lower bound of the window', () => {
    const now = 1_000_000
    recordHighSeverityAlert(now - 10_000)
    recordHighSeverityAlert(now - 4_000)
    recordHighSeverityAlert(now - 1_000)

    expect(getHighSeverityAlertCount(30_000, now, now - 5_000)).toBe(2)
    expect(getHighSeverityAlertCount(30_000, now, now - 2_000)).toBe(1)
    expect(getHighSeverityAlertCount(30_000, now, now)).toBe(0)
  })

  test('since never widens a narrower window', () => {
    const now = 1_000_000
    recordHighSeverityAlert(now - 10_000)
    recordHighSeverityAlert(now - 1_000)

    expect(getHighSeverityAlertCount(5_000, now, now - 60_000)).toBe(1)
  })

  test('rejects non-positive windows', () => {
    const now = 1_000_000
    recordHighSeverityAlert(now)
    expect(getHighSeverityAlertCount(0, now)).toBe(0)
    expect(getHighSeverityAlertCount(-1, now)).toBe(0)
    expect(getHighSeverityAlertCount(Number.NaN, now)).toBe(0)
  })

  test('drops samples older than the max retained window', () => {
    const now = 10 * 60 * 60 * 1000
    recordHighSeverityAlert(now - 2 * 60 * 60 * 1000)
    recordHighSeverityAlert(now)
    expect(getHighSeverityAlertCount(60 * 60 * 1000, now)).toBe(1)
  })

  test('reset drops every sample', () => {
    const now = 1_000_000
    recordHighSeverityAlert(now)
    resetHighSeverityAlerts()
    expect(getHighSeverityAlertCount(60_000, now)).toBe(0)
  })

  test('notifies subscribers and stops after unsubscribe', async () => {
    vi.useFakeTimers()
    const listener = vi.fn()
    const unsubscribe = subscribeHighSeverityAlerts(listener)

    recordHighSeverityAlert()
    expect(listener).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(100)
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
    recordHighSeverityAlert()
    await vi.advanceTimersByTimeAsync(100)
    expect(listener).toHaveBeenCalledTimes(1)

    vi.useRealTimers()
  })
})
