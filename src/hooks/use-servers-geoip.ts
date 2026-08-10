import { useEffect, useMemo, useState } from 'react'

import { lookupServersGeoip } from '@/services/cmds'

/** Process-wide cache so home / chain / picker share resolved GeoIP results. */
const geoCache = new Map<string, IServerGeoInfo>()

/** Short-lived negative cache so transient lookup failures can be retried. */
const geoFailureCache = new Map<string, number>()
const GEO_FAILURE_RETRY_MS = 60_000

const normalizeServers = (
  servers: Iterable<string | null | undefined>,
): string[] => {
  const unique = new Set<string>()
  for (const server of servers) {
    if (typeof server !== 'string') continue
    const trimmed = server.trim()
    if (trimmed) unique.add(trimmed)
  }
  return Array.from(unique).sort()
}

const snapshotFromCache = (
  servers: string[],
): Record<string, IServerGeoInfo> => {
  const next: Record<string, IServerGeoInfo> = {}
  for (const server of servers) {
    const cached = geoCache.get(server)
    if (cached) next[server] = cached
  }
  return next
}

/**
 * Batch-resolve proxy server hostnames/IPs to offline MMDB GeoIP info.
 * Results are cached for the app session; missing entries are looked up once.
 */
export const useServersGeoip = (
  serversInput: Iterable<string | null | undefined>,
): Record<string, IServerGeoInfo> => {
  const serversKey = normalizeServers(serversInput).join('\0')
  const servers = useMemo(
    () => (serversKey ? serversKey.split('\0') : []),
    [serversKey],
  )

  const [lookupRevision, setLookupRevision] = useState(0)

  useEffect(() => {
    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    const now = Date.now()

    const scheduleRetry = (retryAt: number) => {
      if (retryTimer) clearTimeout(retryTimer)
      retryTimer = setTimeout(
        () => {
          if (!cancelled) setLookupRevision((revision) => revision + 1)
        },
        Math.max(0, retryAt - Date.now()),
      )
    }

    const unresolved = servers.filter((server) => !geoCache.has(server))
    const missing = unresolved.filter((server) => {
      const failedAt = geoFailureCache.get(server)
      return failedAt == null || now - failedAt >= GEO_FAILURE_RETRY_MS
    })
    if (missing.length === 0) {
      const nextRetryAt = unresolved.reduce((earliest, server) => {
        const failedAt = geoFailureCache.get(server)
        return failedAt == null
          ? earliest
          : Math.min(earliest, failedAt + GEO_FAILURE_RETRY_MS)
      }, Number.POSITIVE_INFINITY)
      if (Number.isFinite(nextRetryAt)) scheduleRetry(nextRetryAt)
      return () => {
        cancelled = true
        if (retryTimer) clearTimeout(retryTimer)
      }
    }

    void lookupServersGeoip(missing)
      .then((map) => {
        if (cancelled) return
        const resolvedAt = Date.now()
        if (!map) {
          for (const server of missing) {
            geoFailureCache.set(server, resolvedAt)
          }
          scheduleRetry(resolvedAt + GEO_FAILURE_RETRY_MS)
          return
        }

        let changed = false
        for (const server of missing) {
          const value = map[server]
          if (value) {
            geoCache.set(server, value)
            geoFailureCache.delete(server)
            changed = true
          } else {
            geoFailureCache.set(server, resolvedAt)
          }
        }
        if (changed) {
          setLookupRevision((revision) => revision + 1)
        } else {
          scheduleRetry(resolvedAt + GEO_FAILURE_RETRY_MS)
        }
      })
      .catch(() => {
        if (cancelled) return
        const failedAt = Date.now()
        for (const server of missing) {
          geoFailureCache.set(server, failedAt)
        }
        scheduleRetry(failedAt + GEO_FAILURE_RETRY_MS)
      })

    return () => {
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
    }
  }, [lookupRevision, servers, serversKey])

  return snapshotFromCache(servers)
}

/** Prefer resolved IP; fall back to the original server string. */
const resolveGeoIp = (
  server: string | undefined,
  geo?: IServerGeoInfo,
): string | undefined => geo?.ip || server || undefined

/** `97.64.18.156 🇺🇸 美国` style secondary line parts. */
export const formatGeoParts = (
  server: string | undefined,
  geo?: IServerGeoInfo,
  flagOf?: (code: string | undefined) => string,
): { ip?: string; region?: string } => {
  const ip = resolveGeoIp(server, geo)
  const flag = flagOf?.(geo?.countryCode) ?? ''
  const country = geo?.country || geo?.countryCode
  const region = [flag, country].filter(Boolean).join(' ').trim() || undefined
  return { ip, region }
}
