import { afterEach, describe, expect, jest, test } from 'bun:test'
import { promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { makeHelpers } from './native-helpers'

const h = makeHelpers()

describe('configNumber', () => {
  test('accepts finite numbers including 0 (no `|| default` trap)', () => {
    expect(h.configNumber(0, 5)).toBe(0)
    expect(h.configNumber(12.5, 5)).toBe(12.5)
  })
  test('parses numeric strings including "0"', () => {
    expect(h.configNumber('0', 5)).toBe(0)
    expect(h.configNumber('42', 5)).toBe(42)
  })
  test('falls back for NaN/Infinity, empty/non-numeric strings, and other types', () => {
    expect(h.configNumber(Number.NaN, 5)).toBe(5)
    expect(h.configNumber(Infinity, 5)).toBe(5)
    expect(h.configNumber('', 5)).toBe(5)
    expect(h.configNumber('abc', 5)).toBe(5)
    expect(h.configNumber(null, 5)).toBe(5)
    expect(h.configNumber(undefined, 5)).toBe(5)
  })
})

describe('configBoolean', () => {
  test('passes real booleans through, including false', () => {
    expect(h.configBoolean(true, false)).toBe(true)
    expect(h.configBoolean(false, true)).toBe(false)
  })
  test('treats only "true"/"1" strings as true', () => {
    expect(h.configBoolean('true', false)).toBe(true)
    expect(h.configBoolean('1', false)).toBe(true)
    expect(h.configBoolean('false', true)).toBe(false)
    expect(h.configBoolean('0', true)).toBe(false)
    expect(h.configBoolean('yes', true)).toBe(false)
  })
  test('falls back for non-string/boolean', () => {
    expect(h.configBoolean(null, true)).toBe(true)
    expect(h.configBoolean(1, false)).toBe(false)
  })
})

describe('configString', () => {
  test('trims a non-empty string', () => {
    expect(h.configString('  hi ', 'x')).toBe('hi')
  })
  test('falls back for empty/whitespace/non-string (default fallback is "")', () => {
    expect(h.configString('   ', 'x')).toBe('x')
    expect(h.configString('', 'x')).toBe('x')
    expect(h.configString(42, 'x')).toBe('x')
    expect(h.configString(undefined)).toBe('')
  })
})

describe('errorResult', () => {
  test('builds the standard error shape, defaulting userMessage to content', () => {
    expect(h.errorResult('boom')).toEqual({
      content: 'boom',
      isError: true,
      error: {
        kind: 'execution',
        message: 'boom',
        userMessage: 'boom',
        retryable: false,
        fatal: false,
      },
    })
  })
  test('honours explicit userMessage / retryable', () => {
    const r = h.errorResult('boom', { userMessage: 'try later', retryable: true })
    expect(r.error).toMatchObject({ userMessage: 'try later', retryable: true })
  })
})

describe('withTimeoutSignal', () => {
  afterEach(() => jest.useRealTimers())
  test('aborts when the parent signal aborts — didTimeout stays false', () => {
    const parent = new AbortController()
    const t = h.withTimeoutSignal(parent.signal, 10_000)
    expect(t.signal.aborted).toBe(false)
    parent.abort()
    expect(t.signal.aborted).toBe(true)
    expect(t.didTimeout()).toBe(false)
    t.dispose()
  })
  test('aborts on timeout — didTimeout becomes true', async () => {
    jest.useFakeTimers()
    const t = h.withTimeoutSignal(undefined, 5)
    jest.advanceTimersByTime(25)
    expect(t.signal.aborted).toBe(true)
    expect(t.didTimeout()).toBe(true)
    t.dispose()
  })
  test('dispose clears the timer so no late abort fires', async () => {
    jest.useFakeTimers()
    const parent = new AbortController()
    const t = h.withTimeoutSignal(parent.signal, 10)
    t.dispose()
    jest.advanceTimersByTime(30)
    expect(t.signal.aborted).toBe(false)
    expect(t.didTimeout()).toBe(false)
  })
})

describe('readJson / writeJson', () => {
  test('round-trips a value and creates parent dirs', async () => {
    const dir = path.join(os.tmpdir(), `localix-native-helpers-${process.pid}`)
    const file = path.join(dir, 'nested', 'state.json')
    await h.writeJson(file, { a: 1, b: ['x'] })
    // This call site used to need an explicit `readJson<{a;b} | null>` type argument, and
    // its comment explained why: "a bare `null` fallback types the SUCCESS value as null
    // too — state the union the call can actually return." That workaround WAS the bug
    // report. The success value is now honestly `unknown`, so nothing has to be asserted
    // about a file we have not looked at.
    expect(await h.readJson(file, null)).toEqual({ a: 1, b: ['x'] })
    await fsp.rm(dir, { recursive: true, force: true })
  })
  test('returns the fallback for a missing or unparsable file', async () => {
    const missing = path.join(os.tmpdir(), 'localix-native-helpers-does-not-exist.json')
    expect(await h.readJson(missing, { fallback: true })).toEqual({ fallback: true })
  })
  test('leaves no partial file behind — mini apps inherit this write, not a choice', async () => {
    // readJson+writeJson IS the whole-file read-modify-write loop the template mini app
    // teaches, so a non-atomic writeFile here hands every mini app author a store that a
    // torn save empties. Proof it goes through temp+rename: the target never exists in a
    // half state, and no temp is left lying next to it.
    const dir = path.join(os.tmpdir(), `localix-native-helpers-atomic-${process.pid}`)
    const file = path.join(dir, 'state.json')
    await h.writeJson(file, { keep: 'first' })
    await h.writeJson(file, { keep: 'second' })
    expect(await h.readJson(file, null)).toEqual({ keep: 'second' })
    expect((await fsp.readdir(dir)).sort()).toEqual(['state.json'])
    await fsp.rm(dir, { recursive: true, force: true })
  })
})

/**
 * `readJson` USED to be `readJson<T>(filePath, fallback: T): Promise<T>` — it inferred
 * `T` from the FALLBACK and then typed the `JSON.parse` SUCCESS value as it. The file on
 * disk is not the fallback, so the success value was a lie, handed to every mini app
 * author through `ctx.helpers`.
 */
describe('readJson is sound — the parsed value is whatever is on disk', () => {
  interface State {
    chats: Record<string, unknown>
  }
  const isState = (v: unknown): v is State =>
    !!v && typeof v === 'object' && !Array.isArray(v) && 'chats' in v

  test('TYPE-LEVEL: a guard-less read is `unknown`, not the fallback’s type', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mini-app-helpers-'))
    const file = path.join(dir, 'state.json')
    await h.writeJson(file, 'not an object at all')

    const loose = await h.readJson(file, { chats: {} })
    // THE LOAD-BEARING LINE. Under the old signature `loose` was typed `{chats:{}}`, so
    // `loose.chats` COMPILED — and threw at runtime on this file, which holds a string.
    // `@ts-expect-error` fails the build if the error ever disappears, so the lie cannot
    // come back. (apps/api tests are typechecked by `bun run check:tests`.)
    // @ts-expect-error — `unknown` has no properties; that is the whole point.
    void loose.chats
    expect(loose).toBe('not an object at all')
    await fsp.rm(dir, { recursive: true, force: true })
  })

  test('a type guard restores `T` SOUNDLY, and a file failing it takes the fallback path', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mini-app-helpers-'))
    const file = path.join(dir, 'state.json')

    // Corrupted / hand-edited state file: parses fine, but is not a State.
    await h.writeJson(file, [1, 2, 3])
    const bad = await h.readJson(file, { chats: {} }, isState)
    expect(bad).toEqual({ chats: {} }) // guard rejected it → fallback, same path as missing
    expect(bad.chats).toEqual({}) // compiles: narrowed to State, and now that is actually TRUE

    await h.writeJson(file, { chats: { '42': { sessionId: 's1' } } })
    const good = await h.readJson(file, { chats: {} }, isState)
    expect(good.chats['42']).toEqual({ sessionId: 's1' })

    await fsp.rm(dir, { recursive: true, force: true })
  })

  test('WITHOUT a guard, behavior is unchanged: the on-disk value is returned as-is', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mini-app-helpers-'))
    const file = path.join(dir, 'state.json')
    await h.writeJson(file, [1, 2, 3])
    // No validation is imposed on existing callers — only the TYPE got honest.
    expect(await h.readJson(file, { chats: {} })).toEqual([1, 2, 3])
    await fsp.rm(dir, { recursive: true, force: true })
  })
})
