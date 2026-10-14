import { expect, test } from 'bun:test'
import { classifyAgentError } from './error-classification'
import { AgentRunError } from './errors'

function nestedNetworkFailure(wrappers: number): Error {
  let cause: unknown = { code: 'ECONNRESET' }
  for (let i = 0; i < wrappers; i += 1) {
    cause = new Error('ordinary failure', { cause })
  }
  return cause as Error
}

test('network evidence is bounded to the first five objects in the cause chain', () => {
  expect(classifyAgentError(nestedNetworkFailure(4)).retryable).toBe(true)
  expect(classifyAgentError(nestedNetworkFailure(5)).retryable).toBe(false)
  const cyclic = new Error('ordinary failure')
  cyclic.cause = cyclic
  expect(classifyAgentError(cyclic).retryable).toBe(false)
})

test('typed and named errors keep precedence over network causes', () => {
  const cause = { code: 'ECONNRESET' }
  const provider = new Error('provider 401: refused', { cause })
  provider.name = 'FetchError'
  expect(classifyAgentError(provider)).toMatchObject({ retryable: false, authFailed: true })
  const unavailable = new AgentRunError('NO_MODEL', 'no model')
  unavailable.cause = cause
  expect(classifyAgentError(unavailable).retryable).toBe(false)
  const deadline = new Error('fetch failed', { cause })
  deadline.name = 'DeadlineExceededError'
  expect(classifyAgentError(deadline)).toMatchObject({
    retryable: false,
    userMessage: 'Error: fetch failed',
  })
})
