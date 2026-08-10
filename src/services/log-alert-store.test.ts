import { afterEach, describe, expect, test, vi } from 'vitest'

import {
  clearLogAlertUnread,
  getLogAlertUnreadCount,
  ingestLogAlert,
  isHighSeverityLogType,
  resetLogAlertStoreForTests,
  setLogsPageActive,
  subscribeLogAlert,
} from './log-alert-store'

afterEach(() => {
  resetLogAlertStoreForTests()
})

describe('isHighSeverityLogType', () => {
  test('counts warning/error aliases only', () => {
    expect(isHighSeverityLogType('warning')).toBe(true)
    expect(isHighSeverityLogType('WARN')).toBe(true)
    expect(isHighSeverityLogType('error')).toBe(true)
    expect(isHighSeverityLogType('ERR')).toBe(true)
    expect(isHighSeverityLogType('info')).toBe(false)
    expect(isHighSeverityLogType('debug')).toBe(false)
    expect(isHighSeverityLogType('silent')).toBe(false)
    expect(isHighSeverityLogType('')).toBe(false)
    expect(isHighSeverityLogType(null)).toBe(false)
    expect(isHighSeverityLogType(undefined)).toBe(false)
  })
})

describe('log alert unread store', () => {
  test('ignores debug/info/silent and accumulates warning+', () => {
    ingestLogAlert('debug')
    ingestLogAlert('info')
    ingestLogAlert('silent')
    expect(getLogAlertUnreadCount()).toBe(0)

    ingestLogAlert('warning')
    ingestLogAlert('error')
    ingestLogAlert('warn')
    expect(getLogAlertUnreadCount()).toBe(3)
  })

  test('opening logs page clears count and pauses accumulation', () => {
    ingestLogAlert('error')
    ingestLogAlert('warning')
    expect(getLogAlertUnreadCount()).toBe(2)

    setLogsPageActive(true)
    expect(getLogAlertUnreadCount()).toBe(0)

    ingestLogAlert('error')
    expect(getLogAlertUnreadCount()).toBe(0)
  })

  test('leaving logs page resumes accumulation', () => {
    setLogsPageActive(true)
    ingestLogAlert('error')
    expect(getLogAlertUnreadCount()).toBe(0)

    setLogsPageActive(false)
    ingestLogAlert('warning')
    expect(getLogAlertUnreadCount()).toBe(1)
  })

  test('explicit clear drops badge without changing page state', () => {
    ingestLogAlert('error')
    clearLogAlertUnread()
    expect(getLogAlertUnreadCount()).toBe(0)
    ingestLogAlert('warning')
    expect(getLogAlertUnreadCount()).toBe(1)
  })

  test('subscribers are notified on count changes', () => {
    const spy = vi.fn()
    const unsub = subscribeLogAlert(spy)
    ingestLogAlert('info')
    expect(spy).not.toHaveBeenCalled()
    ingestLogAlert('error')
    expect(spy).toHaveBeenCalledTimes(1)
    clearLogAlertUnread()
    expect(spy).toHaveBeenCalledTimes(2)
    unsub()
    ingestLogAlert('error')
    expect(spy).toHaveBeenCalledTimes(2)
  })
})

/**
 * Chain: background monitor would call ingest; menu shows count;
 * activate logs clears; while viewing no re-accumulate; leave resumes.
 */
describe('log alert menu badge chain', () => {
  test('full unread → view → leave → re-alert path', () => {
    // simulate monitor frames
    for (const type of [
      'info',
      'debug',
      'warning',
      'error',
      'silent',
    ] as const) {
      ingestLogAlert(type)
    }
    expect(getLogAlertUnreadCount()).toBe(2) // warning+error

    // click menu / enter /logs
    clearLogAlertUnread()
    setLogsPageActive(true)
    expect(getLogAlertUnreadCount()).toBe(0)

    // live warnings while viewing logs: no badge
    ingestLogAlert('warning')
    ingestLogAlert('error')
    expect(getLogAlertUnreadCount()).toBe(0)

    // leave logs
    setLogsPageActive(false)
    ingestLogAlert('error')
    expect(getLogAlertUnreadCount()).toBe(1)

    // display cap convention for UI is handled in layout-item; store keeps raw
    for (let i = 0; i < 120; i++) ingestLogAlert('warning')
    expect(getLogAlertUnreadCount()).toBe(121)
  })
})
