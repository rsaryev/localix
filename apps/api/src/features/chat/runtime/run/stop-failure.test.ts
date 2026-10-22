import { describe, expect, test } from 'bun:test'
import { AgentRunError, type AgentErrorInfo } from '@localixai/agent/agents'

import { INERT_CC_HOOKS, type CcHooksRuntime } from '../../../cc-hooks'
import { fireStopFailure, stopFailureType } from './stop-failure'

const info = (over: Partial<AgentErrorInfo>): AgentErrorInfo => ({
  kind: 'fatal',
  userMessage: 'API Error',
  retryable: false,
  ...over,
})

describe('StopFailure error types', () => {
  test('the classification maps onto Claude Code error types', () => {
    expect(stopFailureType(info({ rateLimited: true, retryable: true }), null)).toBe('rate_limit')
    expect(stopFailureType(info({ rateLimited: true }), null)).toBe('billing_error')
    expect(stopFailureType(info({ authFailed: true }), null)).toBe('authentication_failed')
    expect(stopFailureType(info({ kind: 'context_overflow' }), null)).toBe('invalid_request')
    expect(
      stopFailureType(info({}), new AgentRunError('PROVIDER_INSUFFICIENT_CREDITS', 'no credit')),
    ).toBe('billing_error')
    expect(stopFailureType(info({}), { statusCode: 529 })).toBe('overloaded')
    expect(stopFailureType(info({}), { statusCode: 503 })).toBe('server_error')
    expect(stopFailureType(info({}), new Error('odd'))).toBe('unknown')
  })

  test('fires for a final failure, never for a stop the person made', async () => {
    const fired: unknown[] = []
    const hooks: CcHooksRuntime = {
      ...INERT_CC_HOOKS,
      active: true,
      runStopFailure: async (failure) => void fired.push(failure),
    }
    fireStopFailure(hooks, info({ rateLimited: true, retryable: true }), null, false)
    fireStopFailure(hooks, info({}), null, true)
    fireStopFailure(hooks, info({ kind: 'abort' }), null, false)
    await Promise.resolve()
    expect(fired).toEqual([{ error: 'rate_limit', message: 'API Error' }])
  })
})
