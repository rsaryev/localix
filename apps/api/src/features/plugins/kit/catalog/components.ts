import { join } from 'node:path'
import { readCatalog } from '@rsaryev/llx-plugin'
import type { Plugin } from '@rsaryev/llx-plugin/loading'
import { themeColorToHex, type Command, type Theme } from '@rsaryev/llx-plugin/format'
import type { PluginCommand } from '../../contracts'
import { styleBody, type StyleBody } from './output-style'

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

const stylesOf = (plugin: Plugin): StyleBody[] => readCatalog(plugin).outputStyles.map(styleBody)

/** A plugin theme with each token's color as CSS hex, as the UI paints it. */
export type HexTheme = Pick<Theme, 'slug' | 'name' | 'base'> & {
  readonly overrides: Readonly<Record<string, string>>
}

const themesOf = (plugin: Plugin): HexTheme[] =>
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
