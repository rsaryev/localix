import { expect, test } from 'bun:test'
import { failedCompletion, usageOf } from './mods-model'

test('a provider’s failure is an api-error with its status and kind, never its text', () => {
  const overloaded = Object.assign(new Error('Overloaded: secret body'), { status: 529 })
  expect(failedCompletion(overloaded)).toEqual({
    isAnswered: false,
    reason: 'api-error',
    status: 529,
    error: 'overloaded',
    usage: usageOf(null),
  })
  expect(failedCompletion(new Error('socket hang up'))).toMatchObject({
    status: null,
    error: 'unknown',
  })
  expect(failedCompletion(Object.assign(new Error('x'), { status: 429 }))).toMatchObject({
    error: 'rate_limit',
  })
})

test('a call its signal cut is aborted', () => {
  const stop = new AbortController()
  stop.abort()
  expect(failedCompletion(new Error('aborted'), stop.signal)).toMatchObject({ reason: 'aborted' })
})
