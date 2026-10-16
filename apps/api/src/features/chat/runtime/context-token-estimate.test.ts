import { describe, expect, test } from 'bun:test'
import type { ChatMessage } from '@localixai/agent'
import { describeFixedContext } from '@localixai/agent/agents'
import { z } from 'zod'
import type { PersistedMessage } from '../contracts'

import {
  contextAnchorIdentityMatches,
  createContextAnchorIdentity,
  estimateModelContextTokens,
  lastTurnContextAnchor,
  type ContextAnchorIdentity,
} from './context-token-estimate'

describe('estimateModelContextTokens', () => {
  const identity = (overrides: Partial<ContextAnchorIdentity> = {}): ContextAnchorIdentity => ({
    providerId: 'openai',
    modelId: 'gpt',
    boundaryId: 'boundary-1',
    systemPromptHash: 'system',
    toolSchemaHash: 'tools',
    fixedOverheadTokens: 10_000,
    ...overrides,
  })
  const messages: ChatMessage[] = [
    { id: 'old', role: 'user', content: 'x'.repeat(1_000_000) },
    { id: 'anchor', role: 'assistant', content: 'measured response' },
    { id: 'tail', role: 'user', content: 'y'.repeat(54_000) },
  ]

  test('provider usage is authoritative for its prefix and only the new tail is estimated', () => {
    const estimate = estimateModelContextTokens(
      messages,
      { tokens: 143_663, messageId: 'anchor', identity: identity() },
      10_000,
      identity(),
    )

    expect(estimate).toEqual({
      tokens: 157_163,
      source: 'provider_anchor',
      trailingTokens: 13_500,
      anchorMessageId: 'anchor',
    })
  })

  test('falls back to the full heuristic plus fixed overhead when the anchor is absent', () => {
    const estimate = estimateModelContextTokens(messages, undefined, 10_000)
    expect(estimate.source).toBe('heuristic')
    expect(estimate.tokens).toBeGreaterThan(260_000)
    expect(estimate.tokens - estimate.trailingTokens).toBe(10_000)
  })

  test('an anchor that no longer belongs to the current prefix is never trusted', () => {
    const estimate = estimateModelContextTokens(
      messages,
      { tokens: 1, messageId: 'compacted-away' },
      10_000,
    )
    expect(estimate.source).toBe('heuristic')
    expect(estimate.tokens).toBeGreaterThan(260_000)
  })

  test('invalid provider usage and overhead cannot poison the estimate with NaN or Infinity', () => {
    for (const tokens of [Number.NaN, Number.POSITIVE_INFINITY, -1, 0]) {
      const estimate = estimateModelContextTokens(
        messages,
        { tokens, messageId: 'anchor', identity: identity() },
        Number.NaN,
        identity(),
      )
      expect(estimate.source).toBe('heuristic')
      expect(Number.isFinite(estimate.tokens)).toBe(true)
    }
  })

  test('rejects an unproven or differently-shaped provider anchor', () => {
    const raw = estimateModelContextTokens(
      messages,
      { tokens: 1, messageId: 'anchor' },
      10_000,
      identity(),
    )
    const changedTools = estimateModelContextTokens(
      messages,
      { tokens: 1, messageId: 'anchor', identity: identity() },
      10_000,
      identity({ toolSchemaHash: 'changed' }),
    )

    expect(raw.source).toBe('heuristic')
    expect(changedTools.source).toBe('heuristic')
    expect(raw.tokens).toBeGreaterThan(260_000)
    expect(changedTools.tokens).toBeGreaterThan(260_000)
  })

  test('fingerprints schema shape, model, boundary, and fixed overhead', () => {
    const baseFixed = describeFixedContext('system', [
      { name: 'read', description: 'Read', inputSchema: z.object({ path: z.string() }) },
    ])
    const base = createContextAnchorIdentity({
      providerId: 'openai',
      modelId: 'gpt',
      boundaryId: 'b1',
      systemPromptHash: baseFixed.systemPromptHash,
      toolSchemaHash: baseFixed.toolSchemaHash,
      fixedOverheadTokens: 1_000,
    })
    const changedFixed = describeFixedContext('system', [
      { name: 'read', description: 'Read', inputSchema: z.object({ uri: z.string() }) },
    ])
    const changedSchema = createContextAnchorIdentity({
      providerId: 'openai',
      modelId: 'gpt',
      boundaryId: 'b1',
      systemPromptHash: changedFixed.systemPromptHash,
      toolSchemaHash: changedFixed.toolSchemaHash,
      fixedOverheadTokens: 1_000,
    })

    expect(contextAnchorIdentityMatches(base, { ...base })).toBe(true)
    expect(contextAnchorIdentityMatches(base, changedSchema)).toBe(false)
    for (const changed of [
      { ...base, providerId: 'anthropic' },
      { ...base, modelId: 'claude' },
      { ...base, boundaryId: 'b2' },
      { ...base, systemPromptHash: 'changed' },
      { ...base, fixedOverheadTokens: 2_000 },
    ]) {
      expect(contextAnchorIdentityMatches(base, changed)).toBe(false)
    }
  })

  test('legacy persisted provider/model survives restart with a conservative full-overhead charge', () => {
    const persisted = (message: ChatMessage, extra: object = {}): PersistedMessage =>
      ({
        id: message.id,
        sessionId: 's',
        userId: 'u',
        createdAt: '',
        updatedAt: '',
        payload: { ...message, ...extra },
      }) as unknown as PersistedMessage
    const history = [
      persisted(messages[0]),
      persisted(messages[1], {
        usage: { contextTokens: 143_663 },
        providerMeta: { providerId: 'openai', modelId: 'gpt' },
      }),
      persisted(messages[2]),
    ]
    const anchor = lastTurnContextAnchor(history)
    const current = identity()
    const estimate = estimateModelContextTokens(
      messages,
      anchor,
      current.fixedOverheadTokens,
      current,
    )

    expect(anchor).toMatchObject({
      messageId: 'anchor',
      legacyProvider: { providerId: 'openai', modelId: 'gpt' },
    })
    expect(estimate).toMatchObject({
      source: 'provider_anchor',
      tokens: 167_163,
      trailingTokens: 13_500,
    })
    expect(
      estimateModelContextTokens(
        messages,
        anchor,
        current.fixedOverheadTokens,
        identity({ modelId: 'other' }),
      ).source,
    ).toBe('heuristic')
  })
})
