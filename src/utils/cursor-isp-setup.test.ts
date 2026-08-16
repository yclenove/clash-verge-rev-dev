import { describe, expect, test } from 'vitest'

import {
  DEFAULT_CURSOR_ISP_SETUP,
  buildCursorIspRules,
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
} from './cursor-isp-setup'

const sample = normalizeSetupInput({
  protocol: 'http',
  server: '203.0.113.10',
  port: 6666,
  username: 'demo',
  password: 'secret',
  hopGroup: 'JMS',
  exitGroup: 'EXIT',
  nodeName: 'Thordata-ISP',
})

describe('cursor isp setup helpers', () => {
  test('rejects incomplete input', () => {
    expect(validateSetupInput(DEFAULT_CURSOR_ISP_SETUP)).toBe('server')
    expect(validateSetupInput(sample)).toBeNull()
    expect(
      validateSetupInput(normalizeSetupInput({ ...sample, port: 0 })),
    ).toBe('port')
  })

  test('merges isp nodes without dropping unrelated proxies', () => {
    const merged = mergeProxyEnhance(
      {
        prepend: [],
        append: [
          { name: 'Keep-Me', type: 'http', server: '192.0.2.1', port: 80 },
        ],
        delete: ['Old'],
      },
      sample,
    )
    expect(merged.append).toHaveLength(3)
    expect(merged.append[0]).toMatchObject({ name: 'Keep-Me' })
    expect(merged.append[1]).toMatchObject({
      name: 'Thordata-ISP',
      type: 'http',
      server: '203.0.113.10',
      port: 6666,
      username: 'demo',
      'dialer-proxy': 'JMS',
    })
    expect(merged.append[2]).toMatchObject({
      name: 'Thordata-ISP-Direct',
    })
    expect(merged.append[2]).not.toHaveProperty('dialer-proxy')
    expect(merged.delete).toEqual(['Old'])
  })

  test('replaces previous isp nodes on apply', () => {
    const first = mergeProxyEnhance(
      { prepend: [], append: [], delete: [] },
      sample,
    )
    const second = mergeProxyEnhance(
      first,
      normalizeSetupInput({ ...sample, server: '198.51.100.20', port: 8080 }),
    )
    expect(second.append).toHaveLength(2)
    expect(second.append[0]).toMatchObject({
      name: 'Thordata-ISP',
      server: '198.51.100.20',
      port: 8080,
    })
  })

  test('prepends the EXIT group and keeps other groups', () => {
    const merged = mergeGroupEnhance(
      {
        prepend: [{ name: 'OTHER', type: 'select', proxies: ['DIRECT'] }],
        append: [],
        delete: [],
      },
      sample,
    )
    expect(merged.prepend[0]).toEqual({
      name: 'EXIT',
      type: 'select',
      proxies: ['Thordata-ISP', 'Thordata-ISP-Direct', 'JMS', 'DIRECT'],
    })
    expect(merged.prepend[1]).toMatchObject({ name: 'OTHER' })
  })

  test('writes cursor rules ahead of existing global rules', () => {
    const existing = parseSeqConfig(
      "prepend:\n  - 'DOMAIN,api.example.test,JMS'\nappend: []\ndelete: []\n",
    )
    const merged = mergeRuleEnhance(existing, 'EXIT')
    expect(merged.prepend[0]).toBe('PROCESS-NAME,Cursor.exe,EXIT')
    expect(merged.prepend).toContain('DOMAIN-SUFFIX,cursor.sh,EXIT')
    expect(merged.prepend.at(-1)).toBe('DOMAIN,api.example.test,JMS')
    const again = mergeRuleEnhance(merged, 'EXIT')
    expect(
      again.prepend.filter((item) => item === 'PROCESS-NAME,Cursor.exe,EXIT'),
    ).toHaveLength(1)
  })

  test('revert only removes managed cursor/isp pieces', () => {
    const proxies = mergeProxyEnhance(
      {
        prepend: [],
        append: [
          { name: 'Keep-Me', type: 'http', server: '192.0.2.1', port: 80 },
        ],
        delete: [],
      },
      sample,
    )
    const groups = mergeGroupEnhance(
      {
        prepend: [{ name: 'OTHER', type: 'select', proxies: ['DIRECT'] }],
        append: [],
        delete: [],
      },
      sample,
    )
    const rules = mergeRuleEnhance(
      {
        prepend: ['DOMAIN,api.example.test,JMS'],
        append: [],
        delete: [],
      },
      'EXIT',
    )
    expect(removeProxyEnhance(proxies, sample.nodeName).append).toEqual([
      { name: 'Keep-Me', type: 'http', server: '192.0.2.1', port: 80 },
    ])
    expect(removeGroupEnhance(groups, sample.exitGroup).prepend).toEqual([
      { name: 'OTHER', type: 'select', proxies: ['DIRECT'] },
    ])
    expect(removeRuleEnhance(rules, 'EXIT').prepend).toEqual([
      'DOMAIN,api.example.test,JMS',
    ])
  })

  test('roundtrips yaml and extracts the chained isp node', () => {
    const dumped = dumpSeqConfig(mergeProxyEnhance(parseSeqConfig(''), sample))
    const loaded = parseSeqConfig(dumped)
    expect(extractSetupFromProxyEnhance(loaded)).toMatchObject({
      protocol: 'http',
      server: '203.0.113.10',
      port: 6666,
      username: 'demo',
      password: 'secret',
      hopGroup: 'JMS',
      nodeName: 'Thordata-ISP',
    })
  })

  test('selects remote/local profiles with enhance files', () => {
    const items = [
      {
        uid: 'usa',
        type: 'remote' as const,
        option: { proxies: 'p1', groups: 'g1' },
      },
      {
        uid: 'hk',
        type: 'remote' as const,
        option: { proxies: 'p2', groups: 'g2' },
      },
      { uid: 'Rules', type: 'merge' as const },
      { uid: 'bare', type: 'remote' as const },
    ]
    expect(selectableProfiles(items, true, 'usa')).toHaveLength(2)
    expect(
      selectableProfiles(items, false, 'usa').map((item) => item.uid),
    ).toEqual(['usa'])
  })

  test('cursor rule set covers process and ai domains', () => {
    const rules = buildCursorIspRules('EXIT')
    expect(rules).toContain('PROCESS-NAME,Cursor Helper.exe,EXIT')
    expect(rules).toContain('DOMAIN-SUFFIX,openai.com,EXIT')
    expect(rules).toContain('DOMAIN,api2.cursor.sh,EXIT')
  })
})
