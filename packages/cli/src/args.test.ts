import { describe, expect, it } from 'bun:test'

import { UsageError, parseArgs } from './args'

describe('parseArgs', () => {
  it('defaults to the open command with no args (the current directory)', () => {
    expect(parseArgs([])).toEqual({ command: 'open', options: {} })
  })

  it('treats a leading flag as options for the default command', () => {
    expect(parseArgs(['--new'])).toEqual({ command: 'open', options: { fresh: true } })
  })

  it('captures --help', () => {
    expect(parseArgs(['open', '--help']).options.help).toBe(true)
    expect(parseArgs(['-h']).options.help).toBe(true)
  })

  it('captures --version / -v', () => {
    expect(parseArgs(['open', '--version']).options.version).toBe(true)
    expect(parseArgs(['-v']).options.version).toBe(true)
  })

  it('routes a path-like first token to the open command', () => {
    expect(parseArgs(['.'])).toEqual({ command: 'open', options: { pathArg: '.' } })
    expect(parseArgs(['src/index.ts'])).toEqual({
      command: 'open',
      options: { pathArg: 'src/index.ts' },
    })
    expect(parseArgs(['/abs/path'])).toEqual({
      command: 'open',
      options: { pathArg: '/abs/path' },
    })
    expect(parseArgs(['~/proj'])).toEqual({ command: 'open', options: { pathArg: '~/proj' } })
  })

  it('carries open flags (new) alongside the path', () => {
    expect(parseArgs(['.', '--new'])).toEqual({
      command: 'open',
      options: { pathArg: '.', fresh: true },
    })
  })

  it('still treats open/help as commands, not paths', () => {
    expect(parseArgs(['help']).command).toBe('help')
    expect(parseArgs(['open', '/x'])).toEqual({ command: 'open', options: { pathArg: '/x' } })
  })

  it('rejects an unknown flag instead of opening something unexpected', () => {
    expect(() => parseArgs(['--nope'])).toThrow(UsageError)
    expect(() => parseArgs(['.', '--session', 'LOCALIX-3'])).toThrow(UsageError)
  })
})
