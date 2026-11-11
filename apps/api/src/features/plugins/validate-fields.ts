import type { DiscoveredPlugin } from './discovery'
import { BUILTIN_TOOL_NAMES } from '../agent-core/tool-names'
import { namesBuiltinTool } from './kit'

export interface FieldValidation {
  errors: string[]
  warnings: string[]
}

/**
 * Localix's checks of a plugin's commands; the kit reads them and reports what Claude Code's own
 * validator does (a missing name or description, frontmatter). Named:
 * - an empty command, which would dispatch nothing to the model;
 * - a tool `allowed-tools` or `disallowed-tools` names that Localix's engine does not have.
 */
export function validatePluginCommands(plugin: DiscoveredPlugin): FieldValidation {
  const errors: string[] = []
  const warnings: string[] = []
  for (const cmd of plugin.commands) {
    if (!cmd.prompt || cmd.prompt.trim().length === 0) {
      warnings.push(`Command "${cmd.name}" has an empty prompt template.`)
      continue
    }
    for (const tool of cmd.allowedTools ?? []) {
      // `bash(git add:*)` names the tool before its pattern.
      if (!BUILTIN_TOOL_NAMES.includes(tool.replace(/\(.*$/, ''))) {
        warnings.push(
          `Command "${cmd.name}" allowedTools lists "${tool}" which isn't a known engine tool — it will be ignored.`,
        )
      }
    }
    for (const tool of cmd.disallowedTools ?? []) {
      if (!namesBuiltinTool(tool, BUILTIN_TOOL_NAMES)) {
        warnings.push(
          `Command "${cmd.name}" disallowedTools lists "${tool}" which isn't a known engine tool — it has no effect.`,
        )
      }
    }
  }
  return { errors, warnings }
}

/**
 * What to say about a role's tool that is not a built-in.
 *
 * A capitalized built-in name is a typo and is named as one. Anything else may be a tool an
 * enabled plugin or MCP server provides — a role declaring another plugin's tool keeps it on a
 * closed surface — and the validator reads manifests, not loaded plugins, so it cannot know. It
 * used to say the tool "will be ignored", which was false for every plugin tool.
 */
function unknownToolNote(tool: string, verb: 'lists' | 'disallows'): string {
  return verb === 'lists'
    ? `"${tool}", which is not a built-in tool — it applies only when an enabled plugin or MCP server provides it.`
    : `"${tool}", which is not a built-in tool — it has an effect only when an enabled plugin or MCP server provides it.`
}

/**
 * Localix's checks of a plugin's agents; the kit reads them (one per name, a missing description
 * reported and filled in) and reports what Claude Code's own validator does. Named:
 * - a name that repeats the plugin prefix, which Localix's dispatch (`<plugin>:<agent>`, split on
 *   the first colon) never resolves;
 * - an empty prompt;
 * - a tool `tools` or `disallowedTools` names that is not one of Localix's built-ins;
 * - a `skills` entry Localix cannot preload (namespaced, not a skill name, or repeated).
 */
export function validatePluginAgents(plugin: DiscoveredPlugin): FieldValidation {
  const errors: string[] = []
  const warnings: string[] = []
  for (const { name, definition: agent } of plugin.agents) {
    if (name.startsWith(`${plugin.manifest.name}:`)) {
      // Dispatch resolves `<plugin>:<agent>` by splitting on the FIRST colon, so a
      // manifest name that repeats the plugin prefix becomes `<plugin>:<plugin>:<agent>`
      // and silently never matches — delegate degrades to a general-purpose agent.
      warnings.push(
        `Agent role "${name}" repeats the plugin prefix — it is dispatched as "${plugin.manifest.name}:${name}" and will never resolve. Name it "${name.slice(plugin.manifest.name.length + 1)}" instead.`,
      )
    }
    if (!agent.prompt || agent.prompt.trim().length === 0) {
      warnings.push(`Agent role "${name}" has an empty prompt.`)
    }
    // In Claude Code's names (`Grep`, `Bash(git *)`), as the kit reads them (`kit/subagent-tools.ts`).
    for (const tool of agent.tools ?? []) {
      if (tool !== '*' && !namesBuiltinTool(tool, BUILTIN_TOOL_NAMES))
        warnings.push(`Agent role "${name}" lists tool ${unknownToolNote(tool, 'lists')}`)
    }
    for (const tool of agent.disallowedTools ?? []) {
      if (!namesBuiltinTool(tool, BUILTIN_TOOL_NAMES))
        warnings.push(`Agent role "${name}" disallows tool ${unknownToolNote(tool, 'disallows')}`)
    }
    // Pinned skill names should look like valid skill names (letters/numbers/dashes/underscores).
    // Namespaced forms like "plugin:skill" are not supported — `skills` takes bare names.
    const seenPinnedSkills = new Set<string>()
    for (const skill of agent.skills ?? []) {
      if (skill.includes(':')) {
        warnings.push(
          `Agent role "${name}" skills includes "${skill}" with a colon — use bare skill names (e.g., "deploy-guide"), not namespaced forms.`,
        )
      } else if (!/^[a-z0-9][a-z0-9_-]*$/i.test(skill)) {
        warnings.push(
          `Agent role "${name}" skills includes "${skill}" which isn't a valid skill name — use letters, digits, dashes, and underscores.`,
        )
      } else if (seenPinnedSkills.has(skill)) {
        warnings.push(
          `Agent role "${name}" skills has duplicate "${skill}" — remove the duplicate.`,
        )
      }
      seenPinnedSkills.add(skill)
    }
  }
  return { errors, warnings }
}
