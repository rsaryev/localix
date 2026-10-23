import { describe, expect, it } from 'bun:test'
import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'

describe('errorMessage', () => {
  it('returns the Error message when given an Error', () => {
    expect(errorMessage(new Error('boom'), 'fallback')).toBe('boom')
  })

  it('preserves an empty Error message rather than substituting the fallback', () => {
    expect(errorMessage(new Error(''), 'fallback')).toBe('')
  })

  // Non-Error throws (a mini app backend rejecting with a plain object, an `{error:{message}}`
  // response body, a Bun ResolveMessage) used to render as "[object Object]" in the UI.
  it('duck-types a message out of a non-Error throw', () => {
    expect(errorMessage({ message: 'mini app exploded' }, 'fallback')).toBe('mini app exploded')
    expect(errorMessage({ error: { message: 'bad request' } }, 'fallback')).toBe('bad request')
    expect(errorMessage('a string', 'fallback')).toBe('a string')
  })

  it('falls back when nothing carries a message', () => {
    expect(errorMessage(undefined, 'fallback')).toBe('fallback')
    expect(errorMessage(null, 'fallback')).toBe('fallback')
    expect(errorMessage({}, 'fallback')).toBe('fallback')
    expect(errorMessage('', 'fallback')).toBe('fallback')
    expect(errorMessage({ message: '' }, 'fallback')).toBe('fallback')
  })
})
