export const MERGE_OTHER_PROFILES_RESTORE_KEY =
  'clash-verge-restore-merge-other-profiles-v1'

/** Missing / undefined follows the product default: merge other subscriptions. */
export const mergeOtherProfilesEnabled = (value?: boolean | null) =>
  value !== false

export const shouldRestoreMergeOtherProfiles = (
  stored: boolean | undefined,
  alreadyRestored: boolean,
) => stored === false && !alreadyRestored
