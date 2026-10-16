import { describe, expect, it } from 'bun:test'

import { resolveAuxLanguageModel, type AuxLanguageModelDeps } from './resolve-model'
import type { ReasoningEffort } from '../../db/types'

/** A stub language model — identity doesn't matter, only that it's non-null. */
const MODEL = { complete: async () => ({ content: '', usage: undefined }) } as never

function makeDeps(over: {
  slot?: { providerConnectionId: string; modelId: string; reasoningEffort?: ReasoningEffort } | null
  session?: {
    providerConnectionId: string | null
    modelId: string | null
    reasoningEffort?: ReasoningEffort | null
  } | null
  /** Model ids that resolve to a working provider (a live connection exists). */
  buildable: Set<string>
  /** Records each (modelId, preferredConnectionId) build attempt in order. */
  attempts?: { modelId: string; preferred?: string | null }[]
  enabled?: boolean
}): AuxLanguageModelDeps {
  return {
    readAgentSettings: async () => ({
      modelRouting: {
        inlineCompletion: {
          ...over.slot,
          enabled: over.enabled ?? true,
        },
      },
    }),
    getSessionModel: async () => over.session ?? null,
    buildLanguageModel: async (_userId, modelId, preferred) => {
      over.attempts?.push({ modelId, preferred })
      // The provider is chosen agnostically by the model, NOT the connection id.
      return over.buildable.has(modelId)
        ? {
            model: MODEL,
            providerConnectionId: `live-for:${modelId}`,
            providerId: `provider-for:${modelId}`,
          }
        : null
    },
  }
}

describe('resolveAuxLanguageModel', () => {
  it('requests minimum reasoning despite explicit slot or inherited session effort', async () => {
    const explicit = await resolveAuxLanguageModel(
      makeDeps({
        slot: { providerConnectionId: 'stored', modelId: 'm-slot', reasoningEffort: 'high' },
        buildable: new Set(['m-slot']),
      }),
      'u',
      's',
    )
    expect(explicit?.reasoningEffort).toBe('off')

    const inherited = await resolveAuxLanguageModel(
      makeDeps({
        session: { providerConnectionId: 'sess', modelId: 'm-live', reasoningEffort: 'max' },
        buildable: new Set(['m-live']),
      }),
      'u',
      's',
    )
    expect(inherited?.reasoningEffort).toBe('off')
  })

  it('requests minimum reasoning for an explicitly routed model without an effort override', async () => {
    const resolved = await resolveAuxLanguageModel(
      makeDeps({
        slot: { providerConnectionId: 'stored', modelId: 'm-slot' },
        session: { providerConnectionId: 'sess', modelId: 'm-live', reasoningEffort: 'high' },
        buildable: new Set(['m-slot']),
      }),
      'u',
      's',
    )
    expect(resolved?.modelId).toBe('m-slot')
    expect(resolved?.reasoningEffort).toBe('off')
  })

  it("uses the slot's model when it builds", async () => {
    const r = await resolveAuxLanguageModel(
      makeDeps({
        slot: { providerConnectionId: 'stored', modelId: 'm-slot' },
        buildable: new Set(['m-slot']),
      }),
      'u',
      's',
    )
    expect(r?.modelId).toBe('m-slot')
    // Resolved to a live connection agnostically, not the stored id.
    expect(r?.providerConnectionId).toBe('live-for:m-slot')
    expect(r?.providerId).toBe('provider-for:m-slot')
  })

  it('passes the stored connection id as a try-first hint', async () => {
    const attempts: { modelId: string; preferred?: string | null }[] = []
    await resolveAuxLanguageModel(
      makeDeps({
        slot: { providerConnectionId: 'stored', modelId: 'm-slot' },
        buildable: new Set(['m-slot']),
        attempts,
      }),
      'u',
      's',
    )
    expect(attempts).toEqual([{ modelId: 'm-slot', preferred: 'stored' }])
  })

  it('falls back to the session model when the slot model cannot be built', async () => {
    // A slot whose provider has no live connection must NOT dead-end.
    const attempts: { modelId: string; preferred?: string | null }[] = []
    const r = await resolveAuxLanguageModel(
      makeDeps({
        slot: { providerConnectionId: 'gone', modelId: 'm-dead', reasoningEffort: 'high' },
        session: { providerConnectionId: 'sess', modelId: 'm-live', reasoningEffort: 'max' },
        buildable: new Set(['m-live']),
        attempts,
      }),
      'u',
      's',
    )
    expect(r?.modelId).toBe('m-live')
    expect(r?.reasoningEffort).toBe('off')
    expect(attempts).toEqual([
      { modelId: 'm-dead', preferred: 'gone' },
      { modelId: 'm-live', preferred: 'sess' },
    ])
  })

  it('returns null when neither the slot nor the session model builds', async () => {
    const r = await resolveAuxLanguageModel(
      makeDeps({
        slot: { providerConnectionId: 'gone', modelId: 'm-dead' },
        session: { providerConnectionId: 'sess', modelId: 'm-also-dead' },
        buildable: new Set(),
      }),
      'u',
      's',
    )
    expect(r).toBeNull()
  })

  it('retries the same bare model through the session provider when the route provider differs', async () => {
    const attempts: { modelId: string; preferred?: string | null }[] = []
    await resolveAuxLanguageModel(
      makeDeps({
        slot: { providerConnectionId: 'a', modelId: 'same' },
        session: { providerConnectionId: 'b', modelId: 'same' },
        buildable: new Set(),
        attempts,
      }),
      'u',
      's',
    )
    expect(attempts).toEqual([
      { modelId: 'same', preferred: 'a' },
      { modelId: 'same', preferred: 'b' },
    ])
  })

  it('does not retry an identical session provider/model pair', async () => {
    const attempts: { modelId: string; preferred?: string | null }[] = []
    await resolveAuxLanguageModel(
      makeDeps({
        slot: { providerConnectionId: 'same-connection', modelId: 'same-model' },
        session: { providerConnectionId: 'same-connection', modelId: 'same-model' },
        buildable: new Set(),
        attempts,
      }),
      'u',
      's',
    )
    expect(attempts).toEqual([{ modelId: 'same-model', preferred: 'same-connection' }])
  })

  it('uses the session model when no slot is configured', async () => {
    const r = await resolveAuxLanguageModel(
      makeDeps({
        session: { providerConnectionId: 'sess', modelId: 'm-live' },
        buildable: new Set(['m-live']),
      }),
      'u',
      's',
    )
    expect(r?.modelId).toBe('m-live')
  })

  it('does not fall back to the session model while inline completion is off', async () => {
    const attempts: { modelId: string; preferred?: string | null }[] = []
    const r = await resolveAuxLanguageModel(
      makeDeps({
        enabled: false,
        session: { providerConnectionId: 'sess', modelId: 'm-live' },
        buildable: new Set(['m-live']),
        attempts,
      }),
      'u',
      's',
    )
    expect(r).toBeNull()
    expect(attempts).toEqual([])
  })
})
