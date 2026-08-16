import * as yaml from 'js-yaml'

export type CursorIspProtocol = 'http' | 'socks5'

export interface CursorIspSetupInput {
  protocol: CursorIspProtocol
  server: string
  port: number
  username: string
  password: string
  hopGroup: string
  exitGroup: string
  nodeName: string
}

export interface SeqProfileConfig {
  prepend: unknown[]
  append: unknown[]
  delete: unknown[]
}

export interface IspProxyNode {
  name: string
  type: CursorIspProtocol
  server: string
  port: number
  username?: string
  password?: string
  'dialer-proxy'?: string
}

export const DEFAULT_CURSOR_ISP_SETUP: CursorIspSetupInput = {
  protocol: 'http',
  server: '',
  port: 6666,
  username: '',
  password: '',
  hopGroup: 'JMS',
  exitGroup: 'EXIT',
  nodeName: 'Thordata-ISP',
}

export const GLOBAL_RULES_UID = 'Rules'

const CURSOR_PROCESS_NAMES = [
  'Cursor.exe',
  'Cursor Helper.exe',
  'Cursor Helper (GPU).exe',
  'Cursor Helper (Plugin).exe',
  'Cursor Helper (Renderer).exe',
]

const CURSOR_DOMAIN_SUFFIXES = [
  'cursor.sh',
  'cursor.com',
  'cursorapi.com',
  'cursor-cdn.com',
  'openai.com',
  'oaistatic.com',
  'oaiusercontent.com',
  'anthropic.com',
  'claude.ai',
  'chatgpt.com',
]

const CURSOR_DOMAINS = [
  'api2.cursor.sh',
  'repo42.cursor.sh',
  'authenticator.cursor.sh',
]

export const emptySeqConfig = (): SeqProfileConfig => ({
  prepend: [],
  append: [],
  delete: [],
})

export const directNodeName = (nodeName: string): string => `${nodeName}-Direct`

export const normalizeSetupInput = (
  input: Partial<CursorIspSetupInput>,
): CursorIspSetupInput => ({
  protocol: input.protocol === 'socks5' ? 'socks5' : 'http',
  server: (input.server ?? '').trim(),
  port: Number(input.port) || 0,
  username: (input.username ?? '').trim(),
  password: input.password ?? '',
  hopGroup: (input.hopGroup ?? DEFAULT_CURSOR_ISP_SETUP.hopGroup).trim(),
  exitGroup: (input.exitGroup ?? DEFAULT_CURSOR_ISP_SETUP.exitGroup).trim(),
  nodeName: (input.nodeName ?? DEFAULT_CURSOR_ISP_SETUP.nodeName).trim(),
})

export type CursorIspFieldError =
  | 'server'
  | 'port'
  | 'hopGroup'
  | 'exitGroup'
  | 'nodeName'

export const validateSetupInput = (
  input: CursorIspSetupInput,
): CursorIspFieldError | null => {
  if (!input.server) return 'server'
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) {
    return 'port'
  }
  if (!input.hopGroup) return 'hopGroup'
  if (!input.exitGroup) return 'exitGroup'
  if (!input.nodeName) return 'nodeName'
  if (input.nodeName === input.hopGroup || input.nodeName === input.exitGroup) {
    return 'nodeName'
  }
  return null
}

export const buildCursorIspRules = (exitGroup: string): string[] => [
  ...CURSOR_PROCESS_NAMES.map((name) => `PROCESS-NAME,${name},${exitGroup}`),
  ...CURSOR_DOMAIN_SUFFIXES.map(
    (domain) => `DOMAIN-SUFFIX,${domain},${exitGroup}`,
  ),
  ...CURSOR_DOMAINS.map((domain) => `DOMAIN,${domain},${exitGroup}`),
]

export const buildIspProxyNodes = (
  input: CursorIspSetupInput,
): IspProxyNode[] => {
  const auth = input.username
    ? { username: input.username, password: input.password }
    : {}
  const chained: IspProxyNode = {
    name: input.nodeName,
    type: input.protocol,
    server: input.server,
    port: input.port,
    ...auth,
    'dialer-proxy': input.hopGroup,
  }
  const direct: IspProxyNode = {
    name: directNodeName(input.nodeName),
    type: input.protocol,
    server: input.server,
    port: input.port,
    ...auth,
  }
  return [chained, direct]
}

export const buildExitGroup = (input: CursorIspSetupInput) => ({
  name: input.exitGroup,
  type: 'select',
  proxies: [
    input.nodeName,
    directNodeName(input.nodeName),
    input.hopGroup,
    'DIRECT',
  ],
})

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

const proxyNameOf = (value: unknown): string | null => {
  const rec = asRecord(value)
  return typeof rec?.name === 'string' ? rec.name : null
}

const groupNameOf = (value: unknown): string | null => proxyNameOf(value)

const ruleTextOf = (value: unknown): string | null => {
  if (typeof value === 'string') return value.replace(/^['"]|['"]$/g, '')
  return null
}

export const isManagedIspProxyName = (
  name: string,
  nodeName: string,
): boolean => name === nodeName || name === directNodeName(nodeName)

export const isManagedCursorIspRule = (
  rule: string,
  exitGroup: string,
): boolean => buildCursorIspRules(exitGroup).includes(rule)

export const parseSeqConfig = (
  raw: string | null | undefined,
): SeqProfileConfig => {
  const empty = emptySeqConfig()
  if (!raw || !raw.trim()) return empty
  try {
    return ensureSeqConfig(yaml.load(raw))
  } catch {
    return empty
  }
}

export const dumpSeqConfig = (config: SeqProfileConfig): string =>
  yaml.dump(
    {
      prepend: config.prepend,
      append: config.append,
      delete: config.delete,
    },
    { forceQuotes: true, lineWidth: 120 },
  )

export const ensureSeqConfig = (value: unknown): SeqProfileConfig => {
  const rec = asRecord(value)
  const list = (key: 'prepend' | 'append' | 'delete') =>
    Array.isArray(rec?.[key]) ? [...(rec[key] as unknown[])] : []
  return {
    prepend: list('prepend'),
    append: list('append'),
    delete: list('delete'),
  }
}

export const mergeProxyEnhance = (
  existing: SeqProfileConfig,
  input: CursorIspSetupInput,
): SeqProfileConfig => {
  const drop = (items: unknown[]) =>
    items.filter((item) => {
      const name = proxyNameOf(item)
      return !name || !isManagedIspProxyName(name, input.nodeName)
    })
  return {
    prepend: drop(existing.prepend),
    append: [...drop(existing.append), ...buildIspProxyNodes(input)],
    delete: [...existing.delete],
  }
}

export const mergeGroupEnhance = (
  existing: SeqProfileConfig,
  input: CursorIspSetupInput,
): SeqProfileConfig => {
  const drop = (items: unknown[]) =>
    items.filter((item) => groupNameOf(item) !== input.exitGroup)
  return {
    prepend: [buildExitGroup(input), ...drop(existing.prepend)],
    append: drop(existing.append),
    delete: [...existing.delete],
  }
}

export const mergeRuleEnhance = (
  existing: SeqProfileConfig,
  exitGroup: string,
): SeqProfileConfig => {
  const managed = new Set(buildCursorIspRules(exitGroup))
  const drop = (items: unknown[]) =>
    items.filter((item) => {
      const rule = ruleTextOf(item)
      return !rule || !managed.has(rule)
    })
  return {
    prepend: [...managed, ...drop(existing.prepend)],
    append: drop(existing.append),
    delete: [...existing.delete],
  }
}

export const removeProxyEnhance = (
  existing: SeqProfileConfig,
  nodeName: string,
): SeqProfileConfig => ({
  prepend: existing.prepend.filter((item) => {
    const name = proxyNameOf(item)
    return !name || !isManagedIspProxyName(name, nodeName)
  }),
  append: existing.append.filter((item) => {
    const name = proxyNameOf(item)
    return !name || !isManagedIspProxyName(name, nodeName)
  }),
  delete: [...existing.delete],
})

export const removeGroupEnhance = (
  existing: SeqProfileConfig,
  exitGroup: string,
): SeqProfileConfig => ({
  prepend: existing.prepend.filter((item) => groupNameOf(item) !== exitGroup),
  append: existing.append.filter((item) => groupNameOf(item) !== exitGroup),
  delete: [...existing.delete],
})

export const removeRuleEnhance = (
  existing: SeqProfileConfig,
  exitGroup: string,
): SeqProfileConfig => {
  const managed = new Set(buildCursorIspRules(exitGroup))
  const drop = (items: unknown[]) =>
    items.filter((item) => {
      const rule = ruleTextOf(item)
      return !rule || !managed.has(rule)
    })
  return {
    prepend: drop(existing.prepend),
    append: drop(existing.append),
    delete: [...existing.delete],
  }
}

export const extractSetupFromProxyEnhance = (
  existing: SeqProfileConfig,
  fallback: Partial<CursorIspSetupInput> = {},
): Partial<CursorIspSetupInput> => {
  const found = [...existing.prepend, ...existing.append]
    .map(asRecord)
    .find(
      (item) =>
        typeof item?.name === 'string' &&
        typeof item['dialer-proxy'] === 'string',
    )
  if (!found) return { ...fallback }
  return {
    ...fallback,
    protocol: found.type === 'socks5' ? 'socks5' : 'http',
    server: typeof found.server === 'string' ? found.server : fallback.server,
    port: typeof found.port === 'number' ? found.port : fallback.port,
    username:
      typeof found.username === 'string' ? found.username : fallback.username,
    password:
      typeof found.password === 'string' ? found.password : fallback.password,
    hopGroup:
      typeof found['dialer-proxy'] === 'string'
        ? found['dialer-proxy']
        : fallback.hopGroup,
    nodeName: typeof found.name === 'string' ? found.name : fallback.nodeName,
  }
}

export const selectableProfiles = (
  items: Array<Pick<IProfileItem, 'uid' | 'type' | 'option' | 'name'>> = [],
  applyAll: boolean,
  currentUid?: string,
) =>
  items.filter((item) => {
    if (item.type !== 'remote' && item.type !== 'local') return false
    if (!item.option?.proxies || !item.option?.groups) return false
    if (applyAll) return true
    return item.uid === currentUid
  })
