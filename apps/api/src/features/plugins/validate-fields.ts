import type { DiscoveredPlugin } from './discovery'
import { BUILTIN_TOOL_NAMES } from '../agent-core/tool-names'
import { CC_SEMANTIC_GAPS } from '../ext/cc-tool-names'
import { DECLARABLE_EFFORTS_TEXT, isDeclarableEffort } from '../../db/types'

export interface FieldValidation {
  errors: string[]
  warnings: string[]
}

/**
 * Validate a plugin's commands (inline map entries and `commands/*.md` files). Names are unique
 * by construction: discovery keeps the first command of a name (`manifest-load.ts`).
 */
export function validatePluginCommands(plugin: DiscoveredPlugin): FieldValidation {
  const errors: string[] = []
  const warnings: string[] = []
  for (const cmd of plugin.commands) {
    if (!cmd.name) {
      errors.push('A declared command is missing a name.')
      continue
    }
    if (!cmd.prompt || cmd.prompt.trim().length === 0) {
      warnings.push(`Command "${cmd.name}" has an empty prompt template.`)
      continue
    }
    if (!cmd.description.trim()) {
      warnings.push(
        `Command "${cmd.name}" has no description — add one so users know what the command does in the composer menu.`,
      )
    }
    // A `${name}` placeholder no CC `arguments` entry names renders empty in the dispatched
    // prompt — most likely a typo.
    const positional = new Set(cmd.arguments ?? [])
    const placeholders = new Set(
      [...cmd.prompt.matchAll(/\$\{([a-zA-Z_][a-zA-Z0-9_-]*)\}/g)].map((match) => match[1]),
    )
    for (const token of placeholders) {
      // SCREAMING_CASE tokens are the config/env convention (${API_KEY}) — prompts
      // legitimately mention them as documentation, so only lowercase-style tokens
      // are treated as likely arg typos.
      if (!positional.has(token) && !/^[A-Z][A-Z0-9_]*$/.test(token)) {
        warnings.push(
          `Command "${cmd.name}" prompt references \${${token}} which isn't a declared arg.`,
        )
      }
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
      // `bash(rm *)` names the tool before its pattern.
      if (!BUILTIN_TOOL_NAMES.includes(tool.replace(/\(.*$/, ''))) {
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
  const lower = tool.toLowerCase()
  if (BUILTIN_TOOL_NAMES.includes(lower))
    return `"${tool}" — engine names are lowercase; use "${lower}".`
  return verb === 'lists'
    ? `"${tool}", which is not a built-in tool — it applies only when an enabled plugin or MCP server provides it.`
    : `"${tool}", which is not a built-in tool — it has an effect only when an enabled plugin or MCP server provides it.`
}

/**
 * Validate a plugin's custom worker roles (sub-agents) — names must be
 * unique (the namespaced `<plugin>:<name>` is the address), prompts non-empty,
 * tools real engine tools. A plugin may declare any number, as in Claude Code.
 */
export function validatePluginAgents(plugin: DiscoveredPlugin): FieldValidation {
  const errors: string[] = []
  const warnings: string[] = []
  const seenAgentNames = new Set<string>()
  for (const agent of plugin.agents) {
    if (!agent.name) {
      errors.push('A declared agent role is missing a name.')
      continue
    }
    if (seenAgentNames.has(agent.name)) {
      errors.push(`Duplicate agent role "${agent.name}" — names must be unique within a plugin.`)
    }
    seenAgentNames.add(agent.name)
    if (agent.name.startsWith(`${plugin.manifest.name}:`)) {
      // Dispatch resolves `<plugin>:<agent>` by splitting on the FIRST colon, so a
      // manifest name that repeats the plugin prefix becomes `<plugin>:<plugin>:<agent>`
      // and silently never matches — delegate degrades to a general-purpose agent.
      warnings.push(
        `Agent role "${agent.name}" repeats the plugin prefix — it is dispatched as "${plugin.manifest.name}:${agent.name}" and will never resolve. Name it "${agent.name.slice(plugin.manifest.name.length + 1)}" instead.`,
      )
    }
    if (!agent.description.trim()) {
      warnings.push(
        `Agent role "${agent.name}" has no description — add one so users know what this role does in the Store.`,
      )
    }
    if (!agent.prompt || agent.prompt.trim().length === 0) {
      warnings.push(`Agent role "${agent.name}" has an empty prompt.`)
    }
    for (const tool of agent.tools ?? []) {
      // Strip CC pattern syntax (Bash(git *) → bash) before gap/engine check.
      const lower = tool.split('(')[0].trim().toLowerCase()
      const gap = CC_SEMANTIC_GAPS[lower]
      if (gap) {
        warnings.push(`Agent role "${agent.name}" uses CC tool ${gap}.`)
      } else if (!BUILTIN_TOOL_NAMES.includes(tool)) {
        warnings.push(`Agent role "${agent.name}" lists tool ${unknownToolNote(tool, 'lists')}`)
      }
    }
    for (const entry of agent.disallowedTools ?? []) {
      // `bash(rm *)` denies calls of `bash`; the name before the specifier is what must exist.
      const tool = entry.split('(')[0]!.trim()
      if (!BUILTIN_TOOL_NAMES.includes(tool)) {
        warnings.push(
          `Agent role "${agent.name}" disallows tool ${unknownToolNote(tool, 'disallows')}`,
        )
      }
    }
    if (agent.preferredEffort && !isDeclarableEffort(agent.preferredEffort)) {
      warnings.push(
        `Agent role "${agent.name}" has an unrecognized effort value "${agent.preferredEffort}" — valid values: ${DECLARABLE_EFFORTS_TEXT}.`,
      )
    }
    // Pinned skill names should look like valid skill names (letters/numbers/dashes/underscores).
    // Namespaced forms like "plugin:skill" are not supported — pinnedSkills takes bare names.
    const seenPinnedSkills = new Set<string>()
    for (const skill of agent.pinnedSkills ?? []) {
      if (skill.includes(':')) {
        warnings.push(
          `Agent role "${agent.name}" pinnedSkills includes "${skill}" with a colon — use bare skill names (e.g., "deploy-guide"), not namespaced forms.`,
        )
      } else if (!/^[a-z0-9][a-z0-9_-]*$/i.test(skill)) {
        warnings.push(
          `Agent role "${agent.name}" pinnedSkills includes "${skill}" which isn't a valid skill name — use letters, digits, dashes, and underscores.`,
        )
      } else if (seenPinnedSkills.has(skill)) {
        warnings.push(
          `Agent role "${agent.name}" pinnedSkills has duplicate "${skill}" — remove the duplicate.`,
        )
      }
      seenPinnedSkills.add(skill)
    }
  }
  return { errors, warnings }
}
