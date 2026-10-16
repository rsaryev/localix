import type { DiscoveredAgent } from './discovery'
import type { TrustClass } from '../ext/trust'
import type { AgentSummary } from './contracts'
import type { CapabilitySourceRecord } from '../capabilities/source-repository'

/**
 * How a discovered agent becomes a registry row the UI can render — and what it defaults
 * to when nobody has ruled on it.
 *
 * Split out of the service because both are pure: the service resolves scopes, writes
 * files and talks to the rule store, while these two only reshape what it already has.
 */

/**
 * WHAT KIND of agent this is, in the same vocabulary a plugin uses.
 *
 * It used to be `agentEnabledByDefault` — a boolean the caller combined with the rule store
 * through a `??`. As a class it travels into the rule lookup instead, so a role we ship runs
 * unless a rule says otherwise, one that appeared as a file waits to be asked about, and both
 * facts are nameable in a rule (`agent:* untrusted ask`) rather than buried in a predicate.
 *
 * An agent bears no code of its own — it is a definition — so the only axis is provenance.
 */
export const agentTrustClass = (item: DiscoveredAgent): TrustClass =>
  item.builtin ? 'bundled' : 'untrusted'

export function toSummary(
  item: DiscoveredAgent,
  state: CapabilitySourceRecord | undefined,
  enabled: boolean,
  invocations: AgentSummary['invocations'],
): AgentSummary {
  const fromCode = item.builtin && item.path === ''
  return {
    record: item.record,
    projectId: item.projectId,
    scope: item.scope,
    enabled,
    invocations,
    source: fromCode ? 'builtin' : (state?.source ?? 'local'),
    path: item.path,
    builtin: item.builtin,
  }
}
