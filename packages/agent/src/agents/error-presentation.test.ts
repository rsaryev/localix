import { describe, expect, test } from 'bun:test'

import { classifyAgentError } from './error-classification'
import { presentError, presentErrorInfo } from './error-presentation'

describe('presenting a failed run to a person', () => {
  test('a raw provider body is never the reason; it is offered only as detail', () => {
    const presented = presentError(new Error('418: {"error":{"message":"I am a teapot"}}'))
    expect(presented.reason).toBe('The run stopped on an unexpected error.')
    expect(presented.detail).toContain('teapot')
    expect(presented.severity).toBe('error')
    expect(presented.actions).toEqual([])
  })

  test('a transient failure offers Retry and never claims to be retrying', () => {
    const presented = presentError(Object.assign(new Error('fetch failed'), { code: 'ECONNRESET' }))
    expect(presented.reason).toBe('Network connection to the provider dropped.')
    expect(presented.reason).not.toContain('Retrying')
    expect(presented.actions).toEqual(['retry'])
    expect(presented.severity).toBe('warning')
  })

  test('a refused key offers to sign in to the connection, not a Retry that cannot work', () => {
    const info = classifyAgentError(
      Object.assign(new Error('provider 401: bad key'), {
        name: 'FetchError',
      }),
    )
    expect(presentErrorInfo(info, { connectionId: 'conn-1' }).actions).toEqual(['sign-in:conn-1'])
    expect(presentErrorInfo(info).actions).toEqual(['open-settings:providers'])
  })

  test('a spent plan offers the provider settings; a transient rate limit offers Retry', () => {
    const spent = presentErrorInfo({
      kind: 'fatal',
      userMessage: 'quota',
      retryable: false,
      rateLimited: true,
    })
    expect(spent.actions).toEqual(['open-settings:providers'])
    const limited = presentErrorInfo({
      kind: 'fatal',
      userMessage: 'Rate limit exceeded.',
      retryable: true,
      rateLimited: true,
    })
    expect(limited.actions).toEqual(['retry'])
  })

  test('the headline follows the wording rule and names the conversation', () => {
    const presented = presentError(new Error('x'), { conversation: 'Refactor the parser' })
    expect(presented.headline).toBe('Could not finish the reply in “Refactor the parser”')
  })
})
