import { z } from 'zod'
import type {
  AutomaticContextProvider,
  ContextDestination,
  ContextProviderContribution,
  ContextResolver,
  ContextSensitivity,
} from '@localixai/mini-app-sdk/backend'

/**
 * Content-free validation for a mini app/subsystem Context Fabric contribution.
 *
 * A contribution is DECLARATIVE DATA supplied by a (possibly untrusted) mini app.
 * Its metadata — destinations, activation, budgets, sensitivity — is validated
 * here BEFORE registration so a malformed or hostile declaration degrades to a
 * content-free diagnostic instead of widening the model-context surface or
 * crashing bootstrap. This module never reads a provider's produced CONTENT; it
 * validates only the routing/limit envelope. The Context Manager separately treats
 * all produced content as data (secret/sensitivity/quota shaping) at collection time.
 */

export const CONTEXT_DESTINATIONS = [
  'chat',
  'edit-prediction',
  'inline-completion',
  'title-generation',
  'subagent',
  'recommendation',
] as const satisfies readonly ContextDestination[]

/** Hard ceilings for a mini-app-declared automatic/explicit contribution. A single
 *  mini app can never pack more than this into a model request even if it declares a
 *  larger budget — the host caps it. `forbidden` is never a usable declared
 *  sensitivity (it means "never admit"), so it is rejected at declaration. */
export const MINI_APP_CONTEXT_MAX_TOKENS = 8_000
export const MINI_APP_CONTEXT_MAX_TIMEOUT_MS = 5_000
/**
 * The ceiling for CORE's own resolvers. The mini app cap exists to stop an untrusted provider from
 * flooding a model request; core's host-reference resolver instead reads what the USER linked — a
 * whole file on a sent message — and is already bounded by its expanders. Holding it to the mini
 * app cap would turn every file over ~32 KB into a silently dropped `provider_quota`.
 */
export const CORE_CONTEXT_MAX_TOKENS = 500_000

/** Declarative metadata schema — content-free. Provider objects/functions are NOT
 *  validated by zod (they are runtime capabilities); their SHAPE is checked below. */
export const contextContributionMetaSchema = z
  .object({
    destinations: z.array(z.enum(CONTEXT_DESTINATIONS)).min(1),
    activation: z.enum(['explicit', 'automatic']),
    defaultEnabled: z.boolean(),
    maxTokens: z.number().int().positive().max(CORE_CONTEXT_MAX_TOKENS),
    timeoutMs: z.number().int().positive().max(MINI_APP_CONTEXT_MAX_TIMEOUT_MS),
    fallback: z.boolean().optional(),
    // A declared sensitivity of `forbidden` is meaningless (nothing would ever be
    // admitted) and almost certainly a mistake — reject it at the boundary.
    sensitivity: z.enum(['public', 'project', 'sensitive']),
  })
  .strict()

/** Enumerated, content-free rejection reasons. No message ever carries produced
 *  content, a resource URI, a path or a provider exception string. */
export type ContributionRejectReason =
  | 'invalid_metadata'
  | 'invalid_provider_shape'
  | 'invalid_destinations'
  | 'invalid_sensitivity'
  | 'duplicate'
  | 'namespace_conflict'

export interface ContributionValidation {
  ok: boolean
  provider: { id: string; version: string }
  reason?: ContributionRejectReason
}

function isResolver(
  provider: ContextResolver | AutomaticContextProvider,
): provider is ContextResolver {
  return 'resolve' in provider && typeof (provider as ContextResolver).resolve === 'function'
}

function providerShapeOk(provider: ContextResolver | AutomaticContextProvider): boolean {
  if (typeof provider?.id !== 'string' || !provider.id) return false
  if (typeof provider?.version !== 'string' || !provider.version) return false
  if (isResolver(provider)) {
    return typeof provider.supports === 'function' && typeof provider.estimate === 'function'
  }
  const automatic = provider as AutomaticContextProvider
  return (
    typeof automatic.provide === 'function' &&
    Array.isArray(automatic.destinations) &&
    typeof automatic.sensitivity === 'string'
  )
}

function sensitivityRank(value: ContextSensitivity): number {
  return value === 'public' ? 0 : value === 'project' ? 1 : value === 'sensitive' ? 2 : 3
}

/**
 * Validate a contribution's declarative envelope. Returns a content-free result —
 * never throws for a mini-app-shaped defect, so a bad mini app cannot crash bootstrap.
 */
export function validateContextContribution(
  contribution: ContextProviderContribution,
  ceiling: { maxTokens: number } = { maxTokens: MINI_APP_CONTEXT_MAX_TOKENS },
): ContributionValidation {
  const provider = contribution?.provider
  const id = typeof provider?.id === 'string' ? provider.id : '<invalid>'
  const version = typeof provider?.version === 'string' ? provider.version : '<invalid>'
  const identity = { id, version }

  if (!provider || !providerShapeOk(provider)) {
    return { ok: false, provider: identity, reason: 'invalid_provider_shape' }
  }
  const meta = contextContributionMetaSchema.safeParse({
    destinations: contribution.destinations,
    activation: contribution.activation,
    defaultEnabled: contribution.defaultEnabled,
    maxTokens: contribution.maxTokens,
    timeoutMs: contribution.timeoutMs,
    sensitivity: contribution.sensitivity,
    ...(contribution.fallback !== undefined ? { fallback: contribution.fallback } : {}),
  })
  if (!meta.success || contribution.maxTokens > ceiling.maxTokens)
    return { ok: false, provider: identity, reason: 'invalid_metadata' }

  // An automatic provider carries its OWN destination + sensitivity ceiling; a
  // declared envelope may only narrow (subset destinations, lower-or-equal
  // sensitivity), never widen the routing surface or escalate sensitivity.
  if (!isResolver(provider)) {
    const allowed = provider.destinations
    if (!contribution.destinations.every((destination) => allowed.includes(destination))) {
      return { ok: false, provider: identity, reason: 'invalid_destinations' }
    }
    if (sensitivityRank(contribution.sensitivity) > sensitivityRank(provider.sensitivity)) {
      return { ok: false, provider: identity, reason: 'invalid_sensitivity' }
    }
  }
  return { ok: true, provider: identity }
}
