import type {
  AutomaticContextProvider,
  ContextDestination,
  ContextProviderContribution,
  ContextResolver,
} from './contracts'
import {
  CORE_CONTEXT_MAX_TOKENS,
  validateContextContribution,
  type ContributionRejectReason,
} from './contribution-validate'

/** Content-free registration diagnostic. It carries only provider identity, the
 *  contributing source, routing metadata and an enumerated status/reason — never
 *  produced content, a resource URI, a path or an exception string. Safe to surface
 *  in an effective-config / diagnostics view. */
/** A registered contribution whose provider resolves explicit references. */
export type ResolverContribution = ContextProviderContribution & { provider: ContextResolver }
/** A registered contribution whose provider contributes context on its own. */
export type AutomaticProviderContribution = ContextProviderContribution & {
  provider: AutomaticContextProvider
}

export interface ContextProviderDiagnostic {
  providerId: string
  providerVersion: string
  /** Subsystem/mini app id that contributed this (undefined for core-registered). */
  source?: string
  destinations: readonly ContextDestination[]
  activation: 'explicit' | 'automatic'
  defaultEnabled: boolean
  status: 'registered' | 'rejected'
  reason?: ContributionRejectReason
}

export interface ContextProviderRegistry {
  /** Strict registration for TRUSTED core-owned contributions. Throws on any
   *  validation failure or collision (core contributions are always well-formed). */
  register(contribution: ContextProviderContribution): () => void
  /** Non-throwing registration for MINI APP/subsystem-sourced contributions. Validates
   *  the declarative envelope, enforces namespace + version uniqueness, records a
   *  content-free diagnostic, and never throws for a mini-app-shaped defect. */
  tryRegister(contribution: ContextProviderContribution, source: string): ContextProviderDiagnostic
  /** Remove every contribution registered under `source` — hot mini app disable.
   *  Diagnostics keep their history; only the live entries drop. */
  unregisterBySource(sourceId: string): void
  resolvers(destination: ContextDestination): ResolverContribution[]
  automaticProviders(destination: ContextDestination): AutomaticProviderContribution[]
  list(): ContextProviderContribution[]
  /** All registration attempts (registered + rejected), in attempt order. */
  diagnostics(): ContextProviderDiagnostic[]
}

function isResolver(
  provider: ContextResolver | AutomaticContextProvider,
): provider is ContextResolver {
  return 'resolve' in provider && typeof provider.resolve === 'function'
}

const hasResolver = (entry: ContextProviderContribution): entry is ResolverContribution =>
  isResolver(entry.provider)
const hasAutomaticProvider = (
  entry: ContextProviderContribution,
): entry is AutomaticProviderContribution => !isResolver(entry.provider)

export function createContextProviderRegistry(): ContextProviderRegistry {
  const entries = new Map<string, ContextProviderContribution>()
  const sources = new Map<string, string | undefined>()
  const diagnostics: ContextProviderDiagnostic[] = []

  const keyFor = (contribution: ContextProviderContribution) =>
    `${contribution.provider.id}@${contribution.provider.version}`

  const record = (
    contribution: ContextProviderContribution,
    source: string | undefined,
    status: 'registered' | 'rejected',
    reason?: ContributionRejectReason,
  ): ContextProviderDiagnostic => {
    const diagnostic: ContextProviderDiagnostic = {
      providerId: contribution?.provider?.id ?? '<invalid>',
      providerVersion: contribution?.provider?.version ?? '<invalid>',
      source,
      destinations: Array.isArray(contribution?.destinations) ? [...contribution.destinations] : [],
      activation: contribution?.activation ?? 'explicit',
      defaultEnabled: Boolean(contribution?.defaultEnabled),
      status,
      reason,
    }
    diagnostics.push(diagnostic)
    return diagnostic
  }

  const commit = (contribution: ContextProviderContribution, source: string | undefined) => {
    const key = keyFor(contribution)
    // Mini app objects are data. Copy the declarative array at registration so a
    // provider cannot expand its routing surface by mutating its own input later.
    entries.set(key, { ...contribution, destinations: [...contribution.destinations] })
    sources.set(key, source)
    return record(contribution, source, 'registered')
  }

  return {
    register(contribution) {
      const validation = validateContextContribution(contribution, {
        maxTokens: CORE_CONTEXT_MAX_TOKENS,
      })
      if (!validation.ok) {
        record(contribution, undefined, 'rejected', validation.reason)
        throw new Error(`Invalid context provider (${validation.reason}): ${keyFor(contribution)}`)
      }
      const key = keyFor(contribution)
      if (entries.has(key)) {
        record(contribution, undefined, 'rejected', 'duplicate')
        throw new Error(`Duplicate context provider: ${key}`)
      }
      commit(contribution, undefined)
      return () => {
        entries.delete(key)
        sources.delete(key)
      }
    },
    tryRegister(contribution, source) {
      const validation = validateContextContribution(contribution)
      if (!validation.ok) return record(contribution, source, 'rejected', validation.reason)
      const key = keyFor(contribution)
      if (entries.has(key)) {
        // Same id@version already present — a namespace/version collision. A mini app
        // must namespace its provider id; the first registration wins.
        const previousSource = sources.get(key)
        const reason: ContributionRejectReason =
          previousSource === source ? 'duplicate' : 'namespace_conflict'
        return record(contribution, source, 'rejected', reason)
      }
      return commit(contribution, source)
    },
    unregisterBySource(sourceId) {
      for (const [key, source] of sources) {
        if (source === sourceId) {
          entries.delete(key)
          sources.delete(key)
        }
      }
    },
    resolvers(destination) {
      // Specific before generic: the manager takes the FIRST resolver that supports a reference,
      // and registration order is boot order, so a generic bridge registered by core would
      // otherwise answer every reference a mini app's own resolver was written for.
      const candidates = [...entries.values()]
        .filter(hasResolver)
        .filter(
          (entry) => entry.activation === 'explicit' && entry.destinations.includes(destination),
        )
      return [
        ...candidates.filter((entry) => !entry.fallback),
        ...candidates.filter((entry) => entry.fallback),
      ]
    },
    automaticProviders(destination) {
      return [...entries.values()]
        .filter(hasAutomaticProvider)
        .filter(
          (entry) =>
            entry.activation === 'automatic' &&
            entry.defaultEnabled &&
            entry.destinations.includes(destination),
        )
    },
    list() {
      return [...entries.values()]
    },
    diagnostics() {
      return diagnostics.slice()
    },
  }
}
