import type { Rule } from '../agent-core/capability-rule'
import { ACTION_PREFIX, type CapabilityKind } from './resolve'

/**
 * A role's shipped defaults, translated into the rules of its own scope.
 *
 * An agent record already states what its role is made of — `tools`, `pinnedSkills`,
 * `mcp_servers` — and the settings editor already shows those lists. Until now a CHAT with
 * that agent ignored them: the run resolves availability from `capability_rule` by handle and
 * loads no record. This is the bridge, applied ONCE per agent as a seed. After that the rows
 * are the user's, and re-applying is what "reset to defaults" means.
 *
 * A seed, deliberately, and not a permanent overlay. A definition that kept overriding the
 * scope would make the Capabilities screen a liar — you would switch something on, and the
 * next run would switch it back.
 */

/**
 * A positive list CLOSES its kind.
 *
 * "The tools this role uses are read and search" has to mean the others are off, or it states
 * nothing at all: absence of a rule already means allowed (or the artifact's trust gate), so a
 * list of allows on its own narrows nothing. The closing deny goes FIRST because within one
 * scope the last match wins — the allows that follow carve the exceptions out of it.
 *
 * Across scopes nothing changes: composition takes the STRICTEST verdict, so a tool the
 * installation or the project has denied stays denied however this list reads. A preset can
 * only ever subtract.
 */
function closedList(kind: CapabilityKind, names: readonly string[]): Rule[] {
  return [
    { action: `${ACTION_PREFIX[kind]}*`, resource: '*', effect: 'deny' },
    ...names.map((name) => ({
      action: `${ACTION_PREFIX[kind]}${name}`,
      resource: '*',
      effect: 'allow' as const,
    })),
  ]
}

/**
 * A tool entry that names arguments rather than a capability.
 *
 * Claude Code writes `Bash(git status:*)` in its `allowed-tools`, and an imported record
 * carries it verbatim. As a capability ACTION that is meaningless — the action is the tool,
 * and the arguments belong in a rule's `resource` — so the argument form is reduced to the
 * tool it names rather than seeded as a capability nobody has.
 */
const toolName = (entry: string): string => entry.split('(')[0]!.trim()

export interface AgentPresetSource {
  /** A positive list: the tools the role is made of. Absent = inherit, `[]` = none. */
  tools?: string[]
  /** A negative list: subtracted on top, so it wins over anything the positive list allowed. */
  disallowedTools?: string[]
  pinnedSkills?: string[]
  mcp_servers?: string[]
}

/**
 * The rules that express one record's preset, in the order they must be stored.
 *
 * Empty when the record states nothing — which is the answer for most agents, and means the
 * scope inherits exactly as it does today. Plugins are absent on purpose: a record has no
 * field for them, and inventing one here would seed a decision nobody made.
 */
export function agentPresetRules(record: AgentPresetSource): Rule[] {
  const rules: Rule[] = []
  if (record.tools) rules.push(...closedList('tool', record.tools.map(toolName)))
  if (record.pinnedSkills) rules.push(...closedList('skill', record.pinnedSkills))
  if (record.mcp_servers) rules.push(...closedList('mcp', record.mcp_servers))
  // Last, so a name on both lists ends up denied: a role that says "not this one" means it.
  for (const entry of record.disallowedTools ?? []) {
    rules.push({ action: `${ACTION_PREFIX.tool}${toolName(entry)}`, resource: '*', effect: 'deny' })
  }
  return rules
}

/** Whether this record has anything to seed at all. */
export const hasAgentPreset = (record: AgentPresetSource): boolean =>
  agentPresetRules(record).length > 0
