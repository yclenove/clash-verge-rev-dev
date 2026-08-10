import { beforeEach, describe, expect, it, vi } from 'vitest'

const { httpFetch } = vi.hoisted(() => ({
  httpFetch: vi.fn(),
}))

vi.mock('@tauri-apps/api/app', () => ({
  getName: vi.fn().mockResolvedValue('clash-verge'),
  getVersion: vi.fn().mockResolvedValue('2.5.3'),
}))

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: httpFetch,
}))

import { getIpInfo } from './api'

describe('getIpInfo', () => {
  beforeEach(() => {
    httpFetch.mockReset()
    httpFetch.mockResolvedValue(
      new Response(JSON.stringify({ ip: '203.0.113.8' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })

  it('routes exit IP detection through the active mihomo mixed port', async () => {
    const result = await getIpInfo(59715)

    expect(result.ip).toBe('203.0.113.8')
    expect(httpFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        proxy: { all: 'http://127.0.0.1:59715' },
      }),
    )
  })

  it('does not construct a proxy URL from an invalid port', async () => {
    await getIpInfo(0)

    expect(httpFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.not.objectContaining({ proxy: expect.anything() }),
    )
  })
})
