import type { Kysely } from 'kysely'

import type { AppDatabase } from '../../db'
import {
  actionFor,
  resolveCapabilities,
  type CapabilityKind,
  type ResolvedCapabilities,
} from './resolve'
import {
  createCapabilityRuleRepository,
  type VersionedCapabilityRuleRepository,
} from './rule-repository'
import { applyRuleChanges, type RuleChange } from './rule-changes'
import { matches, type Effect, type Rule } from '../agent-core/capability-rule'
import { trustFallback, type TrustClass } from '../ext/trust'

/**
 * What may run, for one item — ONE answer, not a rule plus a gate to combine it with.
 *
 * This used to be three-valued (`decided()` returning true / false / undefined) so that a
 * caller could write `decided(kind, name) ?? trustGate(item)`. Two owners, one question, and
 * every call site free to combine them slightly differently.
 *
 * The artifact's trust class travels IN, as the rule's resource — so `plugin:* untrusted ask`
 * is an ordinary row, `plugin:office * allow` is the ordinary row that answers over it, and
 * what silence means is the one thing the class still decides (`trustFallback`).
 *
 * Narrower than `ResolvedCapabilities` on purpose: a catalog fuses discovery with a verdict
 * and has no business with provenance or argument patterns.
 */
export interface AvailabilityReader {
  /**
   * `allow` — it may run. `deny` — it may not. `ask` — nobody has decided and the artifact
   * is not one that may decide for itself; the user is asked before it runs.
   *
   * `trust` defaults to `bundled` because most kinds have no trust question at all: an MCP
   * server or an agent exists because someone added it.
   */
  effectFor(kind: CapabilityKind, name: string, trust?: TrustClass): Effect
}

/** No rules at all — every item falls back to what its trust class means. */
export const UNDECIDED: AvailabilityReader = {
  effectFor: (_kind, _name, trust = 'bundled') => trustFallback(trust),
}

/**
 * Narrow already-resolved rules to that one answer.
 *
 * Separate from the read below because a RUN resolves its agent's rules once and reading
 * them a second time here could only produce a different answer — the one failure this
 * feature exists to prevent.
 */
export function availabilityOf(resolved: ResolvedCapabilities): AvailabilityReader {
  return {
    effectFor: (kind, name, trust = 'bundled') => {
      const verdict = resolved.verdict(kind, name, trust)
      // A rule that matched is the answer. Nothing matching means the artifact's own class
      // decides — which is the only place a default varies by item rather than by kind.
      return verdict.rule ? verdict.effect : trustFallback(trust)
    },
  }
}

/**
 * Read one agent's rules and expose them as the three-way answer above.
 *
 * A function rather than a cached object: a catalog is built per request or per run, and
 * a verdict that outlived the toggle that changed it is exactly the staleness this
 * feature exists to end. The read is one statement over `capability_rule`.
 */
export async function readAvailability(
  db: Kysely<AppDatabase>,
  input: { userId: string; agentId: string },
): Promise<AvailabilityReader> {
  return availabilityOf(await resolveCapabilities(createCapabilityRuleRepository(db), input))
}

/**
 * Apply switches to a scope's rule list.
 *
 * BOTH directions are written, and that is the load-bearing part. "On" cannot be the mere
 * absence of a denial: absence means "nobody decided", which sends the item to its trust
 * gate — and a dropped-in plugin's gate answers OFF. Recording an explicit `allow` is how
 * the user's yes survives a gate that would otherwise say no.
 *
 * Monotone denial is untouched by that. A denial in any scope beats an `allow` in any
 * other, because composition takes the strictest verdict and never asks which scope was
 * more specific. So an `allow` records a decision without ever widening one.
 *
 * Only rules that are exactly the SWITCH for a name are touched — action equal, resource
 * `*`. A rule the user wrote about particular arguments (`tool:bash` over `rm *`) is left
 * alone: "bash is available" and "ask before rm" are different statements, and a toggle
 * must not silently delete the second one.
 */
export function applySwitches(
  current: readonly Rule[],
  kind: CapabilityKind,
  switches: ReadonlyArray<{ name: string; enabled: boolean }>,
): Rule[] {
  // One implementation, in `rule-changes.ts`. A switch is the case where the resource is the
  // capability itself, so it has nothing of its own left to express.
  return applyRuleChanges(
    current,
    switches.map((entry) => ({
      action: actionFor(kind, entry.name),
      resource: '*',
      effect: entry.enabled ? ('allow' as const) : ('deny' as const),
    })),
  )
}

/**
 * The write half: turn a switch into a rule.
 *
 * A port, and the ONLY way availability is stored, so a plugin's toggle and a tool's
 * toggle cannot disagree about what "off" means. Each owning service keeps its own side
 * effects — a plugin's dependency cascade, a host re-wire, a cache invalidation — because
 * those are domain facts; only the bit itself belongs here.
 */
export interface AvailabilityWriter {
  set(
    userId: string,
    agentId: string,
    kind: CapabilityKind,
    switches: ReadonlyArray<{ name: string; enabled: boolean }>,
  ): Promise<void>
  /**
   * The general form: rule changes across ANY kinds, in one read-modify-write of the list.
   *
   * `set` is the special case where the resource is the capability itself and the caller
   * already knows the kind. This is what the wire uses, because a request from the
   * Capabilities screen routinely spans kinds and applying it kind by kind was five
   * transactions that could interleave with another client's.
   */
  apply(userId: string, agentId: string, changes: readonly RuleChange[]): Promise<void>
  /**
   * Forget every decision about these names — the record is gone.
   *
   * Not the same as switching them off. A deletion must leave NO rule behind, or a
   * same-named artifact dropped in later would silently inherit the last owner's answer:
   * an old `allow` would run a stranger's code without anyone saying yes.
   */
  clear(
    userId: string,
    agentId: string,
    kind: CapabilityKind,
    names: readonly string[],
  ): Promise<void>
}

export function createAvailabilityWriter(db: Kysely<AppDatabase>): AvailabilityWriter {
  const rules = createCapabilityRuleRepository(db)
  /**
   * Every write advances the revision, without exception.
   *
   * It used to be advanced by the plugin and MCP services' own `onChanged` hooks and by
   * nothing else, so a tool, skill or agent switch — and a rules save from the editor — left
   * every other connected client holding a snapshot it had no way to know was stale. Worse
   * for the client that wrote it: answers are ordered by revision, so two switches at the
   * same revision could land out of order and the older one win.
   */
  const write = async (
    userId: string,
    agentId: string,
    change: (current: readonly Rule[]) => Rule[],
  ) => {
    // The repository bumps the revision once the write commits.
    await rules.mutate(userId, agentId, change)
  }

  return {
    async set(userId, agentId, kind, switches) {
      if (switches.length === 0) return
      await write(userId, agentId, (current) => applySwitches(current, kind, switches))
    },

    async apply(userId, agentId, changes) {
      if (changes.length === 0) return
      await write(userId, agentId, (current) => applyRuleChanges(current, changes))
    },

    async clear(userId, agentId, kind, names) {
      if (names.length === 0) return
      const actions = new Set(names.map((name) => actionFor(kind, name)))
      // Only the SWITCH rows go (action equal, resource `*`). A rule the user wrote about
      // particular arguments is theirs, and a deletion of the record it names leaves it
      // inert rather than rewriting their list behind their back.
      await write(userId, agentId, (current) =>
        current.filter((rule) => !(rule.resource === '*' && actions.has(rule.action))),
      )
    },
  }
}

/**
 * Record one permission rule a user approved permanently ("Always" on a confirmation card).
 *
 * Lives beside the availability writer because it is the same act — a user decision becoming a
 * row — just keyed by a RESOURCE rather than by a name. Re-approving the same pattern replaces
 * its row rather than stacking duplicates.
 *
 * WHERE it lands is the security half. The last match wins, so the row has to come after the
 * rule that raised the card (`outside-workspace ask`) or it silences nothing — but it used to be
 * APPENDED, which also put it after the danger guards. `tool:bash git * allow` below
 * `tool:bash dangerous ask` is the last match for `git push --force`, so "Always for git"
 * quietly disarmed the one confirmation the user still wanted. It now goes in just before the
 * trailing guards that could decide the same calls: past everything else, never past a guard.
 */
export function persistPermissionRule(
  rules: Pick<VersionedCapabilityRuleRepository, 'mutate'>,
  userId: string,
  agentId: string,
  rule: { action: string; resource: string },
): Promise<void> {
  return rules.mutate(userId, agentId, (current) => {
    const kept = current.filter(
      (existing) => !(existing.action === rule.action && existing.resource === rule.resource),
    )
    const at = beforeTrailingGuards(kept, rule.action)
    return [...kept.slice(0, at), { ...rule, effect: 'allow' as const }, ...kept.slice(at)]
  })
}

/** Resource classes no "Always" may out-rank: each names harm, not a place or a program. */
const GUARD_CLASSES = new Set(['dangerous', 'catastrophic', 'secrets'])

/** The index before the run of guards that ends the rules about `action`. */
function beforeTrailingGuards(rules: readonly Rule[], action: string): number {
  let at = rules.length
  for (let i = rules.length - 1; i >= 0; i -= 1) {
    const rule = rules[i]!
    if (!matches(rule.action, action)) continue
    if (rule.effect === 'allow' || !GUARD_CLASSES.has(rule.resource)) break
    at = i
  }
  return at
}

/**
 * The chat runtime's port for the above: the agent whose turn raised the card, a stored rule
 * out, revision bumped.
 *
 * Assembled HERE rather than at the composition root so bootstrap states a wiring, not a
 * policy — that an "Always" lands on the agent that asked, and that a live snapshot must be
 * invalidated after it, are capability facts.
 */
export function createPermissionRulePersister(db: Kysely<AppDatabase>) {
  const rules = createCapabilityRuleRepository(db)
  return async (
    userId: string,
    agentId: string,
    rule: { action: string; resource: string },
  ): Promise<void> => {
    await persistPermissionRule(rules, userId, agentId, rule)
  }
}
