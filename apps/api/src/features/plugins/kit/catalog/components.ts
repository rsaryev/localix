import { join } from 'node:path'
import type { OutputStyle } from '@localixai/claude-plugin'
import type { ClaudeTheme } from '@localixai/claude-plugin'
import { readCatalog } from '@rsaryev/llx-plugin'
import type { Plugin } from '@rsaryev/llx-plugin/loading'
import { themeColorToHex, type AgentRecord, type Command } from '@rsaryev/llx-plugin/format'
import { mapCcToolList } from '../../../ext/cc-tool-names'
import type { PluginAgent, PluginCommand } from '../../contracts'
import { delegableAgentTypes, mapOptionalCcTools } from '../../discovery-cc-tools'

/**
 * A loaded plugin's Markdown and JSON components as the kit's sessions read them (`readCatalog`,
 * once per `Plugin`), in the shapes Localix's runtime takes.
 */

/** A workflow script of the plugin, as the `Workflow` tool runs it. */
export interface PluginWorkflow {
  name: string
  description: string
  whenToUse?: string
  /** The script, absolute. */
  file: string
}

function commandOf(command: Command): PluginCommand {
  const description = [command.description, command.whenToUse].filter(Boolean).join(' ').trim()
  const named = command.arguments.filter((name) => !/^\d+$/.test(name))
  return {
    name: command.name,
    description,
    args: [],
    prompt: command.body.trim(),
    ...(command.argumentHint ? { argumentHint: command.argumentHint } : {}),
    ...(named.length ? { arguments: named } : {}),
    // In Claude Code's rule syntax: the gate reads them as the kit does (`kit/permissions.ts`).
    ...(command.allowedTools.length ? { allowedTools: [...command.allowedTools] } : {}),
    ...(command.disallowedTools.length ? { disallowedTools: [...command.disallowedTools] } : {}),
    ...(command.model ? { model: command.model } : {}),
    ...(command.disableModelInvocation ? { disableModelInvocation: true } : {}),
  }
}

/** The plugin's skills' descriptions, by the skill's own name, as the kit read its `SKILL.md` files. */
export function readSkillDescriptions(plugin: Plugin): Map<string, string> {
  return new Map(
    readCatalog(plugin).skills.flatMap((skill) =>
      skill.description ? [[skill.name, skill.description] as const] : [],
    ),
  )
}

export function readCommands(plugin: Plugin) {
  return { commands: readCatalog(plugin).commands.map(commandOf) }
}

/** The tools a rule list denies: an agent's `Bash(rm *)` removes the whole tool, as the kit reads it. */
function deniedTools(rules: readonly string[] | undefined): string[] | undefined {
  const tools = mapCcToolList([...(rules ?? [])], { dropUnknown: true })
  return tools.length ? tools : undefined
}

/** An agent as the kit read it: a file's record, or a catalog entry under its scoped name. */
export type AgentEntry = Pick<
  AgentRecord,
  'scopedName' | 'name' | 'definition' | 'extras' | 'hooks'
>

/** An agent of the plugin, named below it (`team:security` for `<plugin>:team:security`). */
export function agentOf(record: AgentEntry, prefix: string): PluginAgent {
  const { definition, extras } = record
  const tools = definition.tools === undefined ? undefined : [...definition.tools]
  const denied = deniedTools(definition.disallowedTools)
  const pinned = [...new Set(definition.skills ?? [])]
  const types = delegableAgentTypes(tools)
  const fields: PluginAgent = {
    name:
      prefix && record.scopedName.startsWith(`${prefix}:`)
        ? record.scopedName.slice(prefix.length + 1)
        : record.name,
    description: definition.description,
    prompt: definition.prompt.trim(),
    ...(tools === undefined ? {} : { tools: mapOptionalCcTools(tools) }),
    ...(denied ? { disallowedTools: denied } : {}),
    ...(types ? { agentTypes: types } : {}),
    ...(definition.model ? { model: definition.model } : {}),
    ...(pinned.length ? { pinnedSkills: pinned } : {}),
    ...(definition.maxTurns ? { maxTurns: definition.maxTurns } : {}),
    ...(definition.background === undefined ? {} : { background: definition.background }),
    ...(definition.memory ? { memory: definition.memory } : {}),
    ...(definition.autoCompactWindow ? { autoCompactWindow: definition.autoCompactWindow } : {}),
    ...(extras.isolation === 'worktree' ? { isolation: 'isolated' as const } : {}),
    ...(definition.omitClaudeMd ? { omitClaudeMd: true } : {}),
    ...(extras.cacheTtl ? { cacheTtl: extras.cacheTtl } : {}),
    ...(extras.color ? { color: extras.color } : {}),
    ...(definition.initialPrompt ? { initialPrompt: definition.initialPrompt } : {}),
    ...(record.hooks ? { hooks: record.hooks } : {}),
    ...(definition.mcpServers ? { mcpServers: definition.mcpServers } : {}),
  }
  if (fields.tools === undefined) delete fields.tools
  return fields
}

export function readAgents(plugin: Plugin) {
  return { agents: readCatalog(plugin).agents.map((record) => agentOf(record, plugin.name)) }
}

const stylesOf = (plugin: Plugin): OutputStyle[] =>
  readCatalog(plugin).outputStyles.map((style) => ({
    name: style.name,
    description: style.description ?? '',
    keepCodingInstructions: style.keepCodingInstructions,
    forceForPlugin: style.forceForPlugin,
    prompt: style.instructions.trim(),
  }))

const themesOf = (plugin: Plugin): ClaudeTheme[] =>
  plugin.themes.flatMap(({ theme }) =>
    theme
      ? [
          {
            slug: theme.slug,
            name: theme.name,
            base: theme.base,
            overrides: Object.fromEntries(
              Object.entries(theme.overrides).map(([token, color]) => [
                token,
                themeColorToHex(color),
              ]),
            ),
          },
        ]
      : [],
  )

const workflowsOf = (plugin: Plugin, dir: string): PluginWorkflow[] =>
  plugin.workflows.flatMap(({ meta, path }) =>
    meta
      ? [
          {
            name: meta.name,
            description: meta.description,
            ...(meta.whenToUse ? { whenToUse: meta.whenToUse } : {}),
            file: join(dir, path),
          },
        ]
      : [],
  )

/** Output styles, themes, workflows and the default settings. */
export function readComponents(plugin: Plugin, dir: string) {
  return {
    outputStyles: stylesOf(plugin),
    themes: themesOf(plugin),
    workflows: workflowsOf(plugin, dir),
    settings: { ...plugin.settings },
  }
}

export type PluginCcComponents = ReturnType<typeof readComponents>
