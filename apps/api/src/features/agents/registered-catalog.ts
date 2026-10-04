import type { ContributionRegistration } from '../ext/contribution-reader'
import { availabilityOf } from '../capabilities/availability'
import { ACTION_PREFIX, composeCapabilities, type CapabilityKind } from '../capabilities/resolve'
import type { Rule } from '../capabilities/rule'
import type { InvocationRegistry } from '../capabilities/invocation'
import type { AgentContribution } from './contribution'
import type { AgentSummary } from './contracts'

/** Materialize a native registration without converting extension ownership into a local file. */
export function registeredAgentSummary(
  entry: ContributionRegistration<AgentContribution>,
  rules: Rule[],
  invocations: InvocationRegistry,
  policyReviewed = false,
): AgentSummary {
  const availability = availabilityOf(composeCapabilities(rules))
  // NOT `=== true`. That was right while a plugin's default was `deny` and an explicit allow
  // was the only way to be on. With one fallback — silence means allowed — requiring the
  // affirmative here would report every registered agent as `source_disabled` until someone
  // wrote a rule about its source into THIS agent's own list, which is not where installing a
  // plugin writes. A denial still disables it; only the absence of one stops meaning "off".
  const sourceEnabled =
    Object.hasOwn(ACTION_PREFIX, entry.source.kind) &&
    availability.effectFor(entry.source.kind as CapabilityKind, entry.source.name) !== 'deny'
  // Enabling a source or an agent does not accept an unreviewed import policy.
  const unavailableReason = !sourceEnabled
    ? ('source_disabled' as const)
    : entry.value.policyProposals.length && !policyReviewed
      ? ('policy_pending' as const)
      : undefined
  return {
    record: { ...entry.value.definition, id: entry.id },
    projectId: entry.projectId,
    scope: entry.projectId ? 'project' : 'global',
    source: `imported:${entry.source.id}`,
    path: '',
    builtin: false,
    registration: {
      sourceId: entry.source.id,
      sourceName: entry.source.name,
      key: entry.key,
      revision: entry.revision,
    },
    ...(unavailableReason ? { unavailableReason } : {}),
    // A registration is `untrusted` by construction — it arrived with an extension — so it
    // stays off until a rule says otherwise, and the class says that rather than a literal
    // `=== true` that would have to be re-derived at every reader.
    enabled:
      !unavailableReason && availability.effectFor('agent', entry.id, 'untrusted') === 'allow',
    invocations: unavailableReason
      ? Object.fromEntries(invocations.list().map((host) => [host.id, 'deny' as const]))
      : invocations.availability(rules, entry.id),
  }
}
