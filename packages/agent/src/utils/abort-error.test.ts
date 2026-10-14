import { describe, expect, test } from 'bun:test'
import { makeAbortError } from './abort-error'

describe('makeAbortError', () => {
  test('produces an Error named "AbortError" (the name-based detection contract)', () => {
    const err = makeAbortError()
    expect(err).toBeInstanceOf(Error)
    // Consumers (openai-completions, error-classification) match aborts on this
    // exact name — changing it would silently break abort detection.
    expect(err.name).toBe('AbortError')
    expect(err.message).toBe('Aborted')
  })

  test('matches the consumer detection predicate', () => {
    const err: unknown = makeAbortError()
    expect(err instanceof Error && err.name === 'AbortError').toBe(true)
  })

  test('returns a fresh instance each call (per-throw stack)', () => {
    expect(makeAbortError()).not.toBe(makeAbortError())
  })
})
