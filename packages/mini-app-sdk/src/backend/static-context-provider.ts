import { fnv1aHex } from './fnv1a'
import type {
  AutomaticContextProvider,
  ContextDestination,
  ContextProviderContribution,
  ContextSensitivity,
} from './context-fabric'

export interface StaticContextProviderSpec {
  /** Globally unique provider id, normally `<app>.instructions`. */
  id: string
  content: string
  destinations?: readonly ContextDestination[]
  version?: string
  kind?: string
  priority?: number
  sensitivity?: Exclude<ContextSensitivity, 'forbidden'>
  maxTokens?: number
  timeoutMs?: number
}

/**
 * Turn fixed mini app guidance into a governed automatic Context Fabric contribution.
 * This is the replacement for appending mini app text directly to the global system
 * prompt: the host applies destination routing, cancellation, quotas and policy.
 */
export function createStaticContextProvider(
  spec: StaticContextProviderSpec,
): ContextProviderContribution {
  const destinations = [...(spec.destinations ?? ['chat', 'subagent'])]
  const sensitivity = spec.sensitivity ?? 'public'
  const version = spec.version ?? '1'
  const revision = `static:${fnv1aHex(spec.content)}:${spec.content.length}`
  const provider: AutomaticContextProvider = {
    id: spec.id,
    version,
    destinations,
    sensitivity,
    async provide(request, signal) {
      if (signal.aborted || !destinations.includes(request.destination) || !spec.content.trim()) {
        return []
      }
      return [
        {
          id: `${spec.id}:${request.destination}`,
          providerId: spec.id,
          providerVersion: version,
          scope: 'global',
          kind: spec.kind ?? 'mini-app-instructions',
          content: spec.content,
          revision,
          priority: spec.priority ?? 100,
          sensitivity,
        },
      ]
    },
  }
  return {
    provider,
    destinations,
    activation: 'automatic',
    defaultEnabled: true,
    maxTokens: spec.maxTokens ?? 2_000,
    timeoutMs: spec.timeoutMs ?? 100,
    sensitivity,
  }
}
