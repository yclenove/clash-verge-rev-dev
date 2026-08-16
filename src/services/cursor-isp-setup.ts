import { delayProxyByName, selectNodeForGroup } from 'tauri-plugin-mihomo-api'

import {
  enhanceProfiles,
  getProfiles,
  patchVergeConfig,
  readProfileFile,
  saveProfileFile,
} from '@/services/cmds'
import type { ProxyViewV1 } from '@/types/proxy-view'
import {
  DEFAULT_CURSOR_ISP_SETUP,
  GLOBAL_RULES_UID,
  dumpSeqConfig,
  extractSetupFromProxyEnhance,
  mergeGroupEnhance,
  mergeProxyEnhance,
  mergeRuleEnhance,
  normalizeSetupInput,
  parseSeqConfig,
  removeGroupEnhance,
  removeProxyEnhance,
  removeRuleEnhance,
  selectableProfiles,
  validateSetupInput,
  type CursorIspSetupInput,
} from '@/utils/cursor-isp-setup'

export interface CursorIspApplyOptions {
  applyAllProfiles: boolean
  enableSystemProxy: boolean
  enableTunMode: boolean
  enableGlobalChain: boolean
}

export interface CursorIspSetupSnapshot {
  input: CursorIspSetupInput
  options: CursorIspApplyOptions
  profileNames: string[]
  hopGroups: string[]
  mixedPort: number
}

export interface CursorIspApplyResult {
  profileNames: string[]
  nodeName: string
  exitGroup: string
}

const DEFAULT_OPTIONS: CursorIspApplyOptions = {
  applyAllProfiles: true,
  enableSystemProxy: true,
  enableTunMode: true,
  enableGlobalChain: false,
}

const vergeApplyPatch = (
  options: CursorIspApplyOptions,
  extra: Record<string, unknown>,
) => ({
  ...extra,
  ...(options.enableSystemProxy ? { enable_system_proxy: true } : {}),
  ...(options.enableTunMode ? { enable_tun_mode: true } : {}),
})

const TEST_URL = 'https://www.gstatic.com/generate_204'
const TEST_TIMEOUT = 10000

export interface CursorIspSetupDeps {
  getProfiles: typeof getProfiles
  readProfileFile: typeof readProfileFile
  saveProfileFile: typeof saveProfileFile
  enhanceProfiles: typeof enhanceProfiles
  patchVergeConfig: typeof patchVergeConfig
  selectNodeForGroup: typeof selectNodeForGroup
  delayProxyByName: typeof delayProxyByName
}

const defaultDeps = (): CursorIspSetupDeps => ({
  getProfiles,
  readProfileFile,
  saveProfileFile,
  enhanceProfiles,
  patchVergeConfig,
  selectNodeForGroup,
  delayProxyByName,
})

const saveSeq = async (
  deps: CursorIspSetupDeps,
  uid: string,
  transform: (
    current: ReturnType<typeof parseSeqConfig>,
  ) => ReturnType<typeof parseSeqConfig>,
) => {
  const current = parseSeqConfig(await deps.readProfileFile(uid))
  const ok = await deps.saveProfileFile(uid, dumpSeqConfig(transform(current)))
  if (!ok) {
    throw new Error(`save-failed:${uid}`)
  }
}

const firstLeafHop = (
  proxyView: ProxyViewV1 | undefined,
  hopGroup: string,
  nodeName: string,
): string | null => {
  const group = proxyView?.groups.find((item) => item.name === hopGroup)
  if (!group) return null
  const current =
    group.now && group.now !== nodeName && group.now !== `${nodeName}-Direct`
      ? group.now
      : null
  if (current) return current
  const leaf = group.members.find((member) => {
    if (member.kind !== 'node') return false
    return member.name !== nodeName && member.name !== `${nodeName}-Direct`
  })
  return leaf && leaf.kind === 'node' ? leaf.name : null
}

export const loadCursorIspSnapshot = async (
  proxyView: ProxyViewV1 | undefined,
  mixedPort: number,
  deps: CursorIspSetupDeps = defaultDeps(),
): Promise<CursorIspSetupSnapshot> => {
  const profiles = await deps.getProfiles()
  const hopGroups = (proxyView?.groups ?? [])
    .map((group) => group.name)
    .filter((name) => name && name !== 'GLOBAL')
  const targets = selectableProfiles(
    profiles.items ?? [],
    true,
    profiles.current,
  )
  const current =
    targets.find((item) => item.uid === profiles.current) ?? targets[0]
  const extracted = current?.option?.proxies
    ? extractSetupFromProxyEnhance(
        parseSeqConfig(await deps.readProfileFile(current.option.proxies)),
      )
    : {}
  return {
    input: normalizeSetupInput({
      ...DEFAULT_CURSOR_ISP_SETUP,
      hopGroup: hopGroups.includes('JMS') ? 'JMS' : (hopGroups[0] ?? 'JMS'),
      ...extracted,
    }),
    options: { ...DEFAULT_OPTIONS },
    profileNames: targets.map((item) => item.name || item.uid),
    hopGroups,
    mixedPort,
  }
}

export const applyCursorIspSetup = async (
  rawInput: Partial<CursorIspSetupInput>,
  options: CursorIspApplyOptions,
  proxyView: ProxyViewV1 | undefined,
  deps: CursorIspSetupDeps = defaultDeps(),
): Promise<CursorIspApplyResult> => {
  const input = normalizeSetupInput(rawInput)
  const invalid = validateSetupInput(input)
  if (invalid) {
    throw new Error(`invalid:${invalid}`)
  }

  const profiles = await deps.getProfiles()
  const targets = selectableProfiles(
    profiles.items ?? [],
    options.applyAllProfiles,
    profiles.current,
  )
  if (targets.length === 0) {
    throw new Error('no-profiles')
  }

  for (const profile of targets) {
    const proxiesUid = profile.option?.proxies
    const groupsUid = profile.option?.groups
    if (!proxiesUid || !groupsUid) continue
    await saveSeq(deps, proxiesUid, (current) =>
      mergeProxyEnhance(current, input),
    )
    await saveSeq(deps, groupsUid, (current) =>
      mergeGroupEnhance(current, input),
    )
  }

  await saveSeq(deps, GLOBAL_RULES_UID, (current) =>
    mergeRuleEnhance(current, input.exitGroup),
  )

  if (options.enableGlobalChain) {
    const hopNode = firstLeafHop(proxyView, input.hopGroup, input.nodeName)
    if (!hopNode) {
      throw new Error('missing-hop-node')
    }
    await deps.patchVergeConfig(
      vergeApplyPatch(options, {
        proxy_chain_nodes: [hopNode, input.nodeName],
        proxy_chain_group: input.hopGroup,
      }) as IVergeConfig,
    )
  } else {
    await deps.patchVergeConfig(
      vergeApplyPatch(options, {
        proxy_chain_nodes: [],
        proxy_chain_group: null,
      }) as IVergeConfig,
    )
  }

  const enhanced = await deps.enhanceProfiles()
  if (!enhanced) {
    throw new Error('enhance-failed')
  }

  try {
    await deps.selectNodeForGroup(input.exitGroup, input.nodeName)
  } catch {
    // EXIT may need one more refresh on a cold profile; rules still apply.
  }

  const hopGroup = proxyView?.groups.find(
    (item) => item.name === input.hopGroup,
  )
  if (
    hopGroup?.now &&
    (hopGroup.now === input.nodeName ||
      hopGroup.now === `${input.nodeName}-Direct`)
  ) {
    const replacement = firstLeafHop(proxyView, input.hopGroup, input.nodeName)
    if (replacement) {
      try {
        await deps.selectNodeForGroup(input.hopGroup, replacement)
      } catch {
        // Keep going; Cursor still uses EXIT.
      }
    }
  }

  return {
    profileNames: targets.map((item) => item.name || item.uid),
    nodeName: input.nodeName,
    exitGroup: input.exitGroup,
  }
}

export const revertCursorIspSetup = async (
  rawInput: Partial<CursorIspSetupInput>,
  applyAllProfiles: boolean,
  deps: CursorIspSetupDeps = defaultDeps(),
): Promise<CursorIspApplyResult> => {
  const input = normalizeSetupInput(rawInput)
  const profiles = await deps.getProfiles()
  const targets = selectableProfiles(
    profiles.items ?? [],
    applyAllProfiles,
    profiles.current,
  )
  for (const profile of targets) {
    const proxiesUid = profile.option?.proxies
    const groupsUid = profile.option?.groups
    if (!proxiesUid || !groupsUid) continue
    await saveSeq(deps, proxiesUid, (current) =>
      removeProxyEnhance(current, input.nodeName),
    )
    await saveSeq(deps, groupsUid, (current) =>
      removeGroupEnhance(current, input.exitGroup),
    )
  }
  await saveSeq(deps, GLOBAL_RULES_UID, (current) =>
    removeRuleEnhance(current, input.exitGroup),
  )
  await deps.patchVergeConfig({
    proxy_chain_nodes: [],
    proxy_chain_group: null,
  } as IVergeConfig)
  const enhanced = await deps.enhanceProfiles()
  if (!enhanced) {
    throw new Error('enhance-failed')
  }
  return {
    profileNames: targets.map((item) => item.name || item.uid),
    nodeName: input.nodeName,
    exitGroup: input.exitGroup,
  }
}

export const testCursorIspNode = async (
  nodeName: string,
  deps: CursorIspSetupDeps = defaultDeps(),
): Promise<number> => {
  const result = await deps.delayProxyByName(nodeName, TEST_URL, TEST_TIMEOUT)
  return result.delay
}
