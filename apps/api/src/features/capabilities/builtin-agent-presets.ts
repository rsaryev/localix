import { builtinAgentId, DEFAULT_AGENT_HANDLE } from '@localixai/agent/agents'
import { BUILTIN_TOOL_NAMES } from '../agent-core/tool-names'
import type { Rule } from './rule'

/**
 * What a role sitting in a chat has. It includes the tools whose exposure is `chat` only
 * (`ask`, `configure`, `jobs`) — a preset is a CLOSED list, so a tool left out here is
 * denied to that role everywhere, and `configure` in particular is how the agent asks for the
 * rest of this list to change.
 */
/**
 * Installation defaults, independent of the portable agent definitions.
 *
 * ONE ENTRY PER SHIPPED AGENT, and no others. Three more used to sit here — `implementer`,
 * `verifier`, `researcher` — after the agents themselves were retired (`agents/builtin.ts`:
 * implementing, reviewing and investigating are things each member does, not colleagues of
 * their own). A preset for an agent that does not exist is reachable by nothing: the seeder
 * walks the installed agents and `builtinAgentPresetFor` parses a builtin agent id. So they
 * were read only by the test that used one as a fixture, which is how three stale tool lists
 * went on looking like policy.
 *
 * A name here is a CANDIDATE, not a promise: the run shape it lands in still has to be able
 * to carry the tool (`run-shape.ts`), which is why an allow whose every host surface excludes
 * it is a defect rather than a harmless extra — `builtin-team.test.ts` fails on one.
 */
const TOOLS: Record<string, readonly string[]> = {
  lead: BUILTIN_TOOL_NAMES,
  pm: BUILTIN_TOOL_NAMES,
  architect: BUILTIN_TOOL_NAMES,
  backend: BUILTIN_TOOL_NAMES,
  frontend: BUILTIN_TOOL_NAMES,
  qa: BUILTIN_TOOL_NAMES,
  design: BUILTIN_TOOL_NAMES,
  devops: BUILTIN_TOOL_NAMES,
}

/**
 * Every host a shipped role may be invoked in.
 *
 * `chat` used to be conditional, on a set naming the conversational roles — because the task
 * workers we used to ship were denied it, so that seating one in a conversation could not
 * produce a reply that was really a policy error in that agent's voice. Every role we ship is a colleague now, so
 * the set named all of them and the condition excluded nobody. A role the product adds that
 * must NOT be talked to states that by denying `invocation:chat`, where the reader is already
 * looking.
 */
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
 * the quiet removal: an "Always" on a card writes `tool:bash` over `git *`, and that row is
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
    action: 'tool:bash',
    resource: 'dangerous',
    effect: 'ask',
    message: 'This command looks destructive (rm -rf / sudo / etc.). Allow it?',
  },
]

export function builtinAgentPreset(handle: string): Rule[] {
  const tools = TOOLS[handle]
  // Before the ID is built, not after: `builtinAgentId` PARSES the handle, so a name we do
  // not ship — which is what an agent id off the wire can be — threw instead of answering
  // "no preset". The early return is the answer for every handle that is not ours.
  if (!tools && handle !== DEFAULT_AGENT_HANDLE) return []
  const id = builtinAgentId(handle)
  return [
    // `localix` has no closed list on purpose: it is the agent that always exists, the one
    // every question falls back to, and a roster it could fall behind is a worse answer than
    // "everything installed". Silence means allowed, so absence here IS that answer.
    ...(tools
      ? [
          { action: 'tool:*', resource: '*', effect: 'deny' as const },
          ...tools.map((name) => ({
            action: `tool:${name}`,
            resource: '*',
            effect: 'allow' as const,
          })),
        ]
      : []),
    // After the roster, because last match wins and these are about ARGUMENTS, not tools.
    // Put them first and the `tool:read * allow` below would answer for a read outside the
    // workspace too, silently dropping the confirmation.
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
  const defaultId = builtinAgentId(DEFAULT_AGENT_HANDLE)
  return builtinAgentPreset(DEFAULT_AGENT_HANDLE).map((rule) =>
    rule.resource === defaultId ? { ...rule, resource: agentId } : rule,
  )
}
