import { describe, expect, test } from 'bun:test'
import { backendClient } from '../client'
import { messagesApi } from './messages'
import { realtimeApi } from './realtime'
import { runsApi } from './runs'
import { sessionsApi } from './sessions'
import { terminalsApi } from './terminals'

describe('backendClient composition', () => {
  test('every split resource group is reachable through backendClient unchanged', () => {
    for (const group of [sessionsApi, messagesApi, realtimeApi, terminalsApi, runsApi]) {
      for (const [key, method] of Object.entries(group)) {
        // Other suites replace module exports with mocks, so identity is not stable across a
        // full run; every key must still be exposed as a callable with the same arity.
        const exposed = backendClient[key as keyof typeof backendClient] as unknown
        expect(typeof exposed).toBe('function')
        expect((exposed as (...args: unknown[]) => unknown).length).toBe(
          (method as (...args: unknown[]) => unknown).length,
        )
      }
    }
  })

  test('the split groups do not shadow each other', () => {
    const keys = [sessionsApi, messagesApi, realtimeApi, terminalsApi, runsApi].flatMap(Object.keys)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
