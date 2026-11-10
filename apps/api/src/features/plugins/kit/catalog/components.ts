import { join } from 'node:path'
import type { OutputStyle } from '@localixai/claude-plugin'
import type { ClaudeTheme } from '@localixai/claude-plugin'
import type { Plugin, PluginTextFile } from '@rsaryev/llx-plugin/loading'
import {
  readAgent,
  readCommand,
  readCommandEntry,
  readOutputStyle,
  themeColorToHex,
  type AgentRecord,
  type Command,
  type PluginIssue,
} from '@rsaryev/llx-plugin/format'
import { mapCcRuleList } from '../../../ext/cc-tool-names'
import type { PluginAgent, PluginCommand } from '../../contracts'
import { delegableAgentTypes, mapOptionalCcTools } from '../../discovery-cc-tools'
import { preloadedSkills } from '../../agent-names'

/**
 * A loaded plugin's Markdown and JSON components read by the kit's format readers, in the shapes
 * Localix's runtime takes. Kit gap: the kit reads them so in `host/catalog.ts` (`readCatalog`),
 * which it does not export; the path of a folder file is written the same way here.
 */

/** A workflow script of the plugin, as the `Workflow` tool runs it. */
export interface PluginWorkflow {
  name: string
  description: string
  whenToUse?: string
  /** The script, absolute. */
  file: string
}

/** `db:migrate` is the file `db/migrate.md` below its folder. */
const relativePath = (file: PluginTextFile) => `${file.name.split(':').join('/')}.md`
const pathOf = (file: PluginTextFile, folder: string) =>
  file.path ?? `${folder}/${relativePath(file)}`

/** One per name, the first kept, as the kit keeps it. */
function firstPerName<T>(items: readonly T[], nameOf: (item: T) => string): T[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const name = nameOf(item)
    if (seen.has(name)) return false
    seen.add(name)
    return true
  })
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
    ...(command.allowedTools.length
      ? { allowedTools: mapCcRuleList([...command.allowedTools]) }
      : {}),
    ...(command.disallowedTools.length
      ? { disallowedTools: mapCcRuleList([...command.disallowedTools]) }
      : {}),
    ...(command.model ? { model: command.model } : {}),
    ...(command.disableModelInvocation ? { disableModelInvocation: true } : {}),
  }
}

export function readCommands(plugin: Plugin) {
  const origin = { kind: 'plugin' as const, plugin: plugin.name }
  const reads = plugin.commands.map((file) =>
    file.entry === undefined
      ? readCommand(pathOf(file, 'commands'), file.text, {
          origin,
          relativePath: relativePath(file),
        })
      : readCommandEntry(
          file.name,
          file.entry,
          file.entry.source === undefined ? undefined : file.text,
          {
            origin,
          },
        ),
  )
  const commands = firstPerName(
    reads.flatMap((read) => read.command ?? []),
    (command) => command.name,
  )
  return { commands: commands.map(commandOf), issues: reads.flatMap((read) => read.issues) }
}

/** The tools a rule list denies, without their patterns: an agent denies a tool whole. */
function deniedTools(rules: readonly string[] | undefined): string[] | undefined {
  const tools = new Set(
    mapCcRuleList([...(rules ?? [])]).map((rule) => rule.replace(/\(.*\)$/s, '')),
  )
  return tools.size ? [...tools] : undefined
}

/** An agent of the plugin, named below it (`team:security` for `<plugin>:team:security`). */
export function agentOf(record: AgentRecord, prefix: string): PluginAgent {
  const { definition, extras } = record
  const tools = definition.tools === undefined ? undefined : [...definition.tools]
  const denied = deniedTools(definition.disallowedTools)
  const pinned = preloadedSkills(definition.skills)
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
  const reads = plugin.agents.map((file) =>
    readAgent(file.text, {
      path: pathOf(file, 'agents'),
      source: 'plugin',
      plugin: { name: plugin.name, relativePath: relativePath(file) },
    }),
  )
  const records = firstPerName(
    reads.flatMap((read) => (read.outcome === 'loaded' ? [read.agent] : [])),
    (agent) => agent.scopedName,
  )
  return {
    agents: records.map((record) => agentOf(record, plugin.name)),
    issues: reads.flatMap((read): readonly PluginIssue[] => read.issues),
  }
}

function readStyles(plugin: Plugin) {
  const reads = plugin.outputStyles.map((file) =>
    readOutputStyle(pathOf(file, 'output-styles'), file.text, { plugin: plugin.name }),
  )
  const styles = reads.map(({ style }): OutputStyle => ({
    name: style.name,
    description: style.description ?? '',
    keepCodingInstructions: style.keepCodingInstructions,
    forceForPlugin: style.forceForPlugin,
    prompt: style.instructions.trim(),
  }))
  return {
    outputStyles: firstPerName(styles, (style) => style.name),
    issues: reads.flatMap((read) => read.issues),
  }
}

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

/** Output styles, themes, workflows and the default settings, with what their reading found. */
export function readComponents(plugin: Plugin, dir: string) {
  const styles = readStyles(plugin)
  return {
    outputStyles: styles.outputStyles,
    themes: themesOf(plugin),
    workflows: workflowsOf(plugin, dir),
    settings: { ...plugin.settings },
    issues: styles.issues,
  }
}

export type PluginCcComponents = ReturnType<typeof readComponents>
