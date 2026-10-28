import { ACTION_PREFIX, type CapabilityKind } from './resolve'
import { EFFECTS, type Effect } from '../agent-core/capability-rule'
import { RESOURCE_CLASSES } from '../agent-core/capability-resource-classes'

/**
 * THE RULE GRAMMAR, as one document the editor renders.
 *
 * Everything a person needs in order to write a rule — what a prefix means, what the three
 * effects do, which named classes exist, and a handful of worked rules — assembled from the
 * modules that already OWN each part rather than restated. The client renders it and names
 * none of it, so a kind, a class or an effect added on the server reaches the screen with no
 * client change.
 *
 * It rides the capability snapshot rather than a route of its own: a second endpoint would be
 * a second thing to keep in step with the first, and this answers the same question the
 * snapshot already answers — what may be said here.
 */

export interface RuleGrammar {
  /** What each action prefix addresses. */
  kinds: Array<{ prefix: string; label: string; hint: string }>
  /** What each effect does to a call. */
  effects: Array<{ value: Effect; hint: string }>
  /** The named resource classes — see `resource-classes.ts`. */
  classes: Array<{ value: string; hint: string; appliesTo: string[] }>
  /** Worked rules, written exactly as they are STORED. */
  examples: Array<{ action: string; resource: string; effect: Effect; note: string }>
}

/**
 * One line per kind, keyed so the compiler requires every prefix to have one.
 *
 * `Record<CapabilityKind, …>` is the load-bearing part: adding a kind to `ACTION_PREFIX`
 * without a description fails to compile rather than shipping a prefix the editor offers and
 * cannot explain.
 */
const KIND_HINTS: Record<CapabilityKind, { label: string; hint: string }> = {
  tool: { label: 'Tool', hint: 'A model-facing tool — what the agent may call, and with what' },
  skill: { label: 'Skill', hint: 'A reusable procedure the agent can load into a turn' },
  plugin: { label: 'Plugin', hint: 'A Claude Code plugin, and everything it contributes' },
  'mini-app': { label: 'Mini app', hint: 'A Localix mini app: its screens, backend and tools' },
  mcp: { label: 'MCP', hint: 'An MCP server, or one tool of it as `server/tool`' },
  agent: { label: 'Agent', hint: 'Whether an agent may be used at all' },
}

/** Invocation is not a capability KIND — it is about where an agent may run. */
const INVOCATION_KIND = {
  prefix: 'invocation:',
  label: 'Invocation',
  hint: 'Which host an agent may run in — chat, delegation, a schedule',
}

const EFFECT_HINTS: Record<Effect, string> = {
  allow: 'Runs without asking',
  ask: 'Prompts you each time; an unattended run refuses instead',
  deny: 'Refused — unless a later rule in this list says otherwise',
}

/**
 * Worked rules, chosen to teach the grammar rather than to cover it.
 *
 * Each one demonstrates something a reader cannot infer from the field labels: that order
 * decides, that a class is not a pattern, that the resource column means different things per
 * kind. They are validated against the real vocabulary by `rule-grammar.test.ts`, so an
 * example cannot drift into naming a class or prefix that no longer exists.
 */
const EXAMPLES: RuleGrammar['examples'] = [
  {
    action: 'tool:Bash',
    resource: '*',
    effect: 'allow',
    note: 'Shell runs without asking…',
  },
  {
    action: 'tool:Bash',
    resource: 'rm *',
    effect: 'deny',
    note: '…except rm — a later rule is the exception, because the last match wins',
  },
  {
    action: 'tool:Bash',
    resource: 'dangerous',
    effect: 'ask',
    note: 'Confirm destructive commands, however they are spelled — a class, not a pattern',
  },
  {
    action: 'tool:Read',
    resource: 'secrets',
    effect: 'ask',
    note: 'Confirm before reading anything that looks like a credential',
  },
  {
    action: 'tool:Write',
    resource: 'inside-workspace',
    effect: 'allow',
    note: 'Writing is fine within the project, wherever a denial above it applies',
  },
  {
    action: 'plugin:*',
    resource: 'untrusted',
    effect: 'ask',
    note: 'Ask once about anything that did not ship with Localix',
  },
  {
    action: 'invocation:delegation',
    resource: 'builtin:backend',
    effect: 'allow',
    note: 'Let the backend agent run delegated tasks — here the resource is an agent id',
  },
]

/** The whole grammar, assembled from the modules that own each part. */
export function ruleGrammar(): RuleGrammar {
  return {
    kinds: [
      ...Object.entries(ACTION_PREFIX).map(([kind, prefix]) => ({
        prefix,
        ...KIND_HINTS[kind as CapabilityKind],
      })),
      INVOCATION_KIND,
    ],
    effects: EFFECTS.map((value) => ({ value, hint: EFFECT_HINTS[value] })),
    classes: RESOURCE_CLASSES.map(({ value, hint, appliesTo }) => ({
      value,
      hint,
      appliesTo: [...appliesTo],
    })),
    examples: EXAMPLES,
  }
}
