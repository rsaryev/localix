import { errorMessage } from '../../../lib/errors'
import type { MessageMutationResponse } from '../contracts'
import type { CommandHandlerContext, DirectReply } from './command-handlers'

/**
 * The `/plugin marketplace …` registry sub-commands (list, add, update, remove), split out of
 * the `/plugin` dispatcher.
 *
 * They are the one branch with a sub-action of their own — a second verb, its own
 * usage lines and its own failure vocabulary — so they carried a third of the file
 * while sharing nothing with the plugin lifecycle actions but the service handle.
 */

/** The slice of {@link CommandHandlerContext} the marketplace sub-commands need. */
type MarketplaceCommandContext = Pick<CommandHandlerContext, 'pluginService'>

export async function handleMarketplaceSubcommand(
  ctx: MarketplaceCommandContext,
  userId: string,
  tokens: readonly string[],
  directReply: DirectReply,
): Promise<MessageMutationResponse> {
  const { pluginService } = ctx
  const action = tokens[2]?.toLowerCase() ?? 'list'

  if (action === 'add') {
    const source = tokens.slice(3).join(' ').trim()
    if (!source) {
      return directReply(
        'Usage: `/plugin marketplace add <owner/repo[#ref] | git-url | https://…/marketplace.json | ./path>`',
      )
    }
    try {
      const { name, count } = await pluginService.addMarketplace(userId, { source })
      return directReply(
        `Added marketplace \`${name}\` (${count} plugins). Install one with \`/plugin install <name>@${name}\`.`,
      )
    } catch (err) {
      return directReply(`Marketplace add failed: ${errorMessage(err)}`)
    }
  }

  if (action === 'update') {
    const name = tokens.slice(3).join(' ').trim()
    const quoted = (names: string[]) => names.map((p) => `\`${p}\``).join(', ')
    // With no name, Claude Code refreshes every listing and leaves the installed plugins alone.
    if (!name) {
      try {
        const res = await pluginService.refreshMarketplaces(userId)
        const lines = [
          res.refreshed.length
            ? `Refreshed ${quoted(res.refreshed)}. Installed plugins keep their versions; update one marketplace's plugins with \`/plugin marketplace update <name>\`.`
            : 'No marketplace was refreshed.',
        ]
        if (res.warnings.length) lines.push(`Not refreshed: ${res.warnings.join('; ')}`)
        return directReply(lines.join(' '))
      } catch (err) {
        return directReply(`Marketplace update failed: ${errorMessage(err)}`)
      }
    }
    try {
      const res = await pluginService.updateMarketplace(userId, { name })
      const lines = [`Updated marketplace \`${res.name}\` (${res.count} plugins).`]
      if (res.updated.length) lines.push(`Updated plugins: ${quoted(res.updated)}.`)
      if (res.manual.length) lines.push(`Update these yourself: ${quoted(res.manual)}.`)
      if (res.warnings.length) lines.push(`Not updated: ${res.warnings.join('; ')}`)
      return directReply(lines.join(' '))
    } catch (err) {
      return directReply(`Marketplace update failed: ${errorMessage(err)}`)
    }
  }

  if (action === 'remove') {
    const name = tokens.slice(3).join(' ').trim()
    if (!name) return directReply('Usage: `/plugin marketplace remove <name>`')
    try {
      const { uninstalled } = await pluginService.removeMarketplace(userId, { name })
      const also = uninstalled.length
        ? ` and uninstalled its plugins: ${uninstalled.map((p) => `\`${p}\``).join(', ')}`
        : ''
      return directReply(`Removed marketplace \`${name}\`${also}.`)
    } catch (err) {
      return directReply(`Marketplace remove failed: ${errorMessage(err)}`)
    }
  }

  // A typo here used to list the marketplaces and read as if it had worked — the same
  // silent fall-through the top-level dispatcher no longer allows.
  if (action !== 'list') {
    return directReply(
      `Unknown marketplace action \`${action}\`. Use \`list [<name>]\`, \`add <source>\`, \`update [<name>]\`, or \`remove <name>\`.`,
    )
  }

  const markets = await pluginService.listMarketplaces(userId)
  // `list <name>` shows one marketplace's plugins (Claude Code's Discover tab, as text).
  const only = tokens[3]?.trim()
  if (only) {
    const market = markets.find((m) => m.name === only)
    if (!market) return directReply(`Unknown marketplace \`${only}\`.`)
    if (market.unsupported) return directReply(`\`${only}\` cannot be read: ${market.unsupported}`)
    return directReply(
      [
        `**${market.name}** — install with \`/plugin install <name>@${market.name}\`:`,
        '',
        ...market.plugins.map(
          (p) => `- \`${p.name}\`${p.description ? ` — ${p.description}` : ''}`,
        ),
      ].join('\n'),
    )
  }
  return directReply(
    [
      '**Marketplaces** — install from one with `/plugin install <name>@<marketplace>`:',
      '',
      ...markets.map(
        (m) =>
          `- \`${m.name}\` — ${m.unsupported ? `unsupported: ${m.unsupported}` : `${m.count} plugins`}`,
      ),
      '',
      'Add one: `/plugin marketplace add <owner/repo>`; see its plugins: `/plugin marketplace list <name>`.',
    ].join('\n'),
  )
}
