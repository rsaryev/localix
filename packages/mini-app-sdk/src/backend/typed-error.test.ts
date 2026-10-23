import { describe, expect, test } from 'bun:test'

import { defineTypedError, type TypedErrorInfo } from './typed-error'

type DemoCode = 'engine_unavailable' | 'not_found' | 'engine_error'

const FRIENDLY: Record<DemoCode, string> = {
  engine_unavailable: 'The engine is not available.',
  not_found: 'No such object.',
  engine_error: 'The engine returned an error.',
}

const kit = defineTypedError<DemoCode>('DemoError', FRIENDLY)
const DemoError = kit.DomainError

/**
 * A representative hand-rolled plugin error adapter, preserved verbatim. The factory
 * must be indistinguishable from it — a subsystem that adopts the factory must not have a
 * single observable behaviour change.
 */
class HandRolled extends Error {
  readonly code: DemoCode
  readonly friendly: string
  constructor(code: DemoCode, message?: string, options?: { cause?: unknown }) {
    super(message ?? FRIENDLY[code])
    this.name = 'DemoError'
    this.code = code
    this.friendly = FRIENDLY[code]
    if (options?.cause !== undefined) this.cause = options.cause
  }
}
function handRolledToErrorInfo(err: HandRolled): TypedErrorInfo<DemoCode> {
  return {
    code: err.code,
    message: err.friendly,
    detail: err.message === err.friendly ? undefined : err.message,
  }
}

describe('defineTypedError prerequisite', () => {
  test('a prerequisite rides the wire payload so the UI can offer Install / Start', () => {
    const prerequisite = { id: 'docker', name: 'Docker', state: 'stopped' as const }
    const info = kit.toErrorInfo(new DemoError('engine_unavailable', 'raw', { prerequisite }))
    expect(info.prerequisite).toEqual(prerequisite)
  })

  test('absent, the payload has no such key at all', () => {
    expect('prerequisite' in kit.toErrorInfo(new DemoError('not_found'))).toBe(false)
  })
})

describe('defineTypedError', () => {
  test("is a REAL class, so a domain mapper's `err instanceof X` short-circuit still works", () => {
    const err = new DemoError('not_found')
    expect(err).toBeInstanceOf(DemoError)
    expect(err).toBeInstanceOf(Error)
    expect(new Error('nope')).not.toBeInstanceOf(DemoError)
  })

  test('message defaults to the friendly sentence; a raw message overrides it', () => {
    expect(new DemoError('not_found').message).toBe('No such object.')
    expect(new DemoError('not_found', 'Error: No such container: abc').message).toBe(
      'Error: No such container: abc',
    )
    // `friendly` is always the sentence, whatever `message` holds.
    expect(new DemoError('not_found', 'raw').friendly).toBe('No such object.')
  })

  test('name + cause are carried', () => {
    const cause = new Error('root')
    const err = new DemoError('engine_error', 'raw', { cause })
    expect(err.name).toBe('DemoError')
    expect(err.cause).toBe(cause)
    // No `cause` option → the property is not set at all (not `undefined`-valued).
    expect('cause' in new DemoError('engine_error')).toBe(false)
  })

  test('toErrorInfo DROPS `detail` when the raw text is just the friendly sentence echoed', () => {
    expect(kit.toErrorInfo(new DemoError('not_found'))).toEqual({
      code: 'not_found',
      message: 'No such object.',
      detail: undefined,
    })
    expect(kit.toErrorInfo(new DemoError('not_found', 'No such container: abc'))).toEqual({
      code: 'not_found',
      message: 'No such object.',
      detail: 'No such container: abc',
    })
  })

  test('matches the hand-rolled original it replaces, for every code × message shape', () => {
    for (const code of Object.keys(FRIENDLY) as DemoCode[]) {
      for (const message of [undefined, 'raw engine text', FRIENDLY[code]]) {
        const made = new DemoError(code, message)
        const hand = new HandRolled(code, message)
        expect(made.message).toBe(hand.message)
        expect(made.name).toBe(hand.name)
        expect(made.code).toBe(hand.code)
        expect(made.friendly).toBe(hand.friendly)
        expect(kit.toErrorInfo(made)).toEqual(handRolledToErrorInfo(hand))
      }
    }
  })

  test('rawOf: an Error gives its message, a string gives itself, nullish gives EMPTY', () => {
    expect(kit.rawOf(new Error('boom'))).toBe('boom')
    expect(kit.rawOf('boom')).toBe('boom')
    expect(kit.rawOf(404)).toBe('404')
    // Nullish → '' so that `rawOf(err) || undefined` falls back to the friendly sentence
    // rather than showing an operator the literal word "null".
    expect(kit.rawOf(null)).toBe('')
    expect(kit.rawOf(undefined)).toBe('')
  })

  test('two domains built from the factory do not share an error identity', () => {
    const other = defineTypedError<'x'>('OtherError', { x: 'x' })
    expect(new other.DomainError('x')).not.toBeInstanceOf(DemoError)
    expect(new DemoError('not_found')).not.toBeInstanceOf(other.DomainError)
  })
})
