import { describe, expect, test } from 'bun:test'

import { slugFromCommand, splitCommandLine } from './mcpCommand'

describe('splitCommandLine', () => {
  test('splits a plain command line on whitespace', () => {
    expect(splitCommandLine('npx -y @modelcontextprotocol/server-filesystem /tmp')).toEqual([
      'npx',
      '-y',
      '@modelcontextprotocol/server-filesystem',
      '/tmp',
    ])
  })

  test('honors double and single quotes, stripping the quotes', () => {
    expect(splitCommandLine(`cmd "a b" '/path with space'`)).toEqual([
      'cmd',
      'a b',
      '/path with space',
    ])
  })

  test('collapses extra whitespace and ignores empties', () => {
    expect(splitCommandLine('  npx    foo   ')).toEqual(['npx', 'foo'])
  })

  test('returns [] for blank input', () => {
    expect(splitCommandLine('')).toEqual([])
    expect(splitCommandLine('   ')).toEqual([])
  })
})

describe('slugFromCommand', () => {
  test('uses the package basename, skipping npx/-y', () => {
    expect(slugFromCommand(['npx', '-y', '@modelcontextprotocol/server-filesystem', '/tmp'])).toBe(
      'server-filesystem',
    )
  })

  test('handles uvx and a plain package', () => {
    expect(slugFromCommand(['uvx', 'some-pkg'])).toBe('some-pkg')
  })

  test('lowercases and replaces unsafe chars with dashes', () => {
    expect(slugFromCommand(['@scope/My.Pkg@1.2'])).toBe('my-pkg-1-2')
  })

  test('falls back to the first token when only flags are present', () => {
    expect(slugFromCommand(['npx', '-y'])).toBe('npx')
  })

  test('falls back to "server" for empty input', () => {
    expect(slugFromCommand([])).toBe('server')
  })
})
