import { resourceClassOf } from '../agent-core/capability-resource-classes'
import {
  evaluate,
  matches,
  type Effect,
  type Rule,
  type Verdict,
} from '../agent-core/capability-rule'
import type { CapabilityRuleRepository } from './rule-repository'

/**
 * THE capability resolver: from an agent to what its runs may do.
 *
 * One call answers for every kind, so the settings screen and the run cannot disagree — which
 * they could, and did, when availability was projected independently in each.
 *
 * There is no chain. The agent's own rules ARE the policy: one ordered list, last match wins.
 * A narrower agent is a different agent, which is the one concept this feature has left.
 */

/** How a capability is addressed. The prefix is the kind; the rest is the name. */
export const ACTION_PREFIX = {
  tool: 'tool:',
  plugin: 'plugin:',
  /** A Localix mini app: its own kind, so a rule about it never reaches a plugin of that name. */
  'mini-app': 'mini-app:',
  mcp: 'mcp:',
  skill: 'skill:',
  agent: 'agent:',
} as const
export type CapabilityKind = keyof typeof ACTION_PREFIX

export const actionFor = (kind: CapabilityKind, name: string) => `${ACTION_PREFIX[kind]}${name}`

/**
 * What a list that says nothing means — the same answer for every kind.
 *
 * There used to be a table here: `tool`/`skill` defaulted to allowed, `plugin`/`mcp`/`agent`
 * to denied, because a dropped-in plugin must not start running because someone copied a
 * folder. That fact is real, but it was never about the KIND — a bundled plugin and a
 * third-party one are the same kind and deserve opposite answers. It belongs to the artifact,
 * so it now travels as the artifact's trust class in `resource` (see `trust.ts`) where a rule
 * can name it, instead of as a default no rule could reach.
 */
const FALLBACK: Effect = 'allow'

export interface ResolvedCapabilities {
  /** The verdict, with the rule responsible for it. */
  verdict(kind: CapabilityKind, name: string, resource?: string): Verdict
  /** Shorthand for "is it usable at all" — a `deny` on the capability itself. */
  allows(kind: CapabilityKind, name: string): boolean
  /** Of `roster`, the names this run may NOT use. The shape a tool registry subtracts with. */
  denied(kind: CapabilityKind, roster: readonly string[]): string[]
  /** Every rule in force, in order — for a screen that explains the whole picture. */
  rules: readonly Rule[]
}

export interface ResolveInput {
  userId: string
  /** The agent whose turn this is. Every run has one; `localix` is the one that always exists. */
  agentId: string
}

export async function resolveCapabilities(
  repo: CapabilityRuleRepository,
  input: ResolveInput,
): Promise<ResolvedCapabilities> {
  return composeCapabilities(await repo.read(input.userId, input.agentId))
}

/** The pure half — the rules already loaded, so the decision itself is directly testable. */
export function composeCapabilities(rules: readonly Rule[]): ResolvedCapabilities {
  const verdict = (kind: CapabilityKind, name: string, resource = '*') =>
    evaluate(rules, actionFor(kind, name), resource, FALLBACK)
  return {
    verdict,
    allows: (kind, name) => verdict(kind, name).effect !== 'deny',
    denied: (kind, roster) => roster.filter((name) => verdict(kind, name).effect === 'deny'),
    rules,
  }
}

/**
 * Registry removal needs proof that the rules deny every call, not the verdict for the literal
 * resource "*". A later argument exception keeps the tool registered; the live gate still
 * judges every call. Conservatively retaining a tool with potentially overlapping exceptions
 * never grants permission to execute it.
 *
 * WHAT COUNTS AS SUCH AN EXCEPTION is the question this used to get wrong. An exception has to be
 * able to make SOME call reachable, and two shapes are:
 *
 *   - an `allow`, whatever its resource — including a class, which is how "deny writes, allow
 *     `inside-workspace`" is written;
 *   - an `ask` on an ordinary PATTERN (`tool:Bash git *`), because someone named a particular
 *     thing to be asked about, and a person can say yes to it.
 *
 * An `ask` on a named resource CLASS is not. A class asks about the MANNER of a call —
 * `outside-workspace`, `dangerous` — so it presupposes a call that is already permitted and adds
 * a question to it; it cannot be the thing that permits it. Every preset ends with two of exactly
 * that, and reading them as exceptions made this function answer "nothing is denied" for every
 * shipped agent: measured on `qa`, one blanket deny, 23 allows, 0 of 28 catalog tools removed. So
 * a closed allowlist shipped the whole catalog on the wire and refused the calls one at a time —
 * the model paid for 28 schemas to be told "not permitted here", which a member
 * was seen suffering mid-turn. Removal is strictly more restrictive than the refusal it
 * replaces, so nothing reachable is lost.
 */
function toolDenial(rules: readonly Rule[], name: string): Rule | null {
  let denying: Rule | null = null
  for (const rule of rules) {
    if (!matches(rule.action, actionFor('tool', name))) continue
    if (rule.resource === '*') {
      denying = rule.effect === 'deny' ? rule : null
      continue
    }
    const opensADoor =
      rule.effect === 'allow' ||
      // `resourceClassOf` is the one list of classes, so a class added there is understood here
      // without this file learning its name.
      (rule.effect === 'ask' && resourceClassOf(rule.resource) === undefined)
    if (opensADoor) denying = null
  }
  return denying
}

/** Where each tool's denial is written — the ledger's `policy` reason. */
export interface ToolDenial {
  name: string
  rule: Rule
}

/**
 * What actually EXISTS to rule on, per kind.
 *
 * One entry per kind, and every one of them required, because the projection can only
 * subtract from what it is given: a kind handed an empty roster silently answers "nothing is
 * denied", which is how `skill:` rules were written, shown as off in Settings and still
 * loaded into every turn. Naming the roster is therefore the caller's statement that it knows
 * the full candidate set — `[]` means "this caller has no members of that kind", never
 * "I have not looked them up yet".
 */
export type CapabilityRosters = Record<CapabilityKind, readonly string[]>

/** An empty roster for every kind — a starting point for a caller that fills in a few. */
export const NO_ROSTERS: CapabilityRosters = {
  tool: [],
  skill: [],
  plugin: [],
  'mini-app': [],
  mcp: [],
  agent: [],
}

export interface CapabilityProjection {
  /** Of each roster, the names this run may NOT use. What every registry subtracts with. */
  denied: Record<CapabilityKind, string[]>
  /** The denying rule behind every denied TOOL, in the same order. */
  toolDenials: ToolDenial[]
  permissions: Array<{
    permission: string
    pattern: string
    action: Effect
    message?: string
  }>
}

/** The prompt's shape for denied skills. Derived, so no second notion of "off" exists. */
export const skillOverridesOf = (denied: readonly string[]): Record<string, 'off'> =>
  Object.fromEntries(denied.map((name) => [name, 'off' as const]))

/**
 * The shapes the run and the report both ask for, for every kind at once.
 *
 * A deny-list per kind is what a registry subtracts with; a permission list is what the
 * permission engine evaluates. Both are projections of the same verdicts — assembling them at
 * the composition root is how the report and the run drifted apart before. Tools get one
 * extra: the denying rule behind each name, because only a tool has a remedy to offer.
 */
export function projectCapabilities(
  resolved: ResolvedCapabilities,
  rosters: CapabilityRosters,
): CapabilityProjection {
  const toolDenials = rosters.tool.flatMap((name) => {
    const rule = toolDenial(resolved.rules, name)
    return rule ? [{ name, rule }] : []
  })
  return {
    denied: {
      // Tools answer from `toolDenial`, not `denied()`: a later argument exception keeps the
      // tool registered, and the live gate judges each call. The other kinds have no
      // arguments, so the verdict on the capability itself is the whole answer.
      tool: toolDenials.map((denial) => denial.name),
      skill: resolved.denied('skill', rosters.skill),
      plugin: resolved.denied('plugin', rosters.plugin),
      'mini-app': resolved.denied('mini-app', rosters['mini-app']),
      mcp: resolved.denied('mcp', rosters.mcp),
      agent: resolved.denied('agent', rosters.agent),
    },
    toolDenials,
    // Order is preserved, because order IS the semantics: the gate applies the same
    // last-match rule to this list that `verdictIn` applies to the stored one.
    permissions: resolved.rules.flatMap((rule) =>
      rule.action === '*' || rule.action.startsWith(ACTION_PREFIX.tool)
        ? [
            {
              permission: rule.action === '*' ? '*' : rule.action.slice(ACTION_PREFIX.tool.length),
              pattern: rule.resource,
              action: rule.effect,
              ...(rule.message ? { message: rule.message } : {}),
              ...(rule.personMessage ? { personMessage: rule.personMessage } : {}),
            },
          ]
        : [],
    ),
  }
}
