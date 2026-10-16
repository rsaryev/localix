import { describe, expect, test } from 'bun:test'

import { browserLeakMessage, failOnNodeBuiltin, isBrowserLeak } from './fail-on-node-builtin'

const UI_FILE = '/repo/apps/ui/src/features/settings/ui/agent-profile/AgentProfileTab.tsx'
const SERVER_LEAF = '/repo/apps/api/src/features/agents/policy.ts'
const VENDOR = '/repo/node_modules/some-pkg/dist/index.js'

describe('isBrowserLeak — what the web graph may not import', () => {
  test('a node builtin imported by repository code is a leak', () => {
    // The exact shape that shipped: a settings screen reaching server code that reaches the
    // plugin SDK backend, which imports node:dns.
    expect(isBrowserLeak('node:dns', SERVER_LEAF)).toBe(true)
    expect(isBrowserLeak('node:fs/promises', UI_FILE)).toBe(true)
    // Unprefixed builtins resolve the same way and must be caught the same way.
    expect(isBrowserLeak('net', SERVER_LEAF)).toBe(true)
  })

  test('the three builtins the polyfill plugin serves are not', () => {
    // This plugin runs at enforce:'pre', ahead of vite-plugin-node-polyfills — refusing these
    // would break the imports that plugin exists to satisfy.
    for (const id of ['events', 'process', 'buffer', 'node:buffer']) {
      expect(isBrowserLeak(id, UI_FILE)).toBe(false)
    }
  })

  test('a third-party package is left to the bundler', () => {
    // Their builtins are shimmed or shaken out, and failing on them would refuse a dependency
    // this repository cannot change.
    expect(isBrowserLeak('node:dns', VENDOR)).toBe(false)
  })

  test('an entry with no importer is not a leak', () => {
    expect(isBrowserLeak('node:dns', undefined)).toBe(false)
  })

  test('an ordinary module is not a leak', () => {
    expect(isBrowserLeak('react', UI_FILE)).toBe(false)
    expect(isBrowserLeak('@/shared/api/contracts', UI_FILE)).toBe(false)
  })
})

describe('the plugin', () => {
  const resolve = (id: string, importer?: string) => {
    const plugin = failOnNodeBuiltin()
    const hook = plugin.resolveId as (this: unknown, id: string, importer?: string) => unknown
    return hook.call({}, id, importer)
  }

  test('throws on a leak, and the message names the importer', () => {
    // The whole point: the runtime error React surfaces names no importer, so the build-time
    // one must. Without this the reader gets "Module node:dns has been externalized" and a
    // stack of React internals.
    expect(() => resolve('node:dns', SERVER_LEAF)).toThrow(/node:dns/)
    expect(() => resolve('node:dns', SERVER_LEAF)).toThrow(/policy\.ts/)
  })

  test('passes everything else through untouched', () => {
    // The positive control for the negative: a plugin that threw on everything would also pass
    // the test above.
    expect(resolve('react', UI_FILE)).toBeNull()
    expect(resolve('node:buffer', UI_FILE)).toBeNull()
    expect(resolve('node:dns', VENDOR)).toBeNull()
  })

  test('it runs before the polyfill plugin', () => {
    // Order is load-bearing: after the polyfill plugin, the leak is already a stub and there is
    // nothing left to refuse.
    expect(failOnNodeBuiltin().enforce).toBe('pre')
  })
})

describe('the message', () => {
  test('says what to do, not only what is wrong', () => {
    const message = browserLeakMessage('node:net', SERVER_LEAF)
    expect(message).toContain(SERVER_LEAF)
    expect(message).toContain('leaf')
    expect(message).toContain('browser-graph-guard')
  })
})
