import { describe, expect, test } from 'bun:test'

import { ledgerRowEvent, qualifiedModelId, type LedgerSourceRow } from './ledger-rows'

const source = (payload: unknown, overrides: Partial<LedgerSourceRow> = {}): LedgerSourceRow => ({
  message_id: 'm1',
  session_id: 's1',
  user_id: 'u1',
  payload_json: JSON.stringify(payload),
  created_at: '2026-01-01 00:00:00',
  root_session_id: null,
  model_id: 'openrouter/deepseek/flash',
  agent_id: null,
  provider_connection_id: 'conn-1',
  finish_reason: null,
  ...overrides,
})

describe('qualifiedModelId', () => {
  test('keeps an id already in the provider namespace', () => {
    expect(qualifiedModelId('openrouter', 'openrouter/deepseek/flash')).toBe(
      'openrouter/deepseek/flash',
    )
  })

  test('namespaces a bare or foreign-namespaced id under the provider', () => {
    expect(qualifiedModelId('openai', 'gpt-5')).toBe('openai/gpt-5')
    expect(qualifiedModelId('openrouter', 'deepseek/flash')).toBe('openrouter/deepseek/flash')
  })

  test('leaves the id alone without a provider', () => {
    expect(qualifiedModelId(null, 'gpt-5')).toBe('gpt-5')
  })
})

describe('ledgerRowEvent', () => {
  test('returns null for a message without usage', () => {
    expect(ledgerRowEvent(source({ text: 'hi' }))).toBeNull()
  })

  test('derives the provider from the session model and namespaces the recorded model', () => {
    const derived = ledgerRowEvent(
      source({
        usage: { inputTokens: 3, outputTokens: 4 },
        providerMeta: { modelId: 'deepseek/flash' },
      }),
    )
    expect(derived?.event).toMatchObject({
      providerId: 'openrouter',
      modelId: 'openrouter/deepseek/flash',
      providerConnectionId: 'conn-1',
      totalTokens: 7,
      rootSessionId: 's1',
    })
  })

  test('drops the session connection when the message ran on another model', () => {
    const derived = ledgerRowEvent(
      source({
        usage: { inputTokens: 1 },
        providerMeta: { providerId: 'openai', modelId: 'gpt-5' },
      }),
    )
    expect(derived?.event.modelId).toBe('openai/gpt-5')
    expect(derived?.event.providerConnectionId).toBeNull()
  })

  test("prefers the turn's own routing", () => {
    const derived = ledgerRowEvent(
      source({
        usage: { inputTokens: 1 },
        turnEnd: { providerId: 'anthropic', modelId: 'anthropic/opus', providerConnectionId: 'c2' },
      }),
    )
    expect(derived?.event).toMatchObject({
      providerId: 'anthropic',
      modelId: 'anthropic/opus',
      providerConnectionId: 'c2',
    })
  })
})
