import { errorMessage } from '../../../lib/errors'
import { pluginOriginLabel } from '../../plugins/presentation'
import type { SessionRecord } from '../repository'
import type { MessageMutationResponse } from '../contracts'
import type { CommandHandlerContext, DirectReply } from './command-handlers'
import { handleMarketplaceSubcommand } from './command-handlers-plugins-marketplace'
import { formatPluginCheck } from '../../plugins/authoring/check'
import { handlePluginCreateSubcommand } from './command-handlers-plugins-create'

/** The slice of {@link CommandHandlerContext} the `/plugin` sub-commands need. */
type PluginsCommandContext = Pick<
  CommandHandlerContext,
  | 'pluginService'
  | 'buildSessionPluginCatalog'
  | 'repo'
  | 'runner'
  | 'now'
  | 'resolveSessionWorkingDir'
  | 'runMacroCommand'
>

/** Every accepted sub-command, in menu order — the reply to an unrecognized one. */
const PLUGIN_SUBCOMMAND_USAGE = [
  '/plugin list',
  '/plugin create <what it should do>',
  '/plugin install <name>@<marketplace> | <git-url> | <owner/repo> | </absolute/path> [--project]',
  '/plugin enable <name>',
  '/plugin disable <name>',
  '/plugin remove <name>',
  '/plugin validate [<name>] [--strict]',
  '/plugin update <name>',
  '/plugin details <name>',
  '/plugin reload',
  '/plugin marketplace list | add <source> | remove <name>',
] as const

/**
 * Handles the `/plugin …` control sub-commands (create, marketplace, install,
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
  const sub = tokens[1]?.toLowerCase() ?? 'list'

  // `/plugin reload` — the CC `/reload-plugins` equivalent. The MUTATIONS below need no
  // bump of their own: the service fires its own `onChanged` inside each one. Reload is
  // the exception precisely because nothing was mutated — a plugin directory was edited
  // on disk, which no service call can observe. The user's own plugins are rebuilt first: an
  // edit to their sources means nothing until the app builds it.
  if (sub === 'reload') {
    let rebuilt: Awaited<ReturnType<typeof pluginService.authoring.rebuildAll>> = []
    let rebuildError: string | null = null
    try {
      rebuilt = await pluginService.authoring.rebuildAll()
    } catch (err) {
      rebuildError = errorMessage(err)
    }
    pluginService.onChanged?.()
    const failed = rebuilt.filter(({ report }) => !report.ok)
    return directReply(
      [
        'Plugins reloaded. Changes to skills, agents, MCP servers, and commands take effect on the next turn.',
        ...(rebuilt.length
          ? [`Rebuilt ${rebuilt.map(({ name }) => `\`${name}\``).join(', ')}.`]
          : []),
        ...(rebuildError ? [`Your plugins could not be rebuilt: ${rebuildError}`] : []),
        ...failed.map(({ name, report }) => '```\n' + formatPluginCheck(name, report) + '\n```'),
      ].join('\n\n'),
    )
  }

  // `/plugin create <what it should do>` — the agent names and builds a new user plugin.
  if (sub === 'create') {
    return handlePluginCreateSubcommand(ctx, userId, session, prompt, directReply)
  }

  // `/plugin marketplace add|list|remove …` — Claude Code-style marketplace registry.
  if (sub === 'marketplace') {
    return handleMarketplaceSubcommand(ctx, userId, tokens, directReply)
  }

  if (sub === 'install') {
    // Global by default (~/.localix/plugins); `--project` targets this chat's project.
    const args = tokens.slice(2)
    const toProject = args.includes('--project')
    const source = args
      .filter((arg) => arg !== '--project')
      .join(' ')
      .trim()
    if (!source) {
      return directReply(
        'Usage: `/plugin install <name>@<marketplace> | <git-url> | <owner/repo> | </absolute/path> [--project]`',
      )
    }
    try {
      const rec = await pluginService.install(userId, {
        source,
        projectId: toProject ? (session.projectId ?? null) : null,
        enable: true,
      })
      const note = rec.provides.hasNativeTools ? ' — it runs native in-process code' : ''
      const where = rec.scope === 'project' ? 'this project' : 'all chats'
      return directReply(
        `Installed \`${rec.name}\` v${rec.version} for ${where} (\`${rec.dir}\`) and enabled it${note}. Start a new turn to use it.`,
      )
    } catch (err) {
      return directReply(`Install failed: ${errorMessage(err)}`)
    }
  }

  if (sub === 'enable' || sub === 'disable') {
    const name = tokens.slice(2).join(' ').trim()
    if (!name) return directReply(`Usage: \`/plugin ${sub} <name>\``)
    try {
      const rec = await pluginService.setEnabled(userId, {
        name,
        projectId: session.projectId ?? null,
        enabled: sub === 'enable',
      })
      return directReply(
        `${sub === 'enable' ? 'Enabled' : 'Disabled'} \`${rec.name}\`. Start a new turn for it to take effect.`,
      )
    } catch (err) {
      return directReply(`${sub} failed: ${errorMessage(err)}`)
    }
  }

  if (sub === 'update') {
    const name = tokens.slice(2).join(' ').trim()
    if (!name)
      return directReply('Usage: `/plugin update <name>` — re-installs from the original source.')
    try {
      const rec = await pluginService.update(userId, { name, projectId: session.projectId ?? null })
      return directReply(
        `Updated \`${rec.name}\` to v${rec.version}. Run \`/plugin reload\` or start a new turn for it to take effect.`,
      )
    } catch (err) {
      return directReply(`Update failed: ${errorMessage(err)}`)
    }
  }

  if (sub === 'remove') {
    const name = tokens.slice(2).join(' ').trim()
    if (!name) return directReply('Usage: `/plugin remove <name>`')
    try {
      await pluginService.remove(userId, { name, projectId: session.projectId ?? null })
      return directReply(`Removed \`${name}\`.`)
    } catch (err) {
      return directReply(`Remove failed: ${errorMessage(err)}`)
    }
  }

  if (sub === 'details') {
    const name = tokens.slice(2).join(' ').trim()
    if (!name) return directReply('Usage: `/plugin details <name>`.')
    const { plugins } = await pluginService.listPlugins(userId, {
      projectId: session.projectId ?? null,
    })
    const p = plugins.find((pl) => pl.name === name)
    if (!p) return directReply(`No plugin named \`${name}\`.`)
    const chips: string[] = []
    if (p.provides.tools.length)
      chips.push(
        `${p.provides.tools.length} tool(s): ${p.provides.tools.map((tool) => tool.name).join(', ')}`,
      )
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
      `- **Enabled:** ${p.enabled ? 'yes' : 'no'} | **Origin:** ${pluginOriginLabel(p)} | **Source:** ${p.bundled ? 'bundled' : p.source}`,
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
      ? 'No plugins found. Install one in Settings → Plugins, or drop a folder with a `plugin.json` into `~/.localix/plugins`.'
      : [
          '**Plugins** — enable in Settings → Plugins:',
          '',
          ...catalog.all.map(({ plugin: p, enabled }) => {
            const scope = p.scope === 'project' ? 'project' : 'global'
            const bits: string[] = []
            if (p.provides.hasNativeTools) bits.push('native tools')
            if (p.provides.mcpServers.length) bits.push(`${p.provides.mcpServers.length} mcp`)
            if (p.provides.skills.length) bits.push(`${p.provides.skills.length} skills`)
            if (p.provides.commands.length) bits.push(`${p.provides.commands.length} commands`)
            if (p.provides.agents?.length) bits.push(`${p.provides.agents.length} agents`)
            const state = p.error ? 'error' : enabled ? 'enabled' : 'disabled'
            const detail = bits.length ? ` — ${bits.join(', ')}` : ''
            return `- ${state} \`${p.manifest.name}\` _(${scope})_${detail}`
          }),
        ].join('\n')
  return directReply(reply)
}
