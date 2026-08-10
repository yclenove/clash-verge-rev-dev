import { describe, expect, test } from 'vitest'

import { decodeGroupListKey, encodeGroupListKey } from './group-list-key'

describe('group list key codec', () => {
  test('round-trips names that contain spaces', () => {
    const groups = ['🚀 节点选择', 'chain mode', 'Proxy']
    const key = encodeGroupListKey(groups)
    expect(decodeGroupListKey(key)).toEqual(groups)
  })

  test('empty list encodes to empty array', () => {
    expect(decodeGroupListKey(encodeGroupListKey([]))).toEqual([])
  })

  test('invalid legacy payload yields empty list', () => {
    expect(decodeGroupListKey('not-json')).toEqual([])
  })
})
