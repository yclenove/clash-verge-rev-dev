import { describe, expect, test } from 'vitest'

import {
  hostGroupKey,
  pathBasename,
  processGroupKey,
  resolveHostName,
  resolveProcessName,
  UNKNOWN_HOST_KEY,
  UNKNOWN_PROCESS_KEY,
} from './connection-identity'

describe('connection-identity', () => {
  test('pathBasename handles windows and posix', () => {
    expect(pathBasename('C:\\\\Windows\\\\System32\\\\curl.exe')).toBe(
      'curl.exe',
    )
    expect(pathBasename('/usr/bin/curl')).toBe('curl')
  })

  test('resolveProcessName prefers process then path basename', () => {
    expect(resolveProcessName('chrome.exe', 'C:/x/y')).toBe('chrome.exe')
    expect(resolveProcessName('', 'C:/Apps/foo.exe')).toBe('foo.exe')
    expect(resolveProcessName('C:/Apps/bar.exe', '')).toBe('bar.exe')
  })

  test('processGroupKey is case-insensitive', () => {
    expect(processGroupKey('Chrome.EXE')).toBe(processGroupKey('chrome.exe'))
    expect(processGroupKey('')).toBe(UNKNOWN_PROCESS_KEY)
  })

  test('resolveHostName priority host > destIP > remote', () => {
    expect(
      resolveHostName({
        host: 'a.com',
        destinationIP: '1.1.1.1',
        remoteDestination: 'r',
      }),
    ).toBe('a.com')
    expect(resolveHostName({ destinationIP: '1.1.1.1' })).toBe('1.1.1.1')
    expect(hostGroupKey({})).toBe(UNKNOWN_HOST_KEY)
  })
})
