import type { useTranslation } from 'react-i18next'

import type { TranslationKey } from '@/types/generated/i18n-keys'

/**
 * Mapping from Clash core proxy group types to their i18n keys.
 * Group types reported by the core: Selector, URLTest, Fallback,
 * LoadBalance, Relay, Direct, Reject, Pass.
 */
const GROUP_TYPE_I18N_KEYS: Record<string, TranslationKey> = {
  Selector: 'proxies.page.groupTypes.Selector',
  URLTest: 'proxies.page.groupTypes.URLTest',
  Fallback: 'proxies.page.groupTypes.Fallback',
  LoadBalance: 'proxies.page.groupTypes.LoadBalance',
  Relay: 'proxies.page.groupTypes.Relay',
  Direct: 'proxies.page.groupTypes.Direct',
  Reject: 'proxies.page.groupTypes.Reject',
  Pass: 'proxies.page.groupTypes.Pass',
}

type TranslateFn = ReturnType<typeof useTranslation>['t']

/**
 * Translate a proxy group type (e.g. "Selector") into the localized
 * label. Unknown types are returned unchanged.
 */
export function translateGroupType(
  type: string | null | undefined,
  t: TranslateFn,
): string {
  if (!type) return ''
  const key = GROUP_TYPE_I18N_KEYS[type]
  return key ? t(key) : type
}
