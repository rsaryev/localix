/**
 * THE capability requests: one READ and one WRITE. A `backendClient` domain module,
 * spread into the facade in `./client`.
 *
 * The read replaces the fan-out every capability surface used to do for itself —
 * mini apps, panels, views, tools, one request each, reconciled by hand. The write
 * replaces five toggle endpoints across four features, each of which answered with its
 * own record shape and left the client to re-read the document it had just invalidated.
 *
 * Both speak the same document, so a write needs no follow-up read at all. The write speaks
 * RULES, not switches: see `shared/contrib/capabilityRules` for the one place a switch in the
 * UI is translated into one.
 */

import { cleanQuery, client, unwrap } from './internal'
import type {
  CapabilityRuleChange,
  CapabilityRule,
  CapabilityRuleSnapshot,
  CapabilityScope,
  CapabilitySnapshot,
} from './contracts'

export const capabilitiesApi = {
  /**
   * The capability snapshot for one scope. `projectId: null` (or omitted) is the
   * no-project scope.
   */
  async fetchCapabilitySnapshot(opts?: CapabilityScope): Promise<CapabilitySnapshot> {
    return unwrap(
      await client.rpc.capabilities.snapshot.$get({
        query: cleanQuery({
          projectId: opts?.projectId,
          agentId: opts?.agentId,
        }),
      }),
    )
  },

  /**
   * Change what a scope permits, and receive its NEW document.
   *
   * A PATCH of the scope's rules by (action, resource) — the one write behind every switch
   * in Settings. Changes are a list because editing is a set operation and because one
   * request that applies them together cannot leave a scope halfway between two intended
   * states. `effect` is absolute, never a flip, so a retry is harmless.
   *
   * The response is authoritative: hand it straight to the capability cache rather
   * than re-reading. Two rapid writes can still answer out of order — apply by
   * `revision`, never by arrival.
   */
  async applyCapabilityRules(
    input: CapabilityScope & { changes: CapabilityRuleChange[] },
  ): Promise<CapabilitySnapshot> {
    return unwrap(
      await client.rpc.capabilities.rules.apply.$post({
        json: {
          changes: input.changes,
          ...(input.projectId ? { projectId: input.projectId } : {}),
          ...(input.agentId ? { agentId: input.agentId } : {}),
        },
      }),
    )
  },

  /**
   * One scope's OWN permission rules.
   *
   * Its own list, not the composed set a run evaluates: that composition is the maximum over
   * the chain, and an editor over it could not say which scope a change belonged to.
   */
  async fetchCapabilityRules(scope?: CapabilityScope): Promise<CapabilityRuleSnapshot> {
    const result = await unwrap(
      await client.rpc.capabilities.rules.$get({
        query: cleanQuery({ projectId: scope?.projectId, agentId: scope?.agentId }),
      }),
    )
    return result
  },

  /**
   * Replace one scope's rules.
   *
   * Order is the semantics WITHIN a scope — the last match wins, so an exception is stated
   * after the rule it excepts. Across scopes order does not matter at all: the strictest
   * verdict wins, which is why nothing below can undo a denial from above.
   */
  async saveCapabilityRules(
    rules: CapabilityRule[],
    expectedRevision: number,
    scope?: CapabilityScope,
  ): Promise<{ revision: number; rules: CapabilityRule[] }> {
    const result = await unwrap(
      await client.rpc.capabilities.rules.$put({
        json: {
          rules,
          expectedRevision,
          ...(scope?.projectId ? { projectId: scope.projectId } : {}),
          ...(scope?.agentId ? { agentId: scope.agentId } : {}),
        },
      }),
    )
    return { revision: result.revision, rules: result.rules }
  },
}
