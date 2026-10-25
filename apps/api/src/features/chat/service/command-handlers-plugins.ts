import { errorMessage } from '../../../lib/errors'
import { pluginOriginLabel } from '../../plugins/presentation'
import type { SessionRecord } from '../repository'
import type { MessageMutationResponse } from '../contracts'
import type { CommandHandlerContext, DirectReply } from './command-handlers'
import { handleMarketplaceSubcommand } from './command-handlers-plugins-marketplace'
import {
  errorCode,
  installReply,
  updateReply,
  validatePathReply,
} from './command-handlers-plugins-replies'
import { isAbsolute } from 'node:path'
import {
  installThroughStore,
  isStoreInstall,
  type StoreCommandContext,
} from './command-handlers-plugins-store'

/** The slice of {@link CommandHandlerContext} the `/plugin` sub-commands need. */
type PluginsCommandContext = Pick<
  CommandHandlerContext,
  'pluginService' | 'buildSessionPluginCatalog' | 'resolveSessionWorkingDir'
> &
  StoreCommandContext

/** Claude Code's names for sub-commands Localix spells otherwise; not shown in the menu. */
const CLAUDE_CODE_SPELLINGS: Record<string, string> = { uninstall: 'remove', market: 'marketplace' }

/** Every accepted sub-command, in menu order — the reply to an unrecognized one. */
const PLUGIN_SUBCOMMAND_USAGE = [
  '/plugin list',
  '/plugin install <name>@<marketplace> | <name> --marketplace <source> | <git-url> | <owner/repo> | </absolute/path> [--project | --scope user|project|local] [--yes] [--accept-command <sha256>]',
  '/plugin enable <name>',
  '/plugin disable <name>',
  '/plugin remove <name>',
  '/plugin validate [<name> | </absolute/path>] [--strict]',
  '/plugin update <name> [--accept-command <sha256>]',
  '/plugin details <name>',
  '/plugin reload',
  '/plugin marketplace list [<name>] | add <source> | update [<name>] | remove <name>',
] as const

/**
 * `/plugin reload`, and Claude Code's `/reload-plugins` and `/reload-skills` (skills load through
 * plugins, so one reload covers both). Nothing was mutated: a plugin directory was edited on disk,
 * which no service call can observe, so this is what tells the catalog to re-read it.
 */
export function reloadPlugins(
  pluginService: Pick<CommandHandlerContext['pluginService'], 'onChanged'>,
  directReply: DirectReply,
): Promise<MessageMutationResponse> {
  pluginService.onChanged?.()
  return directReply(
    'Plugins reloaded. Changes to skills, agents, hooks, MCP servers, and commands take effect on the next turn.',
  )
}

/**
 * Handles the `/plugin …` control sub-commands (marketplace, install,
 * enable/disable, update, remove, details, validate, reload, list). Extracted verbatim
 * from handleControlCommand so the dispatcher stays readable. Returns the direct
 * reply for the chosen sub-command.
 */
export async function handlePluginsControlCommand(
  ctx: PluginsCommandContext,
  userId: string,
  session: SessionRecord,
  prompt: string,
  directReply: DirectReply,
): Promise<MessageMutationResponse> {
  const { pluginService } = ctx
  // Sub-commands: `/plugin` or `/plugin list` → list; `/plugin install <src>` →
  // install a native plugin directly. Plugin-authored slash commands are dispatched
  // generically below.
  //
  // ONE spelling per action, no aliases. `remove`/`uninstall`/`rm` and
  // `update`/`upgrade` were three and two names for one thing, which is three and two
  // things to keep in the composer menu, the docs and the user's head — and the menu
  // could only ever show one of them, so the rest existed for nobody.
  const tokens = prompt.trim().split(/\s+/)
  // Claude Code's spellings (`uninstall`, `market`): a command pasted from its docs works as is.
  const typed = tokens[1]?.toLowerCase() ?? 'list'
  const sub = CLAUDE_CODE_SPELLINGS[typed] ?? typed
  /** The plugin a command names: Claude Code writes `name@marketplace`, Localix the name. */
  const nameArg = (args: readonly string[]) =>
    args
      .join(' ')
      .trim()
      .replace(/@[\w.-]+$/u, '')

  // `/plugin reload` — the CC `/reload-plugins` equivalent. The MUTATIONS below need no
  // bump of their own: the service fires its own `onChanged` inside each one. Reload is
  // the exception precisely because nothing was mutated — a plugin directory was edited
  // on disk, which no service call can observe.
  if (sub === 'reload') return reloadPlugins(pluginService, directReply)

  // `/plugin marketplace add|list|remove …` — Claude Code-style marketplace registry.
  if (sub === 'marketplace') {
    return handleMarketplaceSubcommand(ctx, userId, tokens, directReply)
  }

  if (sub === 'install') {
    // Global by default (~/.localix/plugins); `--project` targets this chat's project.
    const { args: flagged, accepted } = takeAcceptCommand(tokens.slice(2))
    // `--yes` accepts the plan a Store install showed, as the Store screen's button does.
    const yes = flagged.includes('--yes')
    const scoped = takeScope(flagged.filter((arg) => arg !== '--yes'))
    const args = scoped.args
    const toProject = args.includes('--project') || scoped.project
    // `--marketplace <source>` adds (or refreshes) that marketplace first, as in Claude Code.
    const at = args.indexOf('--marketplace')
    const marketplace = at >= 0 ? args[at + 1] : undefined
    const source = args
      .filter((arg, i) => arg !== '--project' && (at < 0 || (i !== at && i !== at + 1)))
      .join(' ')
      .trim()
    if (!source || (at >= 0 && !marketplace)) {
      return directReply(`Usage: \`${PLUGIN_SUBCOMMAND_USAGE[2]}\``)
    }
    // A listing of a marketplace goes through the Store, as the Store screen's Install does; an
    // address (git URL, owner/repo, folder) names no listing, and a `headersHelper` acceptance has
    // no place in a Store plan, so those stay the plugin service's.
    if (!accepted && isStoreInstall(source, marketplace)) {
      return directReply(
        await installThroughStore(ctx, userId, session, { source, marketplace, toProject, yes }),
      )
    }
    try {
      const added = marketplace
        ? await pluginService.addMarketplace(userId, { source: marketplace })
        : null
      const rec = await pluginService.install(userId, {
        source: added ? `${source}@${added.name}` : source,
        projectId: toProject ? (session.projectId ?? null) : null,
        enable: true,
        ...(accepted ? { acceptCommand: accepted } : {}),
      })
      return directReply(installReply(rec))
    } catch (err) {
      // "Already installed at that scope: … `Plugin "…" is already installed (scope: project)`".
      if (errorCode(err) === 'plugin_already_installed') return directReply(`${errorMessage(err)}.`)
      return directReply(`Install failed: ${errorMessage(err)}`)
    }
  }

  if (sub === 'enable' || sub === 'disable') {
    const name = nameArg(tokens.slice(2))
    if (!name) return directReply(`Usage: \`/plugin ${sub} <name>\``)
    try {
      const rec = await pluginService.setEnabled(
        userId,
        { name, projectId: session.projectId ?? null, enabled: sub === 'enable' },
        { refuseNoop: true },
      )
      return directReply(
        `${sub === 'enable' ? 'Enabled' : 'Disabled'} \`${rec.name}\`. Start a new turn for it to take effect.`,
      )
    } catch (err) {
      // `Plugin "formatter" is already enabled`, as `claude plugin enable` prints it.
      if (errorCode(err) === 'plugin_already_in_state') return directReply(`${errorMessage(err)}.`)
      return directReply(`${sub} failed: ${errorMessage(err)}`)
    }
  }

  if (sub === 'update') {
    const { args: updateArgs, accepted } = takeAcceptCommand(tokens.slice(2))
    const name = nameArg(updateArgs)
    if (!name)
      return directReply('Usage: `/plugin update <name>` — re-installs from the original source.')
    try {
      const rec = await pluginService.update(userId, {
        name,
        projectId: session.projectId ?? null,
        ...(accepted ? { acceptCommand: accepted } : {}),
      })
      return directReply(updateReply(rec))
    } catch (err) {
      return directReply(`Update failed: ${errorMessage(err)}`)
    }
  }

  if (sub === 'remove') {
    const name = nameArg(tokens.slice(2))
    if (!name) return directReply('Usage: `/plugin remove <name>`')
    try {
      const removed = await pluginService.remove(userId, {
        name,
        projectId: session.projectId ?? null,
      })
      if (removed?.claudeCodeInstall)
        return directReply(
          `\`${name}\` was installed by Claude Code, so Localix did not delete it. It is disabled here. To uninstall it, run \`claude plugin uninstall ${removed.claudeCodeInstall}\`.`,
        )
      return directReply([`Removed \`${name}\`.`, ...(removed?.warnings ?? [])].join('\n\n'))
    } catch (err) {
      return directReply(`Remove failed: ${errorMessage(err)}`)
    }
  }

  if (sub === 'details') {
    const name = nameArg(tokens.slice(2))
    if (!name) return directReply('Usage: `/plugin details <name>`.')
    const { plugins } = await pluginService.listPlugins(userId, {
      projectId: session.projectId ?? null,
    })
    const p = plugins.find((pl) => pl.name === name)
    if (!p) return directReply(`No plugin named \`${name}\`.`)
    const chips: string[] = []
    if (p.provides.skills.length) chips.push(`skills: ${p.provides.skills.join(', ')}`)
    if (p.provides.mcpServers.length) chips.push(`MCP: ${p.provides.mcpServers.join(', ')}`)
    if (p.provides.commands.length) chips.push(`commands: ${p.provides.commands.join(', ')}`)
    if (p.provides.agents?.length) chips.push(`agents: ${p.provides.agents.join(', ')}`)
    const errWarn =
      p.validation.errors.length + p.validation.warnings.length === 0
        ? 'clean'
        : `${p.validation.errors.length} error(s), ${p.validation.warnings.length} warning(s)`
    const lines = [
      `**${p.name}**${p.displayName && p.displayName !== p.name ? ` (${p.displayName})` : ''} v${p.version} — ${p.description || '(no description)'}`,
      `- **Enabled:** ${p.enabled ? 'yes' : 'no'} | **Origin:** ${pluginOriginLabel(p)} | **Source:** ${p.source}`,
      ...(p.importedFrom === 'claude-code'
        ? [`- **Imported from Claude Code**${p.migratedFrom ? `: ${p.migratedFrom}` : ''}`]
        : p.migratedFrom
          ? [`- **Migrated from:** ${p.migratedFrom}`]
          : []),
      `- **Validation:** ${errWarn}`,
      ...(chips.length ? [`- **Provides:** ${chips.join(' | ')}`] : []),
      ...(p.error ? [`- **Load error:** ${p.error}`] : []),
      ...p.validation.errors.map((e) => `  - Error: ${e}`),
      ...p.validation.warnings.map((w) => `  - Warning: ${w}`),
      `- **Dir:** \`${p.dir}\``,
    ]
    return directReply(lines.join('\n'))
  }

  if (sub === 'validate') {
    const args = tokens.slice(2)
    const strict = args.includes('--strict')
    const name = args
      .filter((a) => a !== '--strict')
      .join(' ')
      .trim()
    // `/plugin validate <path>`: "Prints the same report as `claude plugin validate`, inline".
    if (isAbsolute(name)) return directReply(await validatePathReply(ctx, name, strict))
    const { plugins } = await pluginService.listPlugins(userId, {
      projectId: session.projectId ?? null,
    })
    const targets = name ? plugins.filter((p) => p.name === name) : plugins
    if (name && targets.length === 0) return directReply(`No plugin named \`${name}\`.`)
    const strictNote = strict ? ' (strict — warnings promoted to errors)' : ''
    const lines = targets.map((p) => {
      // In strict mode, all warnings become errors in the display.
      const errs = [...p.validation.errors, ...(strict ? p.validation.warnings : [])].map(
        (e) => `    - Error: ${e}`,
      )
      const warns = strict ? [] : p.validation.warnings.map((w) => `    - Warning: ${w}`)
      const errCount = p.validation.errors.length + (strict ? p.validation.warnings.length : 0)
      const warnCount = strict ? 0 : p.validation.warnings.length
      const head = `- \`${p.name}\` — ${errCount} error(s), ${warnCount} warning(s)`
      return [head, ...errs, ...warns].join('\n')
    })
    return directReply([`**Plugin validation${strictNote}:**`, '', ...lines].join('\n'))
  }

  // A typo used to fall through to the listing, so `/plugin disble foo` printed the
  // plugin list and looked like it had worked. Only a bare `/plugin` and an explicit
  // `list` reach the listing now; anything else gets told what the actions are.
  if (tokens.length > 1 && sub !== 'list') {
    return directReply(
      [
        `Unknown sub-command \`${sub}\`. Available actions:`,
        '',
        ...PLUGIN_SUBCOMMAND_USAGE.map((line) => `- \`${line}\``),
      ].join('\n'),
    )
  }

  // List plugins discovered for this scope + their enable-state, like /mcp.
  // Pure listing — disabled plugins' code is not imported here.
  const catalog = await ctx.buildSessionPluginCatalog(userId, session)
  const reply =
    catalog.all.length === 0
      ? 'No plugins found. Install one in the Store, or drop a plugin folder (with `.claude-plugin/plugin.json`, as in Claude Code) into `~/.localix/plugins`.'
      : [
          '**Plugins** — enable in the Store:',
          '',
          ...catalog.all.map(({ plugin: p, enabled }) => {
            const scope = p.scope === 'project' ? 'project' : 'global'
            const bits: string[] = []
            if (p.provides.mcpServers.length) bits.push(`${p.provides.mcpServers.length} mcp`)
            if (p.provides.skills.length) bits.push(`${p.provides.skills.length} skills`)
            if (p.provides.commands.length) bits.push(`${p.provides.commands.length} commands`)
            if (p.provides.agents?.length) bits.push(`${p.provides.agents.length} agents`)
            const state = p.error ? 'error' : enabled ? 'enabled' : 'disabled'
            const detail = bits.length ? ` — ${bits.join(', ')}` : ''
            const version = p.manifest.version ? ` · v${p.manifest.version}` : ''
            return `- ${state} \`${p.manifest.name}\` _(${scope})_${detail}${version}`
          }),
        ].join('\n')
  return directReply(reply)
}

/**
 * `--accept-command <sha256>`: the person accepts the `headersHelper` command an install or update
 * showed them (plugins/cli-reference, `plugin install`); the flag leaves the other arguments.
 */
function takeAcceptCommand(args: string[]): { args: string[]; accepted?: string } {
  const at = args.indexOf('--accept-command')
  if (at < 0) return { args }
  const accepted = args[at + 1]
  return {
    args: args.filter((_arg, i) => i !== at && i !== at + 1),
    ...(accepted ? { accepted } : {}),
  }
}

/**
 * Claude Code's `--scope user|project|local`. Localix installs for everyone (user) or for this
 * project; `local` (only me, in this repo) is nearest to this project.
 */
function takeScope(args: readonly string[]): { args: string[]; project: boolean } {
  const at = args.indexOf('--scope')
  if (at < 0) return { args: [...args], project: false }
  const value = args[at + 1]?.toLowerCase()
  return {
    args: args.filter((_, i) => i !== at && i !== at + 1),
    project: value === 'project' || value === 'local',
  }
}
