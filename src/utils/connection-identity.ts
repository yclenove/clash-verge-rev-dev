/**
 * Normalize Mihomo connection identity so ranking can merge the same app/host
 * even when processPath/process fields flip between snapshots.
 */

const WINDOWS_PATH_RE = /^[a-zA-Z]:[\\/]/

export const UNKNOWN_PROCESS_KEY = '__unknown_process__'
export const UNKNOWN_HOST_KEY = '__unknown_host__'

const clean = (value?: string | null) => (value || '').trim()

/** basename of a path, keeping the original casing of the final segment */
export const pathBasename = (input?: string | null): string => {
  const value = clean(input)
  if (!value) return ''
  const normalized = value.replace(/\\/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  return parts.length ? parts[parts.length - 1] : value
}

/**
 * Stable process display name:
 * 1) metadata.process
 * 2) basename(processPath)
 */
export const resolveProcessName = (
  process?: string | null,
  processPath?: string | null,
): string => {
  const direct = clean(process)
  if (direct) {
    // Sometimes process is already a full path
    if (
      direct.includes('/') ||
      direct.includes('\\') ||
      WINDOWS_PATH_RE.test(direct)
    ) {
      return pathBasename(direct) || direct
    }
    return direct
  }
  const fromPath = pathBasename(processPath)
  return fromPath
}

/** Case-insensitive key for grouping on Windows-like names */
export const processGroupKey = (
  process?: string | null,
  processPath?: string | null,
): string => {
  const name = resolveProcessName(process, processPath)
  if (!name) return UNKNOWN_PROCESS_KEY
  return `process:${name.toLowerCase()}`
}

export const resolveHostName = (metadata: {
  host?: string
  destinationIP?: string
  remoteDestination?: string
}): string => {
  return (
    clean(metadata.host) ||
    clean(metadata.destinationIP) ||
    clean(metadata.remoteDestination) ||
    ''
  )
}

export const hostGroupKey = (metadata: {
  host?: string
  destinationIP?: string
  remoteDestination?: string
}): string => {
  const host = resolveHostName(metadata)
  if (!host) return UNKNOWN_HOST_KEY
  return `host:${host.toLowerCase()}`
}
