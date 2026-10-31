import { describe, expect, test } from 'bun:test'
import { createContextManager, packContextContributions } from './manager'
import { createContextProviderRegistry } from './registry'
import type { ContextContribution } from '@localixai/mini-app-sdk/backend'

const contribution = (over: Partial<ContextContribution>): ContextContribution => ({
  id: 'a',
  providerId: 'p',
  providerVersion: '1',
  scope: 'project',
  kind: 'code',
  content: 'x',
  priority: 1,
  sensitivity: 'project',
  ...over,
})

describe('packContextContributions', () => {
  test('drops forbidden/duplicates and preserves the active higher-priority snapshot', () => {
    const result = packContextContributions(
      [
        contribution({ id: 'stale', uri: '/a.ts', content: 'old', priority: 10 }),
        contribution({ id: 'live', uri: '/a.ts', content: 'new', priority: 1 }),
        contribution({ id: 'secret', content: 'no', sensitivity: 'forbidden' }),
        contribution({ id: 'sensitive', content: 'no', sensitivity: 'sensitive' }),
      ],
      { activeUri: '/a.ts', maxBytes: 100, maxItems: 3 },
    )
    expect(result.contributions).toEqual([expect.objectContaining({ id: 'stale' })])
    expect(result.dropped).toEqual(
      expect.arrayContaining([
        { id: 'live', reason: 'duplicate' },
        { id: 'secret', reason: 'forbidden' },
        { id: 'sensitive', reason: 'sensitive' },
      ]),
    )
  })

  test('excludes traversal, conventional secret files and high-confidence secret values with safe diagnostics', () => {
    const result = packContextContributions(
      [
        contribution({ id: 'traversal', uri: 'file:///work/../outside.ts' }),
        contribution({ id: 'dotenv', uri: 'file:///work/.env', content: 'NORMAL=1' }),
        contribution({ id: 'key', content: '-----BEGIN PRIVATE KEY-----\nprivate' }),
        contribution({ id: 'token', content: 'api_key = "0123456789abcdef"' }),
        contribution({ id: 'allowed', uri: 'file:///work/src/a.ts', content: 'const x = 1' }),
      ],
      { maxBytes: 1000, maxItems: 8 },
    )
    expect(result.contributions.map((item) => item.id)).toEqual(['allowed'])
    expect(result.diagnostics).toEqual({ droppedByReason: { excluded_uri: 2, secret: 2 } })
    expect(JSON.stringify(result.diagnostics)).not.toContain('PRIVATE KEY')
    expect(JSON.stringify(result.diagnostics)).not.toContain('/work/')
  })

  test('clips a provider invocation to the host operation deadline', async () => {
    const registry = createContextProviderRegistry()
    let receivedSignal: AbortSignal | undefined
    registry.register({
      provider: {
        id: 'slow',
        version: '1',
        destinations: ['edit-prediction'] as const,
        sensitivity: 'project' as const,
        provide: async (_req, signal) => {
          receivedSignal = signal
          await new Promise<void>((resolve) =>
            signal.addEventListener('abort', () => resolve(), { once: true }),
          )
          return []
        },
      },
      destinations: ['edit-prediction'],
      activation: 'automatic',
      defaultEnabled: true,
      maxTokens: 100,
      timeoutMs: 1_000,
      sensitivity: 'project',
    })
    const result = await createContextManager(registry).collect(
      {
        destination: 'edit-prediction',
        userId: 'u',
        maxBytes: 100,
        deadlineAtMs: Date.now() + 10,
      },
      [],
      new AbortController().signal,
    )
    expect(receivedSignal?.aborted).toBe(true)
    expect(result.providerOutcomes).toContainEqual({
      providerId: 'slow',
      status: 'deadline_exceeded',
      contributionCount: 0,
    })
  })

  test('requires an explicit policy opt-in for sensitive contributions', () => {
    const item = contribution({
      id: 'sensitive',
      content: 'allowed only by policy',
      sensitivity: 'sensitive',
    })
    expect(packContextContributions([item], { maxBytes: 100, maxItems: 1 }).contributions).toEqual(
      [],
    )
    expect(
      packContextContributions([item], { maxBytes: 100, maxItems: 1, allowSensitive: true })
        .contributions,
    ).toEqual([item])
  })

  test('applies a hard byte budget', () => {
    const result = packContextContributions(
      [
        contribution({ id: 'first', content: '12345' }),
        contribution({ id: 'second', content: '67890' }),
      ],
      { maxBytes: 6, maxItems: 2 },
    )
    expect(result.contributions).toHaveLength(1)
    expect(result.dropped).toContainEqual({ id: 'second', reason: 'budget' })
  })

  test('isolates provider timeout and applies the same packing policy to automatic output', async () => {
    const registry = createContextProviderRegistry()
    registry.register({
      provider: {
        id: 'healthy',
        version: '1',
        destinations: ['edit-prediction'] as const,
        sensitivity: 'project' as const,
        provide: async () => [
          contribution({
            id: 'automatic',
            providerId: 'healthy',
            providerVersion: '1',
            content: 'from provider',
            uri: '/schema.sql',
          }),
        ],
      },
      destinations: ['edit-prediction'],
      activation: 'automatic',
      defaultEnabled: true,
      maxTokens: 100,
      timeoutMs: 100,
      sensitivity: 'project',
    })
    registry.register({
      provider: {
        id: 'slow',
        version: '1',
        destinations: ['edit-prediction'] as const,
        sensitivity: 'project' as const,
        provide: async (_req, signal) =>
          new Promise<ContextContribution[]>((resolve) =>
            signal.addEventListener('abort', () => resolve([]), { once: true }),
          ),
      },
      destinations: ['edit-prediction'],
      activation: 'automatic',
      defaultEnabled: true,
      maxTokens: 100,
      timeoutMs: 1,
      sensitivity: 'project',
    })
    const result = await createContextManager(registry).collect(
      {
        destination: 'edit-prediction',
        userId: 'u',
        maxBytes: 100,
      },
      [contribution({ id: 'forbidden', content: 'secret', sensitivity: 'forbidden' })],
      new AbortController().signal,
    )
    expect(result.contributions).toEqual([expect.objectContaining({ id: 'automatic' })])
    expect(result.providerOutcomes).toEqual(
      expect.arrayContaining([
        { providerId: 'healthy', status: 'ok', contributionCount: 1 },
        { providerId: 'slow', status: 'timeout', contributionCount: 0 },
      ]),
    )
  })

  test('does not trust a plugin to impersonate a provider or escalate sensitivity', async () => {
    const registry = createContextProviderRegistry()
    registry.register({
      provider: {
        id: 'bounded',
        version: '1',
        destinations: ['chat'] as const,
        sensitivity: 'project' as const,
        provide: async () => [
          contribution({
            id: 'valid',
            providerId: 'bounded',
            providerVersion: '1',
            content: 'accepted',
          }),
          contribution({
            id: 'spoofed',
            providerId: 'other',
            providerVersion: '1',
            content: 'rejected',
          }),
          contribution({
            id: 'sensitive',
            providerId: 'bounded',
            providerVersion: '1',
            content: 'rejected',
            sensitivity: 'sensitive',
          }),
        ],
      },
      destinations: ['chat'],
      activation: 'automatic',
      defaultEnabled: true,
      maxTokens: 100,
      timeoutMs: 100,
      sensitivity: 'project',
    })
    const result = await createContextManager(registry).collect(
      { destination: 'chat', userId: 'u', maxBytes: 100 },
      [],
      new AbortController().signal,
    )
    expect(result.contributions.map((item) => item.id)).toEqual(['valid'])
    expect(result.diagnostics.droppedByReason).toEqual({
      provider_identity: 1,
      provider_sensitivity: 1,
    })
  })

  test('records only aggregate provider quota drops', async () => {
    const registry = createContextProviderRegistry()
    registry.register({
      provider: {
        id: 'bounded',
        version: '1',
        destinations: ['edit-prediction'] as const,
        sensitivity: 'project' as const,
        provide: async () => [
          contribution({ id: 'a', providerId: 'bounded', providerVersion: '1', content: '1234' }),
          contribution({ id: 'b', providerId: 'bounded', providerVersion: '1', content: '5678' }),
        ],
      },
      destinations: ['edit-prediction'],
      activation: 'automatic',
      defaultEnabled: true,
      maxTokens: 1,
      timeoutMs: 100,
      sensitivity: 'project',
    })
    const result = await createContextManager(registry).collect(
      { destination: 'edit-prediction', userId: 'u', maxBytes: 100 },
      [],
      new AbortController().signal,
    )
    expect(result.contributions.map((item) => item.id)).toEqual(['a'])
    expect(result.diagnostics).toEqual({ droppedByReason: { provider_quota: 1 } })
    expect(JSON.stringify(result.diagnostics)).not.toContain('bounded')
    expect(JSON.stringify(result.diagnostics)).not.toContain('5678')
  })

  test('resolves only in-scope explicit references through a bounded resolver', async () => {
    const registry = createContextProviderRegistry()
    registry.register({
      provider: {
        id: 'resource',
        version: '1',
        supports: (ref: { kind: string }) => ref.kind === 'resource',
        estimate: async () => ({ bytes: 4, tokens: 1 }),
        resolve: async (ref: { id: string; uri?: string }) => [
          contribution({
            id: `resource:${ref.id}`,
            providerId: 'resource',
            providerVersion: '1',
            uri: ref.uri,
            content: 'data',
          }),
        ],
      },
      destinations: ['chat'],
      activation: 'explicit',
      defaultEnabled: true,
      maxTokens: 10,
      timeoutMs: 100,
      sensitivity: 'project',
    })
    const result = await createContextManager(registry).resolveExplicit(
      {
        destination: 'chat',
        userId: 'u',
        sessionId: 's',
        projectId: 'p',
        maxBytes: 100,
      },
      [
        {
          version: 1,
          id: 'r',
          kind: 'resource',
          uri: 'localix://resource/fixture-db/c/table',
          freshness: 'resolve-at-send',
          presentation: { label: 'table' },
          scope: { userId: 'u', sessionId: 's', projectId: 'p' },
        },
        {
          version: 1,
          id: 'wrong-session',
          kind: 'resource',
          freshness: 'resolve-at-send',
          presentation: { label: 'wrong' },
          scope: { userId: 'u', sessionId: 'other' },
        },
      ],
      new AbortController().signal,
    )
    expect(result.contributions).toEqual([expect.objectContaining({ id: 'resource:r' })])
    expect(result.providerOutcomes).toContainEqual({
      providerId: 'reference:wrong-session',
      status: 'reference_out_of_scope',
      contributionCount: 0,
    })
    expect(result.referenceOutcomes).toEqual([
      { referenceId: 'r', status: 'resolved', contributionIds: ['resource:r'] },
      { referenceId: 'wrong-session', status: 'out_of_scope', contributionIds: [] },
    ])
  })

  test('reads each explicit reference exactly once', async () => {
    // A resource resolver cannot size a reference without expanding it, so a pre-sizing
    // `estimate` call meant paying for every live read TWICE against one deadline.
    let reads = 0
    const registry = createContextProviderRegistry()
    registry.register({
      provider: {
        id: 'resource',
        version: '1',
        supports: () => true,
        estimate: async () => {
          reads += 1
          return { bytes: 4, tokens: 1 }
        },
        resolve: async (ref: { id: string }) => {
          reads += 1
          return [
            contribution({
              id: `resource:${ref.id}`,
              providerId: 'resource',
              providerVersion: '1',
              content: 'data',
            }),
          ]
        },
      },
      destinations: ['chat'],
      activation: 'explicit',
      defaultEnabled: true,
      maxTokens: 10,
      timeoutMs: 100,
      sensitivity: 'project',
    })
    const result = await createContextManager(registry).resolveExplicit(
      { destination: 'chat', userId: 'u', sessionId: 's', maxBytes: 100 },
      [
        {
          version: 1,
          id: 'r',
          kind: 'resource',
          uri: 'localix://resource/fixture-db/c/table',
          freshness: 'resolve-at-send',
          presentation: { label: 'table' },
          scope: { userId: 'u', sessionId: 's' },
        },
      ],
      new AbortController().signal,
    )
    expect(reads).toBe(1)
    expect(result.referenceOutcomes[0]?.status).toBe('resolved')
  })

  test('resolves explicit references with bounded parallelism and deterministic order', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const started: string[] = []
    const registry = createContextProviderRegistry()
    registry.register({
      provider: {
        id: 'parallel-resource',
        version: '1',
        supports: () => true,
        estimate: async () => ({ bytes: 2, tokens: 1 }),
        resolve: async (ref: { id: string }) => {
          inFlight += 1
          maxInFlight = Math.max(maxInFlight, inFlight)
          started.push(ref.id)
          await new Promise((resolve) => setTimeout(resolve, ref.id === 'r0' ? 20 : 2))
          inFlight -= 1
          return [
            contribution({
              id: `resolved:${ref.id}`,
              providerId: 'parallel-resource',
              providerVersion: '1',
              content: ref.id,
            }),
          ]
        },
      },
      destinations: ['chat'],
      activation: 'explicit',
      defaultEnabled: true,
      maxTokens: 100,
      timeoutMs: 100,
      sensitivity: 'project',
    })
    const references = Array.from({ length: 6 }, (_, index) => ({
      version: 1 as const,
      id: `r${index}`,
      kind: 'resource',
      freshness: 'resolve-at-send' as const,
      presentation: { label: `r${index}` },
      scope: { userId: 'u' },
    }))
    const result = await createContextManager(registry).resolveExplicit(
      { destination: 'chat', userId: 'u', maxBytes: 1000 },
      references,
      new AbortController().signal,
    )

    expect(started.slice(0, 4)).toEqual(['r0', 'r1', 'r2', 'r3'])
    expect(maxInFlight).toBe(4)
    expect(result.referenceOutcomes.map((outcome) => outcome.referenceId)).toEqual(
      references.map((reference) => reference.id),
    )
    expect(result.contributions.map((item) => item.id)).toEqual(
      references.map((reference) => `resolved:${reference.id}`),
    )
  })

  test('enforces the declared quota on what a resolver actually returned', async () => {
    // The quota survives the removal of the estimate pre-check: it is applied to real
    // output, not to a provider's self-reported estimate.
    const registry = createContextProviderRegistry()
    registry.register({
      provider: {
        id: 'resource',
        version: '1',
        supports: () => true,
        estimate: async () => ({ bytes: 1, tokens: 1 }), // under-reports, deliberately
        resolve: async (ref: { id: string }) => [
          contribution({
            id: `resource:${ref.id}`,
            providerId: 'resource',
            providerVersion: '1',
            content: 'x'.repeat(400),
          }),
        ],
      },
      destinations: ['chat'],
      activation: 'explicit',
      defaultEnabled: true,
      maxTokens: 1,
      timeoutMs: 100,
      sensitivity: 'project',
    })
    const result = await createContextManager(registry).resolveExplicit(
      { destination: 'chat', userId: 'u', sessionId: 's', maxBytes: 1000 },
      [
        {
          version: 1,
          id: 'r',
          kind: 'resource',
          uri: 'localix://resource/fixture-db/c/table',
          freshness: 'resolve-at-send',
          presentation: { label: 'table' },
          scope: { userId: 'u', sessionId: 's' },
        },
      ],
      new AbortController().signal,
    )
    expect(result.contributions).toEqual([])
    expect(result.diagnostics.droppedByReason.provider_quota).toBe(1)
    expect(result.referenceOutcomes[0]?.status).toBe('denied')
  })

  test('classifies an unsupported in-scope reference without exposing its URI', async () => {
    const result = await createContextManager(createContextProviderRegistry()).resolveExplicit(
      {
        destination: 'edit-prediction',
        userId: 'u',
        sessionId: 's',
        maxBytes: 100,
      },
      [
        {
          version: 1,
          id: 'unknown',
          kind: 'resource',
          uri: 'opaque://private',
          freshness: 'resolve-at-send',
          presentation: { label: 'private' },
          scope: { userId: 'u', sessionId: 's' },
        },
      ],
      new AbortController().signal,
    )
    expect(result.providerOutcomes).toEqual([
      { providerId: 'reference:unknown', status: 'resolver_not_found', contributionCount: 0 },
    ])
    expect(JSON.stringify(result.providerOutcomes)).not.toContain('opaque://private')
    expect(result.referenceOutcomes).toEqual([
      { referenceId: 'unknown', status: 'unsupported', contributionIds: [] },
    ])
    expect(JSON.stringify(result.referenceOutcomes)).not.toContain('opaque://private')
  })

  test('distinguishes resolver-empty from policy-denied outcomes after packing', async () => {
    const registry = createContextProviderRegistry()
    registry.register({
      provider: {
        id: 'resource',
        version: '1',
        supports: () => true,
        estimate: async () => ({ bytes: 4, tokens: 1 }),
        resolve: async (ref: { id: string }) =>
          ref.id === 'empty'
            ? []
            : [
                contribution({
                  id: `resource:${ref.id}`,
                  providerId: 'resource',
                  providerVersion: '1',
                  content: 'too-large',
                }),
              ],
      },
      destinations: ['chat'],
      activation: 'explicit',
      defaultEnabled: true,
      maxTokens: 10,
      timeoutMs: 100,
      sensitivity: 'project',
    })
    const result = await createContextManager(registry).resolveExplicit(
      {
        destination: 'chat',
        userId: 'u',
        maxBytes: 1,
      },
      ['empty', 'packed-out'].map((id) => ({
        version: 1 as const,
        id,
        kind: 'resource',
        freshness: 'resolve-at-send' as const,
        presentation: { label: id },
        scope: { userId: 'u' },
      })),
      new AbortController().signal,
    )
    expect(result.referenceOutcomes).toEqual([
      { referenceId: 'empty', status: 'empty', contributionIds: [] },
      { referenceId: 'packed-out', status: 'denied', contributionIds: ['resource:packed-out'] },
    ])
  })
})
