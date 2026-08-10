import {
  getRecord,
  rebindNode,
  type ProxyNodeView,
  type ProxyViewV1,
} from '@/types/proxy-view'

export interface ProxyChainItem {
  id: string
  name: string
  recordId?: string
  source?: ProxyNodeView['source']
  type?: string
  delay?: number
  // Full mihomo proxy definition used only when the node is still missing
  // from the merged runtime (name collision / not yet enhanced). Prefer the
  // runtime name when recordId is present.
  definition?: Record<string, unknown>
  // Subscription (profile) the node was picked from, used for display.
  profileName?: string
  profileUid?: string
  // Resolved server address and GeoIP info, used for display.
  server?: string
  countryCode?: string
  country?: string
}

export const rebindProxyChainItems = (
  items: readonly ProxyChainItem[],
  candidates: readonly ProxyNodeView[],
  proxyView: ProxyViewV1,
): ProxyChainItem[] =>
  items.map((item) => {
    const rebound = rebindNode(candidates, {
      name: item.name,
      source: item.source,
    })
    const record =
      rebound === undefined ? undefined : getRecord(proxyView, rebound.recordId)
    return {
      ...item,
      recordId: rebound?.recordId,
      source: rebound?.source ?? item.source,
      type: rebound?.type ?? item.type,
      delay: record?.history.at(-1)?.delay,
    }
  })
