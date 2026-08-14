import { updateProfile } from '@/services/cmds'
import { showNotice } from '@/services/notice-service'

const PROFILE_UPDATE_WORKER_LIMIT = 8
const inFlightUids = new Set<string>()

export async function updateRemoteProfiles(uids: string[]): Promise<{
  succeeded: number
  failed: number
  skipped: number
}> {
  const unique = [...new Set(uids.filter(Boolean))]
  const target = unique.filter((uid) => !inFlightUids.has(uid))
  const skipped = unique.length - target.length

  if (target.length === 0) {
    return { succeeded: 0, failed: 0, skipped }
  }

  for (const uid of target) {
    inFlightUids.add(uid)
  }

  let succeeded = 0
  let failed = 0
  let cursor = 0

  const updateOne = async (uid: string) => {
    try {
      await updateProfile(uid)
      succeeded += 1
    } catch (err: unknown) {
      failed += 1
      showNotice.error('profiles.page.feedback.errors.updateFailed', err)
    }
  }

  const worker = async () => {
    while (cursor < target.length) {
      const uid = target[cursor]
      cursor += 1
      await updateOne(uid)
    }
  }

  try {
    const active = Math.min(PROFILE_UPDATE_WORKER_LIMIT, target.length)
    await Promise.all(Array.from({ length: active }, () => worker()))
    return { succeeded, failed, skipped }
  } finally {
    for (const uid of target) {
      inFlightUids.delete(uid)
    }
  }
}
