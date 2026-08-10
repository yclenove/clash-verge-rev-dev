import { describe, expect, test } from 'vitest'

import {
  resolveDisplayedMixedPort,
  resolveProxyServiceAddress,
} from './mixed-port'

describe('mixed port display helpers', () => {
  test('prefers the live core port over persisted values', () => {
    expect(
      resolveDisplayedMixedPort({
        live: 10808,
        runtime: 10809,
        selected: 7897,
        merge: 7890,
      }),
    ).toBe(10808)
  })

  test('builds the service address from the current mixed port', () => {
    expect(resolveProxyServiceAddress('127.0.0.1', 10808)).toBe(
      '127.0.0.1:10808',
    )
  })

  test('uses localhost when no proxy host is configured', () => {
    expect(resolveProxyServiceAddress(undefined, 10808)).toBe(
      '127.0.0.1:10808',
    )
  })
})
