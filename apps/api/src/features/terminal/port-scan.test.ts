import { describe, expect, test } from 'bun:test'
import { parseLsofListeners, parseLsofCwds, parseProcNetTcp, isSameOrDescendant } from './port-scan'

describe('parseLsofListeners (-F pcn)', () => {
  test('groups n-lines under their p-line process', () => {
    const out = `p5123\ncnode\nn127.0.0.1:5173\np6001\ncpython3\nn*:8000\nn[::1]:8000\n`
    expect(parseLsofListeners(out)).toEqual([
      { pid: 5123, port: 5173 },
      { pid: 6001, port: 8000 },
      { pid: 6001, port: 8000 },
    ])
  })

  test('ignores lines with no port', () => {
    expect(parseLsofListeners('p1\ncfoo\n')).toEqual([])
  })
})

describe('parseLsofCwds (-Fn)', () => {
  test('maps pid → cwd', () => {
    const out = `p5123\nn/Users/me/repo\np6001\nn/Users/me/other\n`
    const map = parseLsofCwds(out)
    expect(map.get(5123)).toBe('/Users/me/repo')
    expect(map.get(6001)).toBe('/Users/me/other')
  })
})

describe('parseProcNetTcp', () => {
  test('keeps only LISTEN (0A) sockets and decodes the hex port', () => {
    // 0100007F:1F90 = 127.0.0.1:6160 ... but 1F90 hex = 8080. State 0A = LISTEN.
    const content = [
      '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode',
      '   0: 0100007F:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000  0 987654 1 0000 100 0 0 10 0',
      '   1: 0100007F:C000 0200000A:1538 01 00000000:00000000 00:00000000 00000000  1000  0 111111 1 0000 100 0 0 10 0',
    ].join('\n')
    expect(parseProcNetTcp(content)).toEqual([{ port: 0x1f90, inode: 987654 }])
  })
})

describe('isSameOrDescendant', () => {
  test('same path', () => {
    expect(isSameOrDescendant('/repo', '/repo')).toBe(true)
  })
  test('nested under base', () => {
    expect(isSameOrDescendant('/repo/apps/web', '/repo')).toBe(true)
  })
  test('sibling / outside is not a descendant', () => {
    expect(isSameOrDescendant('/other', '/repo')).toBe(false)
    expect(isSameOrDescendant('/repo-2', '/repo')).toBe(false)
  })
})
