import { describe, it, expect } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { makeHelpers } from './native-helpers'

const helpers = makeHelpers()

describe('plugin ctx.helpers', () => {
  it('configNumber coerces without the || trap', () => {
    expect(helpers.configNumber(7, 1)).toBe(7)
    expect(helpers.configNumber('7', 1)).toBe(7)
    expect(helpers.configNumber(0, 1)).toBe(0)
    expect(helpers.configNumber('0', 1)).toBe(0)
    expect(helpers.configNumber('', 1)).toBe(1)
    expect(helpers.configNumber('abc', 1)).toBe(1)
    expect(helpers.configNumber(undefined, 1)).toBe(1)
  })

  it('configBoolean accepts "true"/"1" strings', () => {
    expect(helpers.configBoolean(true, false)).toBe(true)
    expect(helpers.configBoolean('true', false)).toBe(true)
    expect(helpers.configBoolean('1', false)).toBe(true)
    expect(helpers.configBoolean('false', true)).toBe(false)
    expect(helpers.configBoolean(undefined, true)).toBe(true)
  })

  it('configString trims and falls back on empty', () => {
    expect(helpers.configString('  x  ')).toBe('x')
    expect(helpers.configString('', 'd')).toBe('d')
    expect(helpers.configString(42, 'd')).toBe('d')
    expect(helpers.configString(undefined)).toBe('')
  })

  it('errorResult builds the standard error shape', () => {
    const r = helpers.errorResult('boom', { userMessage: 'short', retryable: true })
    expect(r.isError).toBe(true)
    expect(r.content).toBe('boom')
    expect(r.error).toMatchObject({
      kind: 'execution',
      message: 'boom',
      userMessage: 'short',
      retryable: true,
      fatal: false,
    })
    // defaults
    expect(helpers.errorResult('x').error).toMatchObject({ userMessage: 'x', retryable: false })
  })

  it('withTimeoutSignal aborts on timeout and reports didTimeout', async () => {
    const t = helpers.withTimeoutSignal(undefined, 10)
    expect(t.signal.aborted).toBe(false)
    await new Promise((r) => setTimeout(r, 30))
    expect(t.signal.aborted).toBe(true)
    expect(t.didTimeout()).toBe(true)
    t.dispose()
  })

  it('withTimeoutSignal follows the parent abort (not a timeout)', () => {
    const parent = new AbortController()
    const t = helpers.withTimeoutSignal(parent.signal, 10_000)
    parent.abort()
    expect(t.signal.aborted).toBe(true)
    expect(t.didTimeout()).toBe(false)
    t.dispose()
  })

  it('readJson/writeJson round-trip and fall back on a missing file', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'plugin-helpers-'))
    const file = join(dir, 'nested', 'state.json')
    expect(await helpers.readJson(file, { fresh: true })).toEqual({ fresh: true })
    await helpers.writeJson(file, { chats: { '42': { sessionId: 's1' } } })
    expect(await helpers.readJson(file, {})).toEqual({ chats: { '42': { sessionId: 's1' } } })
    await fs.rm(dir, { recursive: true, force: true })
  })

  /**
   * `readJson` USED to be `readJson<T>(filePath, fallback: T): Promise<T>` — it inferred
   * `T` from the FALLBACK and then typed the `JSON.parse` SUCCESS value as it. The file on
   * disk is not the fallback, so the success value was a lie, handed to every plugin
   * author through `ctx.helpers`.
   */
  describe('readJson is sound — the parsed value is whatever is on disk', () => {
    interface State {
      chats: Record<string, unknown>
    }
    const isState = (v: unknown): v is State =>
      !!v && typeof v === 'object' && !Array.isArray(v) && 'chats' in v

    it('TYPE-LEVEL: a guard-less read is `unknown`, not the fallback’s type', async () => {
      const dir = await fs.mkdtemp(join(tmpdir(), 'plugin-helpers-'))
      const file = join(dir, 'state.json')
      await helpers.writeJson(file, 'not an object at all')

      const loose = await helpers.readJson(file, { chats: {} })
      // THE LOAD-BEARING LINE. Under the old signature `loose` was typed `{chats:{}}`, so
      // `loose.chats` COMPILED — and threw at runtime on this file, which holds a string.
      // `@ts-expect-error` fails the build if the error ever disappears, so the lie cannot
      // come back. (apps/api tests are typechecked by `bun run check:tests`.)
      // @ts-expect-error — `unknown` has no properties; that is the whole point.
      void loose.chats
      expect(loose).toBe('not an object at all')
      await fs.rm(dir, { recursive: true, force: true })
    })

    it('a type guard restores `T` SOUNDLY, and a file failing it takes the fallback path', async () => {
      const dir = await fs.mkdtemp(join(tmpdir(), 'plugin-helpers-'))
      const file = join(dir, 'state.json')

      // Corrupted / hand-edited state file: parses fine, but is not a State.
      await helpers.writeJson(file, [1, 2, 3])
      const bad = await helpers.readJson(file, { chats: {} }, isState)
      expect(bad).toEqual({ chats: {} }) // guard rejected it → fallback, same path as missing
      expect(bad.chats).toEqual({}) // compiles: narrowed to State, and now that is actually TRUE

      await helpers.writeJson(file, { chats: { '42': { sessionId: 's1' } } })
      const good = await helpers.readJson(file, { chats: {} }, isState)
      expect(good.chats['42']).toEqual({ sessionId: 's1' })

      await fs.rm(dir, { recursive: true, force: true })
    })

    it('WITHOUT a guard, behavior is unchanged: the on-disk value is returned as-is', async () => {
      const dir = await fs.mkdtemp(join(tmpdir(), 'plugin-helpers-'))
      const file = join(dir, 'state.json')
      await helpers.writeJson(file, [1, 2, 3])
      // No validation is imposed on existing callers — only the TYPE got honest.
      expect(await helpers.readJson(file, { chats: {} })).toEqual([1, 2, 3])
      await fs.rm(dir, { recursive: true, force: true })
    })
  })
})
