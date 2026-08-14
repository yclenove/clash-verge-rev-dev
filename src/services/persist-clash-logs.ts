import { appendClashLogs } from '@/services/cmds'

const persistLevel = (type?: string | null): 'warning' | 'error' | null => {
  const value = (type || '').trim().toLowerCase()
  if (value === 'warn' || value === 'warning') return 'warning'
  if (value === 'err' || value === 'error') return 'error'
  return null
}

export const persistHighSeverityClashLogs = (
  items: Array<{ type?: string | null; payload?: string | null; ts?: number }>,
) => {
  const now = Date.now()
  const entries = items.flatMap((item) => {
    const level = persistLevel(item.type)
    if (!level) return []
    return [
      {
        ts: item.ts ?? now,
        level,
        source: 'core',
        payload: item.payload ?? '',
      },
    ]
  })
  if (entries.length === 0) return
  void appendClashLogs(entries).catch((error) => {
    console.warn('[persistClashLogs] failed', error)
  })
}
