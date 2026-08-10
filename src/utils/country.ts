/**
 * Convert an ISO 3166-1 alpha-2 country code to a flag emoji.
 * Returns an empty string when the code is falsy.
 */
export const getCountryFlag = (countryCode: string | undefined): string => {
  if (!countryCode) return ''
  const codePoints = countryCode
    .toUpperCase()
    .split('')
    .map((char) => 127397 + char.charCodeAt(0))
  return String.fromCodePoint(...codePoints)
}
