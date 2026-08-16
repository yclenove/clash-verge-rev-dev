import { describe, expect, test } from 'vitest'

import {
  mergeOtherProfilesEnabled,
  shouldRestoreMergeOtherProfiles,
} from './merge-other-profiles'

describe('merge other profiles flag', () => {
  test('defaults on when unset', () => {
    expect(mergeOtherProfilesEnabled()).toBe(true)
    expect(mergeOtherProfilesEnabled(undefined)).toBe(true)
    expect(mergeOtherProfilesEnabled(null)).toBe(true)
    expect(mergeOtherProfilesEnabled(true)).toBe(true)
  })

  test('respects explicit off', () => {
    expect(mergeOtherProfilesEnabled(false)).toBe(false)
  })

  test('restores the old template default once', () => {
    expect(shouldRestoreMergeOtherProfiles(false, false)).toBe(true)
    expect(shouldRestoreMergeOtherProfiles(false, true)).toBe(false)
    expect(shouldRestoreMergeOtherProfiles(true, false)).toBe(false)
    expect(shouldRestoreMergeOtherProfiles(undefined, false)).toBe(false)
  })
})
