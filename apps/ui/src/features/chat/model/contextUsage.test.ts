import { describe, expect, test } from 'bun:test'
import { contextAttemptFromMessage } from './contextUsage'

describe('context attempt diagnostics', () => {
  test('prefers an explicit preflight estimate over stale or missing provider usage', () => {
    expect(
      contextAttemptFromMessage({
        id: 'a1',
        dataParts: [
          {
            type: 'data-context-attempt' as never,
            data: {
              outcome: 'failed',
              stage: 'preflight',
              contextTokens: 232_388,
              tokenKind: 'estimated',
            },
          },
        ],
      }),
    ).toEqual({
      messageId: 'a1',
      outcome: 'failed',
      stage: 'preflight',
      contextTokens: 232_388,
      tokenKind: 'estimated',
    })
  })

  test('never infers a failure or token count from assistant prose', () => {
    expect(contextAttemptFromMessage({ id: 'a1' })).toEqual({
      messageId: 'a1',
      outcome: 'unknown',
      stage: 'unknown',
      tokenKind: 'unknown',
    })
  })

  test('rejects malformed diagnostics instead of displaying untrusted numbers', () => {
    expect(
      contextAttemptFromMessage({
        id: 'a1',
        dataParts: [
          {
            type: 'data-context-attempt' as never,
            data: {
              outcome: 'failed',
              stage: 'preflight',
              contextTokens: -1,
              tokenKind: 'estimated',
            },
          },
        ],
      }),
    ).toEqual({
      messageId: 'a1',
      outcome: 'unknown',
      stage: 'unknown',
      tokenKind: 'unknown',
    })
  })
})
