import { describe, expect, test, vi } from 'vitest'

import { parseSeqConfig } from '@/utils/cursor-isp-setup'

import {
  applyCursorIspSetup,
  revertCursorIspSetup,
  type CursorIspSetupDeps,
} from './cursor-isp-setup'

const files = new Map<string, string>()

const deps = (): CursorIspSetupDeps => ({
  getProfiles: async () => ({
    current: 'usa',
    items: [
      {
        uid: 'usa',
        type: 'remote',
        name: 'USA',
        option: { proxies: 'p-usa', groups: 'g-usa' },
      },
      {
        uid: 'hk',
        type: 'remote',
        name: 'HK',
        option: { proxies: 'p-hk', groups: 'g-hk' },
      },
    ],
  }),
  readProfileFile: async (index) => files.get(index) ?? '',
  saveProfileFile: async (index, fileData) => {
    files.set(index, fileData)
    return true
  },
  enhanceProfiles: async () => true,
  patchVergeConfig: vi.fn(async () => undefined),
  selectNodeForGroup: vi.fn(async () => undefined),
  delayProxyByName: vi.fn(async () => ({ delay: 321 })),
})

describe('cursor isp setup service', () => {
  test('applies proxies, groups and global rules then clears chain mode', async () => {
    files.clear()
    files.set(
      'Rules',
      "prepend:\n  - 'DOMAIN,api.example.test,JMS'\nappend: []\ndelete: []\n",
    )
    const used = deps()
    const result = await applyCursorIspSetup(
      {
        protocol: 'http',
        server: '203.0.113.10',
        port: 6666,
        username: 'demo',
        password: 'secret',
        hopGroup: 'JMS',
        exitGroup: 'EXIT',
        nodeName: 'Thordata-ISP',
      },
      {
        applyAllProfiles: true,
        enableSystemProxy: true,
        enableTunMode: true,
        enableGlobalChain: false,
      },
      undefined,
      used,
    )
    expect(result.profileNames).toEqual(['USA', 'HK'])
    const usaProxies = parseSeqConfig(files.get('p-usa'))
    expect(usaProxies.append[0]).toMatchObject({
      name: 'Thordata-ISP',
      'dialer-proxy': 'JMS',
    })
    const rules = parseSeqConfig(files.get('Rules'))
    expect(rules.prepend[0]).toBe('PROCESS-NAME,Cursor.exe,EXIT')
    expect(rules.prepend).toContain('DOMAIN,api.example.test,JMS')
    expect(used.patchVergeConfig).toHaveBeenCalledWith({
      proxy_chain_nodes: [],
      proxy_chain_group: null,
      enable_system_proxy: true,
      enable_tun_mode: true,
    })
    expect(used.selectNodeForGroup).toHaveBeenCalledWith('EXIT', 'Thordata-ISP')
  })

  test('revert removes only the managed cursor/isp pieces', async () => {
    files.clear()
    const used = deps()
    await applyCursorIspSetup(
      {
        protocol: 'http',
        server: '203.0.113.10',
        port: 6666,
        username: 'demo',
        password: 'secret',
        hopGroup: 'JMS',
        exitGroup: 'EXIT',
        nodeName: 'Thordata-ISP',
      },
      {
        applyAllProfiles: false,
        enableSystemProxy: false,
        enableTunMode: false,
        enableGlobalChain: false,
      },
      undefined,
      used,
    )
    await revertCursorIspSetup(
      {
        hopGroup: 'JMS',
        exitGroup: 'EXIT',
        nodeName: 'Thordata-ISP',
      },
      false,
      used,
    )
    expect(parseSeqConfig(files.get('p-usa')).append).toEqual([])
    expect(parseSeqConfig(files.get('g-usa')).prepend).toEqual([])
    expect(parseSeqConfig(files.get('Rules')).prepend).toEqual([])
    expect(files.has('p-hk')).toBe(false)
  })
})
