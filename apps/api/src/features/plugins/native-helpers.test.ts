import { describe, expect, test } from 'bun:test'
import { promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { makeHelpers } from './native-helpers'

const h = makeHelpers()
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

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
    const t = h.withTimeoutSignal(undefined, 5)
    await sleep(25)
    expect(t.signal.aborted).toBe(true)
    expect(t.didTimeout()).toBe(true)
    t.dispose()
  })
  test('dispose clears the timer so no late abort fires', async () => {
    const parent = new AbortController()
    const t = h.withTimeoutSignal(parent.signal, 10)
    t.dispose()
    await sleep(30)
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
  test('leaves no partial file behind — plugins inherit this write, not a choice', async () => {
    // readJson+writeJson IS the whole-file read-modify-write loop the template plugin
    // teaches, so a non-atomic writeFile here hands every plugin author a store that a
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
