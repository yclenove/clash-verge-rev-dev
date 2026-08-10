import { describe, expect, it } from 'vitest'

import {
  buildClashLogSearchText,
  shouldTranslateClashLog,
  translateClashLogPayload,
} from './translate-clash-log'

describe('translateClashLogPayload', () => {
  it('translates geodata loader mode', () => {
    expect(
      translateClashLogPayload('Geodata Loader mode: memconservative'),
    ).toBe('地理数据加载模式：内存节约 (memconservative)')
  })

  it('translates finished GeoSite rule', () => {
    expect(
      translateClashLogPayload(
        'Finished initial GeoSite rule douyin => DIRECT, records: 68',
      ),
    ).toBe('已完成 GeoSite 规则初始化：douyin => DIRECT，记录数：68')
  })

  it.each([
    [
      'Start DNS server(TCP) error: listen tcp :53: bind: permission denied',
      'DNS 服务（TCP）启动失败：listen tcp :53: bind: permission denied',
    ],
    [
      'Start DNS server(UDP) error: listen udp :53: bind: permission denied',
      'DNS 服务（UDP）启动失败：listen udp :53: bind: permission denied',
    ],
    [
      'Start DNS server error: address already in use',
      'DNS 服务启动失败：address already in use',
    ],
  ])('preserves DNS startup error details', (input, expected) => {
    expect(translateClashLogPayload(input)).toBe(expected)
  })

  it('translates only a plain DNS startup message as startup progress', () => {
    expect(translateClashLogPayload('Starting DNS server...')).toBe(
      '正在启动 DNS 服务',
    )
    expect(translateClashLogPayload('Start DNS custom diagnostic')).toBe(
      'Start DNS custom diagnostic',
    )
  })

  it('keeps unknown payloads as-is', () => {
    expect(translateClashLogPayload('Some unknown core log')).toBe(
      'Some unknown core log',
    )
  })
})

describe('shouldTranslateClashLog', () => {
  it('enables zh languages only', () => {
    expect(shouldTranslateClashLog('zh')).toBe(true)
    expect(shouldTranslateClashLog('zh-CN')).toBe(true)
    expect(shouldTranslateClashLog('en')).toBe(false)
  })
})

describe('buildClashLogSearchText', () => {
  it('includes original and translated text for zh', () => {
    const text = buildClashLogSearchText(
      {
        time: '12:00:00',
        type: 'info',
        payload: 'Geodata Loader mode: memconservative',
      },
      { language: 'zh-CN' },
    )
    expect(text).toContain('Geodata Loader mode: memconservative')
    expect(text).toContain('地理数据加载模式')
  })
})
