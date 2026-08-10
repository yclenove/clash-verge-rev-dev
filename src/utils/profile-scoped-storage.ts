const getProfileStorageKey = (baseKey: string, profileId: string | null) =>
  profileId ? `${baseKey}:${profileId}` : baseKey

export const readProfileScopedItem = (
  baseKey: string,
  profileId: string | null,
): string | null => {
  if (typeof window === 'undefined') return null
  const profileKey = getProfileStorageKey(baseKey, profileId)
  const profileValue = localStorage.getItem(profileKey)
  if (profileValue != null) {
    return profileValue
  }

  if (profileKey !== baseKey) {
    const legacyValue = localStorage.getItem(baseKey)
    if (legacyValue != null) {
      localStorage.removeItem(baseKey)
      localStorage.setItem(profileKey, legacyValue)
      return legacyValue
    }
  }

  return null
}

export const writeProfileScopedItem = (
  baseKey: string,
  profileId: string | null,
  value: string,
) => {
  if (typeof window === 'undefined') return
  const profileKey = getProfileStorageKey(baseKey, profileId)
  localStorage.setItem(profileKey, value)
  if (profileKey !== baseKey) {
    localStorage.removeItem(baseKey)
  }
}
