import type { PermissionMode } from './permission-modes'
import { composeCapabilities, type ResolvedCapabilities } from './resolve'
import { resourceClassOf } from './resource-classes'
import type { Rule } from './rule'

/**
 * WHAT A SESSION MODE DOES TO A RUN — a deterministic rewrite of the agent's rules, and nothing
 * else.
 *
 * The defect this shape exists to prevent is the one that got the old agent modes deleted: a
 * mode that filtered the tool list, branched inside the gate and wrote its own prompt section
 * was a SECOND answer to "may this call run", and the two answers drifted ("a tool switched ON
 * in Capabilities could still be absent from the turn"). So a mode here has exactly two levers,
 * and every other behaviour is derived from them by machinery that already exists:
 *
 *   rules           the agent's own list, rewritten. The projection, the roster, the gate and
 *                   the prompt's `hasTool` sections all read the result, so they cannot disagree.
 *   humanReachable  whether a person is expected to answer. It cannot be a rule: a tool's own
 *                   card (`configure propose`, `vault create`) is raised inside its execute, past
 *                   every rule, and a blocking wait is decided by who is there, not by the call.
 *
 * Every strategy is pure, keeps the agent's rows in their order, and only APPENDS denials (the
 * one row a strategy may DROP is a class question in a mode that stops asking — `stopAsking`
 * says why dropping, not allowing, is what keeps a denial a denial). Order
 * is strength in a last-match list, so an appended `deny` is the strongest statement in it — and
 * it survives the skill fold, which moves every denial after a skill's allows
 * (`permission-gate-build.ts`). A mode never appends an `allow`: placed last, an allow would
 * silence the baseline's `outside-workspace` question for whatever it matched.
 *
 * The rewritten list is never stored. The agent's rules are the user's; a mode is the session's
 * state and ends when the session leaves it.
 */

export interface ModePolicy {
  rules: Rule[]
  humanReachable: boolean
}

type ModeStrategy = (rules: readonly Rule[]) => ModePolicy

/*
 * No mode owns a tool. `plan` once existed only in plan mode, denied over `*` by every other —
 * which took it off the roster the moment an approval switched the mode, so the implementing run
 * could neither re-read the plan nor declare it done. The tool now lives in every mode and gates
 * its own actions on the plan's state (`agent-core/tools/plan`).
 */

const PLAN_REFUSAL =
  'Plan mode is read-only: this call would change files, the host or something outside it. ' +
  'Investigate with reads instead. Then present the plan with the `plan` tool (action ' +
  '`present`) for the user to approve — or, in a delegated session without that tool, report ' +
  'your findings to the agent that delegated the work.'

/** Plan: everything that reaches past this conversation is refused; reads, views and the
 *  conversation's own state (a board card, a queued question, a delegated explorer) are not. */
const PLAN_DENIALS: Rule[] = (['files', 'host', 'external'] as const).map((effect) => ({
  action: 'tool:*',
  resource: `effect:${effect}`,
  effect: 'deny',
  message: PLAN_REFUSAL,
  personMessage: 'Plan mode is read-only',
}))

/** A bypass session stops asking; it does not start destroying the machine. */
const CATASTROPHIC_DENIAL: Rule = {
  action: 'tool:*',
  resource: 'catastrophic',
  effect: 'deny',
  message:
    'This destroys something no backup brings back, and this session was set to stop asking ' +
    'rather than to allow that. Find another way, or ask the user to switch the mode.',
  personMessage: 'Bypass mode never runs a call that cannot be undone',
}

const UNATTENDED_DENIAL: Rule = {
  action: 'tool:*',
  resource: 'needs-human',
  effect: 'deny',
  message:
    'This session is autonomous: nobody is expected to answer a question or approve a card. ' +
    'Decide with the information you have, state the assumption in your reply, and continue.',
  personMessage: 'This conversation is autonomous, so nobody could approve this call',
}

/**
 * Stop asking — without lifting anything the agent refused.
 *
 * The defect this exists to stop: every `ask` used to become an `allow` in place, and the
 * presets' own class questions (`outside-workspace`, `dangerous`) sit LAST in every preset, after
 * its closed-list `deny`. Last match wins, so the converted row overruled the denial for every
 * call it matched — a tool switched off for the agent became callable with a path outside the
 * workspace, and the projection, reading an `allow` as an exception, put the tool back on the
 * roster. "Bypass keeps denials" held only for calls that touched nothing outside.
 *
 * So a question is rewritten by what it is about, the same line `resolve.ts` draws for removal:
 *
 *   a NAMED thing (`tool:bash git push* ask`, `tool:bash * ask`) — a door the agent left ajar,
 *     often as the exception to a denial before it. Stopping asking walks through it: `allow`,
 *     in place, because position is strength and moving it would change what it overrides;
 *   a CLASS of call (`outside-workspace`, `dangerous`, `effect:files`, …) — the MANNER of a call
 *     some other row already permits; it opens nothing. Removed, so the call gets the answer the
 *     agent's other rows give: allowed where they allow it, refused where they refuse it.
 *
 * Rules about plugins, skills and agents are not questions about a call and are left alone.
 */
const isToolQuestion = (rule: Rule) =>
  rule.effect === 'ask' && (rule.action === '*' || rule.action.startsWith('tool:'))

const asksAboutAClass = (rule: Rule) =>
  rule.resource !== '*' && resourceClassOf(rule.resource) !== undefined

const stopAsking = (rules: readonly Rule[]): Rule[] =>
  rules.flatMap((rule) => {
    if (!isToolQuestion(rule)) return [rule]
    return asksAboutAClass(rule) ? [] : [{ ...rule, effect: 'allow' as const }]
  })

const STRATEGIES: Record<PermissionMode, ModeStrategy> = {
  default: (rules) => ({ rules: [...rules], humanReachable: true }),
  plan: (rules) => ({ rules: [...rules, ...PLAN_DENIALS], humanReachable: true }),
  bypass: (rules) => ({
    rules: [...stopAsking(rules), CATASTROPHIC_DENIAL],
    humanReachable: true,
  }),
  autonomous: (rules) => ({
    rules: [...stopAsking(rules), CATASTROPHIC_DENIAL, UNATTENDED_DENIAL],
    humanReachable: false,
  }),
}

export function applyPermissionMode(mode: PermissionMode, rules: readonly Rule[]): ModePolicy {
  return STRATEGIES[mode](rules)
}

/**
 * The agent's resolved capabilities as this session's mode sees them. Applied ONCE, where a run
 * admits its agent, so the plugin narrowing, the tool projection, the gate's list and the
 * prompt's `hasTool` sections all derive from the same rewritten rules.
 */
export function capabilitiesInMode(
  capabilities: ResolvedCapabilities,
  mode: PermissionMode,
): { capabilities: ResolvedCapabilities; humanReachable: boolean } {
  const policy = applyPermissionMode(mode, capabilities.rules)
  return { capabilities: composeCapabilities(policy.rules), humanReachable: policy.humanReachable }
}
