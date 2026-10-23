import { CONTEXT_UNAVAILABLE_KIND } from '@localixai/mini-app-sdk/backend'

import type { ResourceProviderRegistry } from '../agent-core/resource-refs/provider'
import type { ContextContribution, ContextResolver } from './contracts'
import { estimateTokens } from '../../lib/tokens'

/**
 * Generic bridge from an opaque resource URI to Context Fabric. The core knows only
 * the ResourceProviderRegistry contract; provider-specific schemes remain entirely
 * outside this module.
 *
 * It is a FALLBACK (see `ContextProviderContribution.fallback`): a mini app that registers its own
 * resolver for its scheme answers first, and this bridge serves every scheme that has none. The
 * registration, not this predicate, decides the destinations — the predicate used to pin
 * `edit-prediction`, which is why a chat send needed a second, host-side path for the same URI.
 */
export function createResourceContextResolver(
  resources: ResourceProviderRegistry,
): ContextResolver {
  return {
    id: 'resource-reference',
    version: '1',
    supports(reference) {
      return reference.kind === 'resource' && Boolean(reference.uri)
    },
    async estimate(reference, _ctx, signal) {
      if (signal.aborted || !reference.uri) return { bytes: 0, tokens: 0 }
      const expansion = await resources.expand(reference.scope.userId, reference.uri, {
        sessionId: reference.scope.sessionId,
      })
      const content = expansion.ok ? (expansion.content ?? '') : ''
      return { bytes: Buffer.byteLength(content, 'utf8'), tokens: estimateTokens(content) }
    },
    async resolve(reference, ctx, signal): Promise<ContextContribution[]> {
      if (signal.aborted || !reference.uri) return []
      const expansion = await resources.expand(ctx.userId, reference.uri, {
        sessionId: ctx.sessionId,
      })
      if (signal.aborted) return []
      const base = {
        id: `resource:${reference.id}`,
        providerId: 'resource-reference',
        providerVersion: '1',
        scope: 'session' as const,
        uri: reference.uri,
        priority: 1000,
        sensitivity: 'project' as const,
        relevanceHints: { explicit: true },
      }
      if (!expansion.ok) {
        const label = reference.presentation.token ?? reference.presentation.label
        return [
          {
            ...base,
            kind: CONTEXT_UNAVAILABLE_KIND,
            content: `${label}: could not be read (${expansion.error ?? 'unavailable'})`,
          },
        ]
      }
      if (!expansion.content) return []
      return [
        {
          ...base,
          kind: expansion.language ? `resource/${expansion.language}` : 'resource',
          content: expansion.content,
        },
      ]
    },
  }
}
