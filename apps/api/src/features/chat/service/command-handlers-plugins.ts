import { errorMessage } from '../../../lib/errors'
import type { SessionRecord } from '../repository'
import type { MessageMutationResponse } from '../contracts'
import type { CommandHandlerContext, DirectReply } from './command-handlers'
import { handleMarketplaceSubcommand } from './command-handlers-plugins-marketplace'
import {
  SCOPE_USAGE,
  scopedProjectId,
  takeAcceptCommand,
  takeScope,
} from './command-handlers-plugins-args'
import {
  errorCode,
  installReply,
  updateReply,
  validatePathReply,
} from './command-handlers-plugins-replies'
import { isAbsolute } from 'node:path'
import {
  pluginDetailsReply,
  pluginListReply,
  validationReply,
} from './command-handlers-plugins-reports'
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
  '/plugin enable <name> [--scope user|project|local]',
  '/plugin disable <name> [--scope user|project|local]',
  '/plugin remove <name> [--scope user|project|local]',
  '/plugin validate [<name> | </absolute/path>] [--strict]',
  '/plugin update <name> [--scope user|project|local] [--accept-command <sha256>]',
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
    if (scoped.invalid) return directReply(SCOPE_USAGE)
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
      return directReply(`Usage: \`${PLUGIN_SUBCOMMAND_USAGE[1]}\``)
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
    const scoped = takeScope(tokens.slice(2))
    if (scoped.invalid) return directReply(SCOPE_USAGE)
    const name = nameArg(scoped.args)
    if (!name) return directReply(`Usage: \`/plugin ${sub} <name> [--scope user|project|local]\``)
    try {
      const rec = await pluginService.setEnabled(
        userId,
        { name, projectId: scopedProjectId(session, scoped.scope), enabled: sub === 'enable' },
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
    const scoped = takeScope(updateArgs)
    if (scoped.invalid) return directReply(SCOPE_USAGE)
    const name = nameArg(scoped.args)
    if (!name)
      return directReply('Usage: `/plugin update <name>` — re-installs from the original source.')
    try {
      const rec = await pluginService.update(userId, {
        name,
        projectId: scopedProjectId(session, scoped.scope),
        ...(accepted ? { acceptCommand: accepted } : {}),
      })
      return directReply(updateReply(rec))
    } catch (err) {
      return directReply(`Update failed: ${errorMessage(err)}`)
    }
  }

  if (sub === 'remove') {
    const scoped = takeScope(tokens.slice(2))
    if (scoped.invalid) return directReply(SCOPE_USAGE)
    const name = nameArg(scoped.args)
    if (!name) return directReply('Usage: `/plugin remove <name> [--scope user|project|local]`')
    try {
      const removed = await pluginService.remove(userId, {
        name,
        projectId: scopedProjectId(session, scoped.scope),
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
    return directReply(pluginDetailsReply(p))
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
    return directReply(validationReply(targets, strict))
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
  return directReply(pluginListReply(catalog))
}
