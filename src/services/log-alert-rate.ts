/**
 * Sliding-window counter of high-severity (warning/error) Clash log lines.
 *
 * Deliberately separate from the nav badge counter in `log-alert-store`: the
 * badge is a user-facing "unread" value that resets whenever the Logs page is
 * opened, so it cannot answer "are alerts arriving fast enough to act on?".
 * This buffer is never reset by the user reading logs.
 */

/** Longest window a consumer may ask for; older samples are dropped. */
const MAX_WINDOW_MS = 60 * 60 * 1000
/** Hard cap so a log storm cannot grow the buffer without bound. */
const MAX_SAMPLES = 5000
/** Coalesce bursty listener notifications during log storms. */
const NOTIFY_DEBOUNCE_MS = 100

const listeners = new Set<() => void>()

let timestamps: number[] = []
let notifyTimer: ReturnType<typeof setTimeout> | null = null

const scheduleNotify = () => {
  if (notifyTimer) return
  notifyTimer = setTimeout(() => {
    notifyTimer = null
    listeners.forEach((listener) => listener())
  }, NOTIFY_DEBOUNCE_MS)
}

const prune = (now: number) => {
  const cutoff = now - MAX_WINDOW_MS
  let dropCount = 0
  while (dropCount < timestamps.length && timestamps[dropCount] < cutoff) {
    dropCount += 1
  }
  if (dropCount > 0) {
    timestamps = timestamps.slice(dropCount)
  }
  if (timestamps.length > MAX_SAMPLES) {
    timestamps = timestamps.slice(timestamps.length - MAX_SAMPLES)
  }
}

/** Record one warning/error log line. */
export const recordHighSeverityAlert = (at: number = Date.now()) => {
  timestamps.push(at)
  prune(at)
  scheduleNotify()
}

/**
 * Number of warning/error lines seen within the trailing `windowMs`.
 *
 * `since` raises the lower bound of the window. Consumers that only observe
 * part of the app lifetime must pass the moment they started watching,
 * otherwise samples buffered while nobody was listening are indistinguishable
 * from a live burst and would fire the moment the consumer appears.
 */
export const getHighSeverityAlertCount = (
  windowMs: number,
  now: number = Date.now(),
  since = 0,
): number => {
  if (!Number.isFinite(windowMs) || windowMs <= 0) return 0
  const windowStart = now - Math.min(windowMs, MAX_WINDOW_MS)
  const cutoff = Number.isFinite(since)
    ? Math.max(windowStart, since)
    : windowStart
  let count = 0
  for (let index = timestamps.length - 1; index >= 0; index -= 1) {
    if (timestamps[index] < cutoff) break
    count += 1
  }
  return count
}

export const subscribeHighSeverityAlerts = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Drop all samples, e.g. once an automatic recovery has consumed them. */
export const resetHighSeverityAlerts = () => {
  timestamps = []
}

/** Test-only reset to keep unit suites isolated. */
export const resetHighSeverityAlertRateForTests = () => {
  timestamps = []
  if (notifyTimer) {
    clearTimeout(notifyTimer)
    notifyTimer = null
  }
  listeners.clear()
}
