/**
 * Unread high-severity Clash log counter for the left-nav badge.
 * Counts warning/error only; debug/info/silent are ignored.
 * Cleared when the user opens the Logs page.
 */

import { recordHighSeverityAlert } from '@/services/log-alert-rate'

const listeners = new Set<() => void>()

let unreadCount = 0
/** When true (user is on /logs), new alerts do not accumulate. */
let logsPageActive = false

const isHighSeverityType = (type?: string | null): boolean => {
  const value = (type || '').trim().toLowerCase()
  return (
    value === 'warning' ||
    value === 'warn' ||
    value === 'error' ||
    value === 'err'
  )
}

const notify = () => {
  listeners.forEach((listener) => listener())
}

export const getLogAlertUnreadCount = () => unreadCount

export const subscribeLogAlert = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Ingest one Clash log line; only warning+ increments the badge. */
export const ingestLogAlert = (type?: string | null) => {
  if (!isHighSeverityType(type)) return
  // Rate tracking must be independent of the badge, which the user can reset.
  recordHighSeverityAlert()
  if (logsPageActive) return
  unreadCount += 1
  notify()
}

/** Mark Logs page as active/inactive. Opening it clears the current count. */
export const setLogsPageActive = (active: boolean) => {
  if (logsPageActive === active) {
    if (active && unreadCount !== 0) {
      unreadCount = 0
      notify()
    }
    return
  }
  logsPageActive = active
  if (active) {
    unreadCount = 0
  }
  notify()
}

/** Explicit clear (e.g. menu click on Logs). */
export const clearLogAlertUnread = () => {
  if (unreadCount === 0) return
  unreadCount = 0
  notify()
}

export const isHighSeverityLogType = isHighSeverityType

/** Test-only reset to keep unit suites isolated. */
export const resetLogAlertStoreForTests = () => {
  if (import.meta.env.MODE !== 'test') return
  unreadCount = 0
  logsPageActive = false
  listeners.clear()
}
