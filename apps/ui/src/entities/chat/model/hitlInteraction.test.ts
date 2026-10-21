import { describe, expect, test } from 'bun:test'

import { backendClient } from '@/shared/api/client'
import { fromHitlRequest, recoverInactiveHitlSession } from './hitlInteraction'
import { useChatStore } from './store'

const event = (request: Record<string, unknown>): unknown => request

describe('fromHitlRequest', () => {
  test('preserves the original deadline on every kind answered from the inbox', () => {
    for (const kind of ['ask', 'confirm', 'config_change', 'request_secret']) {
      const mapped = fromHitlRequest({
        requestId: 'r1',
        kind,
        payload: {},
        expiresAt: 1_800_000_000_000,
      })
      expect(mapped?.request.expiresAt).toBe(1_800_000_000_000)
    }
  })
  test('maps an ask request to the UI shape', () => {
    const mapped = fromHitlRequest(
      event({ requestId: 'r1', kind: 'ask', title: 'Pick', payload: { questions: [] } }),
    )
    expect(mapped).toMatchObject({
      kind: 'ask',
      request: { id: 'r1', kind: 'ask', title: 'Pick' },
    })
  })

  test('maps a typed request_secret request while the value never exists here', () => {
    const payload = {
      action: 'create' as const,
      key: 'OPENROUTER_KEY',
      reason: 'To call the OpenRouter API',
      type: 'api_key' as const,
      tags: ['provider'],
    }
    const mapped = fromHitlRequest(
      event({
        requestId: 'r2',
        kind: 'request_secret',
        title: 'Secret needed',
        payload,
      }),
    )
    expect(mapped).toEqual({
      kind: 'request_secret',
      request: {
        id: 'r2',
        kind: 'request_secret',
        title: 'Secret needed',
        payload,
      },
    })
    // The REQUEST leg is value-free by construction: the mapped payload carries
    // exactly what the server sent (metadata only) and no `value` slot.
    expect(mapped && 'value' in mapped.request.payload).toBe(false)
  })

  test('returns null for a kind this client cannot render', () => {
    expect(
      fromHitlRequest(event({ requestId: 'r3', kind: 'from-the-future', payload: {} })),
    ).toBeNull()
  })

  test('returns null for a payload that is not a request at all', () => {
    expect(fromHitlRequest(null)).toBeNull()
    expect(fromHitlRequest({ kind: 'ask' })).toBeNull()
  })
})

describe('recoverInactiveHitlSession', () => {
  test('resyncs the session that asked, and with none resyncs nothing — not the chat on screen', async () => {
    const fetched: string[] = []
    const original = backendClient.getSession.bind(backendClient)
    backendClient.getSession = ((id: string) => {
      fetched.push(id)
      return Promise.reject(new Error('offline'))
    }) as typeof backendClient.getSession
    useChatStore.setState({ activeSessionId: 'on-screen' })
    try {
      recoverInactiveHitlSession(null)
      recoverInactiveHitlSession('asker')
      await Promise.resolve()
      expect(fetched).toEqual(['asker'])
    } finally {
      backendClient.getSession = original
      useChatStore.setState({ activeSessionId: null })
    }
  })
})
