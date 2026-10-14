import { existsSync } from 'node:fs'
import type { DiscoveredPlugin } from './discovery'
import { confineToDir } from '../ext/fs-discovery'
import { AGENTS_MAX_PER_PLUGIN } from './contracts'
import { BUILTIN_TOOL_NAMES } from '../agent-core/tool-names'
import { CC_SEMANTIC_GAPS } from '../ext/cc-tool-names'
import { DECLARABLE_EFFORTS_TEXT, isDeclarableEffort } from '../ext/manifest-validate'

export interface FieldValidation {
  errors: string[]
  warnings: string[]
}

/**
 * Validate a plugin's inline command declarations. Names must be unique — they're
 * invoked namespaced as `<plugin>:<name>`, so a duplicate silently shadows its
 * twin in the command list and dispatch (mirrors the agent-role uniqueness check).
 */
export function validatePluginCommands(plugin: DiscoveredPlugin): FieldValidation {
  const errors: string[] = []
  const warnings: string[] = []
  const seenCmdNames = new Set<string>()
  for (const cmd of plugin.commands) {
    if (!cmd.name) {
      errors.push('A declared command is missing a name.')
      continue
    }
    if (seenCmdNames.has(cmd.name)) {
      errors.push(
        `Duplicate command "${cmd.name}" — names must be unique within a plugin (each is invoked as "${plugin.manifest.name}:${cmd.name}").`,
      )
    }
    seenCmdNames.add(cmd.name)
    if (!cmd.prompt || cmd.prompt.trim().length === 0) {
      warnings.push(`Command "${cmd.name}" has an empty prompt template.`)
      continue
    }
    if (!cmd.description.trim()) {
      warnings.push(
        `Command "${cmd.name}" has no description — add one so users know what the command does in the composer menu.`,
      )
    }
    // An argumentHint like "[env] [tag]" with no declared args: the hint shows in the
    // composer but no structured arg parsing happens (users still get $ARGUMENTS).
    if (cmd.argumentHint && cmd.args.length === 0) {
      warnings.push(
        `Command "${cmd.name}" has "argumentHint" but no declared "args" — add args for structured argument parsing and validation.`,
      )
    }
    // Cross-check declared args against the `${name}` placeholders the prompt
    // actually uses — a declared-but-unreferenced arg is silently dropped input,
    // and an undeclared placeholder renders empty in the dispatched prompt.
    const placeholders = new Set(
      [...cmd.prompt.matchAll(/\$\{([a-zA-Z_][a-zA-Z0-9_-]*)\}/g)].map((match) => match[1]),
    )
    const seenArgNames = new Set<string>()
    for (const [argIndex, arg] of cmd.args.entries()) {
      if (seenArgNames.has(arg.name)) {
        errors.push(`Command "${cmd.name}" declares duplicate arg "${arg.name}".`)
      }
      seenArgNames.add(arg.name)
      if (!placeholders.has(arg.name)) {
        warnings.push(
          `Command "${cmd.name}" declares arg "${arg.name}" but its prompt never references \${${arg.name}}.`,
        )
      }
      // DYNAMIC options (`optionsScript`): a plugin-relative script that produces the
      // arg's options on demand. Only on a choice arg, mutually exclusive with static
      // `options`, and its path must stay inside the plugin dir.
      if (arg.optionsScript) {
        if (arg.type !== 'choice') {
          errors.push(
            `Command "${cmd.name}" arg "${arg.name}" declares "optionsScript" but is type "${arg.type}" — dynamic options only apply to a "choice" arg.`,
          )
        }
        if (arg.options && arg.options.length > 0) {
          errors.push(
            `Command "${cmd.name}" arg "${arg.name}" declares BOTH "optionsScript" and static "options" — use one or the other.`,
          )
        }
        const abs = confineToDir(plugin.dir, arg.optionsScript)
        if (!abs) {
          errors.push(
            `Command "${cmd.name}" arg "${arg.name}" optionsScript "${arg.optionsScript}" escapes the plugin directory.`,
          )
        } else if (!existsSync(abs)) {
          warnings.push(
            `Command "${cmd.name}" arg "${arg.name}" optionsScript "${arg.optionsScript}" was not found (its picker will be empty until the file exists).`,
          )
        }
      }
      if (arg.type === 'choice' && arg.placeholder) {
        warnings.push(
          `Command "${cmd.name}" arg "${arg.name}" is type "choice" but declares a "placeholder" — placeholder only applies to text args (shown in an input field), not choice args (shown as option buttons).`,
        )
      }
      if (
        arg.type === 'choice' &&
        !arg.optionsScript &&
        (!arg.options || arg.options.length === 0)
      ) {
        warnings.push(
          `Command "${cmd.name}" arg "${arg.name}" is type "choice" but declares no options — users can't select anything.`,
        )
      } else if (arg.type === 'choice' && arg.options) {
        // Duplicate option values make the choice unpredictable — validation silently picks first.
        const seenVals = new Set<string>()
        for (const opt of arg.options) {
          if (!opt.value?.trim()) {
            warnings.push(
              `Command "${cmd.name}" arg "${arg.name}" has an option with an empty value — empty values can't be reliably matched.`,
            )
          }
          if (seenVals.has(opt.value)) {
            warnings.push(
              `Command "${cmd.name}" arg "${arg.name}" has duplicate option value "${opt.value}".`,
            )
          }
          seenVals.add(opt.value)
        }
      }
      if (arg.when) {
        const dependencyIndex = cmd.args.findIndex((candidate) => candidate.name === arg.when!.arg)
        const dependency = dependencyIndex >= 0 ? cmd.args[dependencyIndex] : undefined
        if (!dependency) {
          errors.push(
            `Command "${cmd.name}" arg "${arg.name}" depends on unknown arg "${arg.when.arg}".`,
          )
        } else if (dependencyIndex >= argIndex) {
          errors.push(
            `Command "${cmd.name}" arg "${arg.name}" depends on "${arg.when.arg}", but conditions must reference an earlier arg.`,
          )
        } else if (dependency.type !== 'choice') {
          errors.push(
            `Command "${cmd.name}" arg "${arg.name}" depends on text arg "${arg.when.arg}" — conditions require an earlier choice arg.`,
          )
        } else if (
          dependency.options &&
          dependency.options.length > 0 &&
          !dependency.options.some((option) => option.value === arg.when!.equals)
        ) {
          warnings.push(
            `Command "${cmd.name}" arg "${arg.name}" condition expects "${arg.when.equals}", which is not an option of "${arg.when.arg}".`,
          )
        }
      }
    }
    const declaredArgs = new Set(cmd.args.map((a) => a.name))
    for (const token of placeholders) {
      // SCREAMING_CASE tokens are the config/env convention (${API_KEY}) — prompts
      // legitimately mention them as documentation, so only lowercase-style tokens
      // are treated as likely arg typos.
      if (!declaredArgs.has(token) && !/^[A-Z][A-Z0-9_]*$/.test(token)) {
        warnings.push(
          `Command "${cmd.name}" prompt references \${${token}} which isn't a declared arg.`,
        )
      }
    }
    // Optional args should come after required args — otherwise required args after an
    // optional arg can never be reached by positional token parsing.
    let seenOptional = false
    for (const arg of cmd.args) {
      if (!arg.required) seenOptional = true
      else if (seenOptional && !arg.when) {
        warnings.push(
          `Command "${cmd.name}" arg "${arg.name}" is required but follows an optional arg — required args must come before optional ones.`,
        )
      }
    }
    for (const tool of cmd.allowedTools ?? []) {
      if (!BUILTIN_TOOL_NAMES.includes(tool)) {
        warnings.push(
          `Command "${cmd.name}" allowedTools lists "${tool}" which isn't a known engine tool — it will be ignored.`,
        )
      }
    }
    for (const tool of cmd.disallowedTools ?? []) {
      if (!BUILTIN_TOOL_NAMES.includes(tool)) {
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
 * tools real engine tools. Warns when the raw manifest has more inline agents
 * than the cap (file-based agents are already capped silently in loadManifest).
 */
export function validatePluginAgents(plugin: DiscoveredPlugin): FieldValidation {
  const errors: string[] = []
  const warnings: string[] = []
  const inlineAgentCount = Array.isArray(plugin.manifest.agents) ? plugin.manifest.agents.length : 0
  if (inlineAgentCount > AGENTS_MAX_PER_PLUGIN) {
    warnings.push(
      `Plugin declares ${inlineAgentCount} inline agent roles but only ${AGENTS_MAX_PER_PLUGIN} are loaded (cap per plugin). Move extras to a separate plugin.`,
    )
  }
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
        `Agent role "${agent.name}" has no description — add one so users know what this role does in the Settings role picker.`,
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
    for (const tool of agent.disallowedTools ?? []) {
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
