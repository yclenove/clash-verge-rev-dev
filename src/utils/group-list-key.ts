/** Serialize proxy group names for use as a map / cache key (names may contain spaces). */
export const encodeGroupListKey = (groups: readonly string[]): string =>
  JSON.stringify(groups)

export const decodeGroupListKey = (encoded: string): string[] => {
  if (!encoded) return []
  try {
    const parsed = JSON.parse(encoded) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((name): name is string => typeof name === 'string')
  } catch {
    return []
  }
}
