/**
 * Background Clash log listener dedicated to warning+ badge counting.
 * Independent from the Logs page subscription so alerts still accumulate
 * while the user is on other pages.
 */

import { MihomoWebSocket } from 'tauri-plugin-mihomo-api'

import { ingestLogAlert } from '@/services/log-alert-store'
import { persistHighSeverityClashLogs } from '@/services/persist-clash-logs'

const RECONNECT_DELAY_MS = 2_000
const STALE_SOCKET_MS = 120_000
const STALE_POLL_MS = 15_000

let started = false
let connecting = false
/** Soft-pause while user is on /logs (no badge accumulation). */
let paused = false
let socket: MihomoWebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let staleTimer: ReturnType<typeof setInterval> | null = null
let lastActivityAt = 0
let listenersBound = false

const clearReconnectTimer = () => {
  if (!reconnectTimer) return
  window.clearTimeout(reconnectTimer)
  reconnectTimer = null
}

const clearStaleTimer = () => {
  if (!staleTimer) return
  window.clearInterval(staleTimer)
  staleTimer = null
}

const touchActivity = () => {
  lastActivityAt = Date.now()
}

const scheduleReconnect = (delay = RECONNECT_DELAY_MS) => {
  if (paused || !started) return
  if (reconnectTimer) return
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null
    void connectLogAlertSocket()
  }, delay)
}

const closeSocket = async () => {
  clearStaleTimer()
  const current = socket
  socket = null
  if (!current) return
  try {
    await current.close()
  } catch {
    // ignore
  }
}

const attachStaleWatch = (ws: MihomoWebSocket) => {
  clearStaleTimer()
  touchActivity()
  staleTimer = window.setInterval(() => {
    if (socket !== ws) {
      clearStaleTimer()
      return
    }
    if (Date.now() - lastActivityAt > STALE_SOCKET_MS) {
      void closeSocket().then(() => scheduleReconnect())
    }
  }, STALE_POLL_MS)
}

const connectLogAlertSocket = async () => {
  if (connecting || socket || paused || !started) return

  connecting = true
  clearReconnectTimer()

  try {
    const next = await MihomoWebSocket.connect_logs('WARNING')
    if (!started || paused) {
      await next.close()
      return
    }
    socket = next
    attachStaleWatch(next)
    next.addListener((message) => {
      if (socket !== next) return
      touchActivity()
      if (message.type !== 'Text') return
      const data = message.data
      if (data.startsWith('Websocket error')) {
        void closeSocket().then(() => scheduleReconnect())
        return
      }
      try {
        const parsed = JSON.parse(data) as { type?: string; payload?: string }
        ingestLogAlert(parsed?.type)
        persistHighSeverityClashLogs([parsed])
      } catch {
        // ignore malformed frames
      }
    })
  } catch (err) {
    console.warn('[LogAlert] connect failed', err)
    scheduleReconnect()
  } finally {
    connecting = false
  }
}

const bindConfigListeners = () => {
  if (listenersBound || typeof window === 'undefined') return
  listenersBound = true
}

/** Pause/resume when navigating to/from Logs to avoid dual log sockets. */
export const setLogAlertMonitorPaused = (nextPaused: boolean) => {
  if (paused === nextPaused) return
  paused = nextPaused
  if (paused) {
    clearReconnectTimer()
    void closeSocket()
    return
  }
  if (started && !socket && !connecting) {
    void connectLogAlertSocket()
  }
}

/** Start once from app layout. Safe to call repeatedly. */
export const ensureBackgroundLogAlertMonitor = () => {
  if (started) return
  started = true
  bindConfigListeners()
  void connectLogAlertSocket()
}
