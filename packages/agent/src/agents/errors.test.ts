import { describe, expect, test } from 'bun:test'
import { AgentRunError, isAgentRunError } from './errors'

describe('AgentRunError', () => {
  test('carries a code + message and is a named Error', () => {
    const e = new AgentRunError('PROVIDER_RATE_LIMITED', 'slow down')
    expect(e.code).toBe('PROVIDER_RATE_LIMITED')
    expect(e.message).toBe('slow down')
    expect(e.name).toBe('AgentRunError')
    expect(e).toBeInstanceOf(Error)
  })
})

describe('isAgentRunError', () => {
  test('true only for AgentRunError instances', () => {
    expect(isAgentRunError(new AgentRunError('NO_MODEL', 'x'))).toBe(true)
  })
  test('false for plain errors and non-errors', () => {
    expect(isAgentRunError(new Error('plain'))).toBe(false)
    expect(isAgentRunError({ code: 'NO_MODEL', name: 'AgentRunError' })).toBe(false) // shape-alike, not an instance
    expect(isAgentRunError(null)).toBe(false)
    expect(isAgentRunError('NO_MODEL')).toBe(false)
    expect(isAgentRunError(undefined)).toBe(false)
  })
})
