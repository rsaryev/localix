import { builtinAgentId, DEFAULT_AGENT_NAME } from '@localixai/agent/agents'
import type { Rule } from '../agent-core/capability-rule'

/** Only the installed Localix definition has a shipped policy. */
const HOSTS = ['chat', 'delegation', 'automation', 'channel', 'verification']

/**
 * The confirmations every shipped role asks for, whatever else it is made of.
 *
 * These three used to be `DEFAULT_PERMISSION_RULES` — a baseline the engine evaluated
 * alongside the stored rules, terminal in one direction and silenceable in another, with a
 * carve-out explaining when a stored `allow` could override them. They are rules like any
 * other now, and the only thing that makes them a floor is where they sit: LAST, so they are
 * the most specific statement in the list and the closing `deny`/`allow` pair above cannot
 * swallow them.
 *
 * That also makes them removable, by the user, in the editor, deliberately — which is the
 * honest arrangement for a local app whose owner is the person running it. What it stops is
 * the quiet removal: an "Always" on a card writes `tool:Bash` over `git *`, and that row is
 * placed BEFORE these guards (`persistPermissionRule`), because last match wins and both match
 * `git push --force` — appended, it used to be the one that decided.
 */
const BASELINE: Rule[] = [
  {
    action: 'tool:*',
    resource: 'outside-workspace',
    effect: 'ask',
    message: 'This reads or touches a path OUTSIDE the project workspace. Allow it?',
  },
  {
    action: 'tool:Bash',
    resource: 'dangerous',
    effect: 'ask',
    message: 'This command looks destructive (rm -rf / sudo / etc.). Allow it?',
  },
]

export function builtinAgentPreset(name: string): Rule[] {
  if (name !== DEFAULT_AGENT_NAME) return []
  const id = builtinAgentId(name)
  return [
    // Tools are open candidates; the run shape and saved policy still control admission.
    ...BASELINE,
    { action: 'invocation:*', resource: id, effect: 'deny' },
    ...HOSTS.map((host) => ({
      action: `invocation:${host}`,
      resource: id,
      effect: 'allow' as const,
    })),
  ]
}

const BUILTIN_PREFIX = 'builtin:'

/**
 * The shipped answer for an agent SCOPE, or null when the scope is not a system agent's.
 *
 * The rules editor offers a reset to it, which is why this is a read rather than a second
 * seeding path: `seedAgentPresets` writes these rows at most once per preset version, so
 * between versions a user who narrowed a role we ship has no way back to our answer. Only
 * the roles the product owns have one — an agent the user authored has no default to
 * restore, and a `null` here is how the editor knows not to offer the control.
 */
export function builtinAgentPresetFor(agentId: string): Rule[] | null {
  if (!agentId.startsWith(BUILTIN_PREFIX)) return null
  const rules = builtinAgentPreset(agentId.slice(BUILTIN_PREFIX.length))
  return rules.length > 0 ? rules : null
}

/**
 * What a newly authored agent starts with: the default agent's own list, re-pointed at it.
 *
 * A new agent used to be created with nothing but `invocation:<host> allow` for every host
 * the installation knows — so it had no roster (fine, that is `localix`'s answer too) and,
 * more importantly, none of the BASELINE confirmations. The agent a user made five seconds
 * ago could touch a path outside the workspace or run `rm -rf` without asking, while every
 * shipped role asked. Nobody chose that; it is what an empty list means once silence allows.
 *
 * Inheriting `localix` rather than inventing a second default is the point: there is one
 * answer to "what may an agent do by default", the user can see it in the editor the moment
 * the agent exists, and changing our default changes what new agents inherit tomorrow.
 *
 * Every rule that NAMES the default agent (the invocation rows) is re-pointed, because those
 * are about identity rather than policy — inheriting them verbatim would grant hosts to an
 * agent that is not this one.
 */
export function inheritedAgentPreset(agentId: string): Rule[] {
  const defaultId = builtinAgentId(DEFAULT_AGENT_NAME)
  return builtinAgentPreset(DEFAULT_AGENT_NAME).map((rule) =>
    rule.resource === defaultId ? { ...rule, resource: agentId } : rule,
  )
}
