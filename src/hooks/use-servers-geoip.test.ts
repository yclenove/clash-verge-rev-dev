// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { useServersGeoip } from './use-servers-geoip'

const lookupServersGeoip = vi.hoisted(() => vi.fn())

vi.mock('@/services/cmds', () => ({ lookupServersGeoip }))

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
})

afterEach(() => {
  vi.useRealTimers()
})

it('automatically retries a failed lookup after the negative-cache window', async () => {
  const server = 'geo-retry.example'
  const geo = { ip: '203.0.113.8', countryCode: 'US', country: 'United States' }
  lookupServersGeoip
    .mockRejectedValueOnce(new Error('temporary failure'))
    .mockResolvedValueOnce({ [server]: geo })

  const { result } = renderHook(() => useServersGeoip([server]))
  await act(async () => Promise.resolve())
  expect(lookupServersGeoip).toHaveBeenCalledTimes(1)

  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000)
  })

  expect(lookupServersGeoip).toHaveBeenCalledTimes(2)
  expect(result.current[server]).toEqual(geo)
})
