import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'

import { createMiniAppSharedModules, SDK_SHARED_MODULES } from './miniAppSharedModules'

/** SDK entries that never belong in a browser artifact: server code, test doubles, the contract. */
const NOT_SHARED = new Set([
  './backend',
  './manifest',
  './app-manifest',
  // The store media rules the host checks when it packs, serves or authors an app's icon.
  './manifest-media',
  './ui/testing',
  './ui-artifact',
])

describe('mini app shared modules', () => {
  test('the host provides every browser-side SDK entry, and nothing the SDK does not export', () => {
    const pkg = JSON.parse(
      readFileSync(
        new URL('../../../../packages/mini-app-sdk/package.json', import.meta.url),
        'utf8',
      ),
    ) as { exports: Record<string, unknown> }
    const expected = Object.keys(pkg.exports)
      .filter((subpath) => !NOT_SHARED.has(subpath))
      .map((subpath) => `@localixai/mini-app-sdk/${subpath.slice(2)}`)
      .sort()
    expect(Object.keys(SDK_SHARED_MODULES).sort()).toEqual(expected)
  })

  // `@localixai/kit/<id>` is served from two directories, a door of the package or a module the
  // host lends. An id in both would be two modules under one name, and which one a mini app got
  // would depend on the order the registry spread them in — so an id has exactly one provider.
  test('no kit id is both a package door and a host-lent module', () => {
    const ids = (dir: string) =>
      readdirSync(new URL(dir, import.meta.url))
        .filter((name) => name.endsWith('.ts'))
        .map((name) => name.slice(0, -3))
    const doors = new Set(ids('../../../../packages/kit/src/entries/'))
    const lent = ids('./kit/')
    expect(doors.size).toBeGreaterThan(0)
    expect(lent.filter((id) => doors.has(id))).toEqual([])
  })

  test('loads a module once and hands every artifact the same instance', async () => {
    let loads = 0
    const instance = { value: 1 }
    const shared = createMiniAppSharedModules({
      react: async () => {
        loads += 1
        return instance
      },
    })
    const [first, second] = await Promise.all([shared.load('react'), shared.load('react')])
    expect(first).toBe(instance)
    expect(second).toBe(instance)
    expect(loads).toBe(1)
  })

  test('reads preloaded modules synchronously, and refuses a synchronous read of anything else', async () => {
    const react = { useState: () => null }
    const shared = createMiniAppSharedModules({
      react: async () => react,
      'react/jsx-runtime': async () => ({}),
      'react-dom': async () => ({}),
      'react-dom/client': async () => ({}),
      '@localixai/kit/button': async () => ({}),
    })
    expect(() => shared.require('react')).toThrow('before the host loaded it')
    await shared.load('react')
    expect(shared.require('react')).toBe(react)
    // Loaded or not, a lazily-loaded module is never readable synchronously before it loads.
    expect(() => shared.require('@localixai/kit/button')).toThrow('before the host loaded it')
    expect(() => shared.require('zustand')).toThrow('"zustand"')
  })

  test('refuses what is not shared, naming the specifier, and retries a failed load', async () => {
    let attempts = 0
    const shared = createMiniAppSharedModules({
      '@localixai/kit/button': async () => {
        attempts += 1
        if (attempts === 1) throw new Error('chunk failed')
        return {}
      },
      zustand: async () => ({}),
    })
    await expect(shared.load('zustand')).rejects.toThrow('"zustand"')
    await expect(shared.load('@localixai/kit/missing')).rejects.toThrow('"@localixai/kit/missing"')
    await expect(shared.load('@localixai/kit/button')).rejects.toThrow('chunk failed')
    await expect(shared.load('@localixai/kit/button')).resolves.toEqual({})
  })
})

/**
 * A mini app chunk paused at `await host.load(...)` must never be resumed once its page is gone:
 * WebKit resumes it in the detached document without running it and spins forever, freezing the
 * page that replaced it (see `pageLifetime`). So after `pagehide` no load settles — not the ones
 * already pending, not new ones, and not a failure either (a rejection resumes the module too).
 */
describe('shared module loads after the page is hidden', () => {
  const settledWithin = async (promise: Promise<unknown>, ms = 20) => {
    let settled = false
    void promise.then(
      () => (settled = true),
      () => (settled = true),
    )
    await new Promise((resolve) => setTimeout(resolve, ms))
    return settled
  }
  const lifetime = () => {
    let alive = true
    return { alive: () => alive, hide: () => (alive = false) }
  }

  test('a load pending at pagehide never settles, resolved or rejected', async () => {
    const page = lifetime()
    let resolveKit: (module: Record<string, unknown>) => void = () => {}
    let rejectKit: (error: Error) => void = () => {}
    const shared = createMiniAppSharedModules(
      {
        '@localixai/kit/button': () => new Promise((resolve) => (resolveKit = resolve)),
        '@localixai/kit/dialog': () => new Promise((_, reject) => (rejectKit = reject)),
      },
      page,
    )
    const resolved = shared.load('@localixai/kit/button')
    const rejected = shared.load('@localixai/kit/dialog')
    page.hide()
    resolveKit({})
    rejectKit(new Error('navigation cancelled the chunk'))
    expect(await settledWithin(resolved)).toBe(false)
    expect(await settledWithin(rejected)).toBe(false)
  })

  test('a load started after pagehide never settles either', async () => {
    const page = lifetime()
    const shared = createMiniAppSharedModules({ '@localixai/kit/button': async () => ({}) }, page)
    page.hide()
    expect(await settledWithin(shared.load('@localixai/kit/button'))).toBe(false)
  })

  test('the guard is not a stall: a live page loads as before', async () => {
    const page = lifetime()
    const shared = createMiniAppSharedModules({ '@localixai/kit/button': async () => ({}) }, page)
    expect(await settledWithin(shared.load('@localixai/kit/button'))).toBe(true)
  })
})
