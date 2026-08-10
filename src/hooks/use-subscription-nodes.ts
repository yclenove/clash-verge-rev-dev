import * as yaml from 'js-yaml'
import { useEffect, useState } from 'react'

import { useProfiles } from '@/hooks/use-profiles'
import { readProfileFile } from '@/services/cmds'

export interface SubscriptionInfo {
  uid: string
  name: string
}

export interface SubscriptionNodeMeta {
  profileUid: string
  /** Upstream server host/IP from subscription YAML proxies[].server */
  server?: string
  /** Proxy protocol type from YAML proxies[].type */
  type?: string
}

const isSubscriptionProfile = (profile: IProfileItem) =>
  (profile.type === 'remote' || profile.type === 'local') && !!profile.file

/**
 * Loads subscription profiles and builds node lookup maps.
 * - subscriptions: remote/local profiles from profiles.items
 * - nodeProfileMap: node name -> owning profile uid
 * - nodeMetaMap: node name -> profile uid / server / type
 *
 * Re-runs when the profile list changes (merge_other_profiles, etc.).
 */
export const useSubscriptionNodes = () => {
  const { profiles } = useProfiles()
  const [subscriptions, setSubscriptions] = useState<SubscriptionInfo[]>([])
  const [nodeProfileMap, setNodeProfileMap] = useState<Map<string, string>>(
    () => new Map(),
  )
  const [nodeMetaMap, setNodeMetaMap] = useState<
    Map<string, SubscriptionNodeMeta>
  >(() => new Map())

  const items = profiles?.items

  useEffect(() => {
    if (!items || items.length === 0) return
    let cancelled = false

    const load = async () => {
      const targets = items.filter(isSubscriptionProfile)
      const nextSubscriptions = targets.map((profile) => ({
        uid: profile.uid,
        name: profile.name || profile.uid,
      }))
      // First profile wins when the same node name appears in multiple subs.
      const nodeMap = new Map<string, string>()
      const metaMap = new Map<string, SubscriptionNodeMeta>()

      for (const profile of targets) {
        if (cancelled) return
        try {
          const content = await readProfileFile(profile.uid)
          const parsed = yaml.load(content) as {
            proxies?: Array<Record<string, unknown>>
          } | null
          for (const proxy of parsed?.proxies ?? []) {
            const name = typeof proxy.name === 'string' ? proxy.name : undefined
            if (!name) continue
            if (nodeMap.has(name)) continue
            nodeMap.set(name, profile.uid)
            metaMap.set(name, {
              profileUid: profile.uid,
              server:
                typeof proxy.server === 'string' && proxy.server.trim()
                  ? proxy.server.trim()
                  : undefined,
              type:
                typeof proxy.type === 'string' && proxy.type.trim()
                  ? proxy.type.trim()
                  : undefined,
            })
          }
        } catch {
          // Skip unreadable subscription files.
        }
      }

      if (cancelled) return
      setSubscriptions(nextSubscriptions)
      setNodeProfileMap(nodeMap)
      setNodeMetaMap(metaMap)
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [items])

  if (!items || items.length === 0) {
    return {
      subscriptions: [],
      nodeProfileMap: new Map<string, string>(),
      nodeMetaMap: new Map<string, SubscriptionNodeMeta>(),
    }
  }

  return { subscriptions, nodeProfileMap, nodeMetaMap }
}
