import { describe, expect, test } from 'bun:test'
import { classifyAgentError } from './error-classification'

// FetchError shape the adapter throws: name === 'FetchError', message "provider <status>: …"
function fetchError(message: string): Error {
  const e = new Error(message)
  e.name = 'FetchError'
  return e
}

describe('classifyAgentError', () => {
  test('flags a 400 context-overflow distinctly (compress, not plain retry)', () => {
    const info = classifyAgentError(
      fetchError('provider 400: This model maximum context length is 128000 tokens'),
    )
    expect(info.kind).toBe('context_overflow')
    expect(info.retryable).toBe(false)
    expect(info.shouldCompress).toBe(true)
  })

  test('marks 5xx as retryable', () => {
    const info = classifyAgentError(fetchError('provider 503: upstream unavailable'))
    expect(info.retryable).toBe(true)
  })

  test('marks 429 rate-limit as retryable', () => {
    const info = classifyAgentError(fetchError('provider 429: rate limit exceeded'))
    expect(info.retryable).toBe(true)
  })

  test('marks 408 request-timeout as retryable', () => {
    expect(classifyAgentError(fetchError('provider 408: request timeout')).retryable).toBe(true)
  })

  test('a plain 4xx (e.g. 404) stays non-retryable', () => {
    expect(classifyAgentError(fetchError('provider 404: model not found')).retryable).toBe(false)
  })

  test('a plain 400 (non-context) is fatal and not compressible', () => {
    const info = classifyAgentError(fetchError('provider 400: invalid request'))
    expect(info.kind).toBe('fatal')
    expect(info.shouldCompress).toBeUndefined()
  })

  test('abort is non-retryable', () => {
    const e = new Error('aborted')
    e.name = 'AbortError'
    expect(classifyAgentError(e).retryable).toBe(false)
  })
})
