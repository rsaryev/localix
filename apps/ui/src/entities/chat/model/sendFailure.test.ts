/**
 * The composer clears on Enter and the optimistic rows are dropped when a send
 * rejects, so this is the ONLY thing standing between a failed send and a
 * message that appears and then silently vanishes.
 *
 * These assertions used to require the cause GLUED into the sentence
 * (`Message not sent: Failed to fetch`). It is still carried, as `detail`.
 */
import { describe, expect, test } from 'bun:test'
import { sendFailure } from './sendFailure'

describe('sendFailure', () => {
  test('carries the cause — "check your connection" beats "something happened"', () => {
    expect(sendFailure(new Error('Failed to fetch')).detail).toBe('Failed to fetch')
  })

  test('an Error with an empty message carries no detail at all', () => {
    expect(sendFailure(new Error('')).detail).toBeUndefined()
    expect(sendFailure(new Error('   ')).detail).toBeUndefined()
  })

  test('a non-Error throw still produces a sentence', () => {
    // A rejected fetch can throw anything; the user must still be told.
    for (const thrown of ['boom', 42, null, undefined, { code: 500 }]) {
      expect(sendFailure(thrown).message).toBe('Could not send the message')
      expect(sendFailure(thrown).detail).toBeUndefined()
    }
  })

  test('it always states the outcome, never only the cause', () => {
    // The user needs to know the message did NOT go — the detail is secondary.
    expect(sendFailure(new Error('Failed to fetch')).message).toBe('Could not send the message')
  })
})
