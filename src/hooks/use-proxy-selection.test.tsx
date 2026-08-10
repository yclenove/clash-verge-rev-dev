// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useProxySelection } from './use-proxy-selection'

const selectNodeForGroup = vi.hoisted(() => vi.fn())
const recordSelection = vi.hoisted(() => vi.fn())

vi.mock('tauri-plugin-mihomo-api', () => ({
  closeConnection: vi.fn(),
  getConnections: vi.fn(async () => ({ connections: [] })),
  selectNodeForGroup,
}))
vi.mock('@/hooks/use-record-selection', () => ({
  useRecordSelection: () => recordSelection,
}))
vi.mock('@/hooks/use-verge', () => ({
  useVerge: () => ({ verge: { auto_close_connection: false } }),
}))
vi.mock('@/services/cmds', () => ({
  syncTrayProxySelection: vi.fn(async () => undefined),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useProxySelection', () => {
  it('resolves true only after the core accepts the selection', async () => {
    selectNodeForGroup.mockResolvedValueOnce(undefined)
    const onSuccess = vi.fn()
    const { result } = renderHook(() => useProxySelection({ onSuccess }))

    await expect(
      act(() => result.current.changeProxy('Proxy', 'Node B', 'Node A')),
    ).resolves.toBe(true)

    expect(onSuccess).toHaveBeenCalledOnce()
    expect(recordSelection).toHaveBeenCalledWith('Proxy', 'Node B')
  })

  it('resolves false when the core rejects the selection', async () => {
    const error = new Error('core unavailable')
    selectNodeForGroup.mockRejectedValueOnce(error)
    const onError = vi.fn()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result } = renderHook(() => useProxySelection({ onError }))

    await expect(
      act(() => result.current.changeProxy('Proxy', 'Node B', 'Node A')),
    ).resolves.toBe(false)

    expect(onError).toHaveBeenCalledWith(error)
    expect(recordSelection).not.toHaveBeenCalled()
  })
})
