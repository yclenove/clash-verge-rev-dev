import { describe, expect, it } from 'vitest'

import {
  __testing__connectionPendingKey,
  __testing__mergeConnectionSnapshot,
} from './use-connection-data'

describe('use-connection-data closed connections', () => {
  it('resets speed to zero for closed connections', () => {
    const previous = __testing__mergeConnectionSnapshot({
      uploadTotal: 100,
      downloadTotal: 200,
      connections: [
        {
          id: 'conn-1',
          upload: 50,
          download: 60,
          start: '2026-01-01T00:00:00Z',
          chains: ['A'],
          rule: '',
          rulePayload: '',
          metadata: {
            network: 'tcp',
            type: 'http',
            host: 'example.com',
            sourceIP: '127.0.0.1',
            sourcePort: '5000',
            destinationPort: '443',
            destinationIP: '1.1.1.1',
            remoteDestination: 'example.com:443',
            process: 'app',
            processPath: '/usr/bin/app',
          },
        },
      ],
    } as IConnections)

    const next = __testing__mergeConnectionSnapshot(
      {
        uploadTotal: 100,
        downloadTotal: 200,
        connections: [],
      } as IConnections,
      previous as any,
    )

    expect(next.closedConnections).toHaveLength(1)
    expect(next.closedConnections[0].curUpload).toBe(0)
    expect(next.closedConnections[0].curDownload).toBe(0)
  })

  it('keeps retry buckets separate across local calendar days', () => {
    const base = {
      connection_id: 'conn-1',
      started_at: new Date(2026, 0, 1, 20, 0).getTime(),
      closed_at: null,
      upload: 100,
      download: 200,
      confidence: 'high',
    }
    const beforeMidnight = __testing__connectionPendingKey({
      ...base,
      observed_at: new Date(2026, 0, 1, 23, 59, 59).getTime(),
    })
    const afterMidnight = __testing__connectionPendingKey({
      ...base,
      observed_at: new Date(2026, 0, 2, 0, 0, 1).getTime(),
    })

    expect(beforeMidnight).not.toBe(afterMidnight)
  })
})
