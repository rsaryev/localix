import { describe, expect, test } from 'bun:test'
import path from 'node:path'
import { tempDirPerTest, writeTree } from '@localixai/testing'
import { createMemoizedLookup, resolveNpmBin } from './lsp-bin-resolve'

/**
 * `which()` is called from every LSP server definition's `spawn`, and `lsp-manager`
 * deletes the client entry when a spawn produces no handle — so a language whose server
 * is NOT installed re-resolves on every file open, and a miss is the full PATH walk.
 */
function counting(answers: Record<string, string | undefined>) {
  const calls: string[] = []
  return {
    calls,
    lookup: (cmd: string) => {
      calls.push(cmd)
      return answers[cmd]
    },
  }
}

describe('memoized PATH lookup', () => {
  test('a hit is resolved once and reused', () => {
    const { calls, lookup } = counting({ gopls: '/usr/local/bin/gopls' })
    const cache = createMemoizedLookup(lookup)
    for (let i = 0; i < 10; i += 1) expect(cache.get('gopls')).toBe('/usr/local/bin/gopls')
    expect(calls).toEqual(['gopls'])
  })

  test('a miss is not re-resolved on every call — the case that repeats per file open', () => {
    const { calls, lookup } = counting({})
    let clock = 0
    const cache = createMemoizedLookup(lookup, { negativeTtlMs: 60_000, now: () => clock })

    // Twenty opens of a .py with no server installed. Before this, each one paid the
    // synchronous child; now they pay it once.
    for (let i = 0; i < 20; i += 1) {
      expect(cache.get('pylsp')).toBeUndefined()
      clock += 500 // half a second between opens, well inside the window
    }
    expect(calls).toEqual(['pylsp'])
  })

  test('a miss expires, so installing a server mid-session starts working', () => {
    const answers: Record<string, string | undefined> = {}
    const { calls, lookup } = counting(answers)
    let clock = 0
    const cache = createMemoizedLookup(lookup, { negativeTtlMs: 60_000, now: () => clock })

    expect(cache.get('rust-analyzer')).toBeUndefined()
    clock = 59_999
    expect(cache.get('rust-analyzer')).toBeUndefined() // still inside the window
    expect(calls).toHaveLength(1)

    answers['rust-analyzer'] = '/home/u/.cargo/bin/rust-analyzer'
    clock = 60_000
    expect(cache.get('rust-analyzer')).toBe('/home/u/.cargo/bin/rust-analyzer')
    expect(calls).toHaveLength(2)

    // ...and once found it is a hit, so it stops being re-resolved even though the
    // miss entry existed a moment ago.
    clock = 10_000_000
    expect(cache.get('rust-analyzer')).toBe('/home/u/.cargo/bin/rust-analyzer')
    expect(calls).toHaveLength(2)
  })

  test('entries are per command — one miss does not answer for another', () => {
    const { calls, lookup } = counting({ gopls: '/bin/gopls' })
    const cache = createMemoizedLookup(lookup, { now: () => 0 })
    expect(cache.get('pylsp')).toBeUndefined()
    expect(cache.get('gopls')).toBe('/bin/gopls')
    expect(cache.get('pyright-langserver')).toBeUndefined()
    expect(calls).toEqual(['pylsp', 'gopls', 'pyright-langserver'])
  })
})

describe('npm language server lookup', () => {
  const dir = tempDirPerTest('lsp-bin')
  const shim = '#!/usr/bin/env node\nprocess.exit(0)\n'

  test('a managed server comes from its install, not a node_modules the opened repo ships', () => {
    const install = path.join(dir(), 'install')
    const project = path.join(dir(), 'repo')
    writeTree(dir(), {
      'install/node_modules/.bin/vtsls': shim,
      'repo/node_modules/.bin/vtsls': shim,
    })
    expect(resolveNpmBin('vtsls', project, project, install)).toBe(
      path.join(install, 'node_modules', '.bin', 'vtsls'),
    )
  })

  test('a managed server falls back to the project only while its install is missing', () => {
    const install = path.join(dir(), 'install')
    const project = path.join(dir(), 'repo')
    writeTree(dir(), { 'repo/node_modules/.bin/yaml-language-server': shim })
    expect(resolveNpmBin('yaml-language-server', project, project, install)).toBe(
      path.join(project, 'node_modules', '.bin', 'yaml-language-server'),
    )
  })

  test('lookup never climbs above the project root', () => {
    const install = path.join(dir(), 'install')
    const project = path.join(dir(), 'parent', 'repo')
    const root = path.join(project, 'packages', 'web')
    writeTree(dir(), {
      'parent/node_modules/.bin/localix-test-ls': shim,
      'parent/repo/packages/web/.keep': '',
    })
    expect(resolveNpmBin('localix-test-ls', root, project, install)).toBeUndefined()

    writeTree(dir(), { 'parent/repo/node_modules/.bin/localix-test-ls': shim })
    expect(resolveNpmBin('localix-test-ls', root, project, install)).toBe(
      path.join(project, 'node_modules', '.bin', 'localix-test-ls'),
    )
  })
})
