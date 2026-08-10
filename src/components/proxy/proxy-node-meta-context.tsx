import { createContext, use } from 'react'

export interface ProxyNodeMetaContextValue {
  /** node name -> subscription server host/IP */
  serverByName: Map<string, string>
  /** server host/IP -> geo info */
  geoByServer: Record<string, IServerGeoInfo>
}

const EMPTY_SERVERS = new Map<string, string>()

export const ProxyNodeMetaContext = createContext<ProxyNodeMetaContextValue>({
  serverByName: EMPTY_SERVERS,
  geoByServer: {},
})

export const useProxyNodeMeta = () => use(ProxyNodeMetaContext)
