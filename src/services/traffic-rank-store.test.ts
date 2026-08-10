import { afterEach, describe, expect, test, vi } from 'vitest'

import {
  buildActiveSpeedMap,
  clearTrafficRankStore,
  ingestConnectionSnapshot,
  queryHistoricalRank,
  resolveRangeDayKeys,
  trafficDayKey,
} from './traffic-rank-store'

const conn = (
  partial: Partial<IConnectionsItem> & { id: string },
): IConnectionsItem => ({
  id: partial.id,
  upload: partial.upload ?? 0,
  download: partial.download ?? 0,
  start: partial.start ?? new Date().toISOString(),
  chains: partial.chains ?? ['Proxy', '节点A'],
  rule: partial.rule ?? '',
  rulePayload: partial.rulePayload ?? '',
  curUpload: partial.curUpload,
  curDownload: partial.curDownload,
  metadata: {
    network: 'tcp',
    type: 'HTTP',
    host: partial.metadata?.host ?? 'example.com',
    sourceIP: '127.0.0.1',
    sourcePort: '1',
    destinationPort: '443',
    destinationIP: partial.metadata?.destinationIP,
    remoteDestination: partial.metadata?.remoteDestination,
    process: partial.metadata?.process,
    processPath: partial.metadata?.processPath,
  },
})

afterEach(() => {
  vi.useRealTimers()
  clearTrafficRankStore(false)
})

describe('trafficDayKey / resolveRangeDayKeys', () => {
  test('formats local yyyy-mm-dd', () => {
    const key = trafficDayKey(Date.UTC(2026, 6, 29, 12, 0, 0))
    expect(key).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  test('range presets return expected lengths', () => {
    expect(resolveRangeDayKeys('today')).toHaveLength(1)
    expect(resolveRangeDayKeys('last3')).toHaveLength(3)
    expect(resolveRangeDayKeys('last7')).toHaveLength(7)
    expect(resolveRangeDayKeys('last30')).toHaveLength(30)
  })
})

describe('ingestConnectionSnapshot ranking chain', () => {
  test('credits fresh connection bytes to process and host bags', () => {
    const c = conn({
      id: 'c1',
      upload: 100,
      download: 500,
      metadata: {
        network: 'tcp',
        type: 'HTTP',
        host: 'api.example.com',
        sourceIP: '1',
        sourcePort: '1',
        destinationPort: '443',
        process: 'chrome.exe',
      },
    })

    ingestConnectionSnapshot([c])
    const processRank = queryHistoricalRank('process', 'today')
    const hostRank = queryHistoricalRank('host', 'today')

    expect(processRank.downloadTotal).toBe(500)
    expect(processRank.uploadTotal).toBe(100)
    expect(
      processRank.rows.some((r) => r.name.toLowerCase().includes('chrome')),
    ).toBe(true)
    expect(hostRank.rows.some((r) => r.name.includes('api.example.com'))).toBe(
      true,
    )
  })

  test('only accounts positive deltas on subsequent snapshots', () => {
    const base = conn({
      id: 'c2',
      upload: 10,
      download: 20,
      metadata: {
        network: 'tcp',
        type: 'HTTP',
        host: 'a.test',
        sourceIP: '1',
        sourcePort: '1',
        destinationPort: '443',
        process: 'app.exe',
      },
    })
    ingestConnectionSnapshot([base])
    const afterFirst = queryHistoricalRank('process', 'today')

    ingestConnectionSnapshot([
      {
        ...base,
        upload: 40,
        download: 120,
      },
    ])
    const afterSecond = queryHistoricalRank('process', 'today')

    expect(afterSecond.uploadTotal - afterFirst.uploadTotal).toBe(30)
    expect(afterSecond.downloadTotal - afterFirst.downloadTotal).toBe(100)
  })

  test('does not double-count unchanged totals', () => {
    const c = conn({
      id: 'c3',
      upload: 7,
      download: 9,
      metadata: {
        network: 'tcp',
        type: 'HTTP',
        host: 'b.test',
        sourceIP: '1',
        sourcePort: '1',
        destinationPort: '443',
        process: 'stable.exe',
      },
    })
    ingestConnectionSnapshot([c])
    const once = queryHistoricalRank('process', 'today')
    ingestConnectionSnapshot([c])
    const twice = queryHistoricalRank('process', 'today')
    expect(twice.uploadTotal).toBe(once.uploadTotal)
    expect(twice.downloadTotal).toBe(once.downloadTotal)
  })

  test('clearing history does not re-credit active connection totals', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-01T10:00:00Z'))
    clearTrafficRankStore(false)

    const started = new Date('2026-06-01T10:00:05Z').toISOString()
    const c = conn({
      id: 'clear-1',
      upload: 1000,
      download: 2000,
      start: started,
      metadata: {
        network: 'tcp',
        type: 'HTTP',
        host: 'persist.test',
        sourceIP: '1',
        sourcePort: '1',
        destinationPort: '443',
        process: 'longrun.exe',
      },
    })
    ingestConnectionSnapshot([c])
    expect(
      queryHistoricalRank('process', 'today', '2026-06-01', '2026-06-01')
        .downloadTotal,
    ).toBe(2000)

    vi.setSystemTime(new Date('2026-06-01T11:00:00Z'))
    clearTrafficRankStore(false)
    ingestConnectionSnapshot([c])

    const afterClear = queryHistoricalRank(
      'process',
      'today',
      '2026-06-01',
      '2026-06-01',
    )
    expect(afterClear.downloadTotal).toBe(0)
    expect(afterClear.uploadTotal).toBe(0)
  })

  test('buildActiveSpeedMap aggregates by process key', () => {
    const rows = [
      conn({
        id: 's1',
        curUpload: 3,
        curDownload: 5,
        metadata: {
          network: 'tcp',
          type: 'HTTP',
          host: 'h1',
          sourceIP: '1',
          sourcePort: '1',
          destinationPort: '443',
          process: 'SpeedApp',
        },
      }),
      conn({
        id: 's2',
        curUpload: 7,
        curDownload: 11,
        metadata: {
          network: 'tcp',
          type: 'HTTP',
          host: 'h2',
          sourceIP: '1',
          sourcePort: '1',
          destinationPort: '443',
          process: 'SpeedApp',
        },
      }),
    ]
    const map = buildActiveSpeedMap(rows, 'process')
    const entry = [...map.values()].find((v) => v.activeConnections === 2)
    expect(entry?.uploadSpeed).toBe(10)
    expect(entry?.downloadSpeed).toBe(16)
  })
})
