import { errorMessage } from '../../../lib/errors'
import type { MessageMutationResponse } from '../contracts'
import type { CommandHandlerContext, DirectReply } from './command-handlers'

/**
 * The `/plugin marketplace …` registry sub-commands (list, add, remove), split out of
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
      return directReply('Usage: `/plugin marketplace add <owner/repo | git-url | /absolute/path>`')
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

  if (action === 'remove') {
    const name = tokens.slice(3).join(' ').trim()
    if (!name) return directReply('Usage: `/plugin marketplace remove <name>`')
    try {
      await pluginService.removeMarketplace(userId, { name })
      return directReply(`Removed marketplace \`${name}\`.`)
    } catch (err) {
      return directReply(`Marketplace remove failed: ${errorMessage(err)}`)
    }
  }

  // A typo here used to list the marketplaces and read as if it had worked — the same
  // silent fall-through the top-level dispatcher no longer allows.
  if (action !== 'list') {
    return directReply(
      `Unknown marketplace action \`${action}\`. Use \`list\`, \`add <source>\`, or \`remove <name>\`.`,
    )
  }

  const markets = await pluginService.listMarketplaces(userId)
  return directReply(
    [
      '**Marketplaces** — install from one with `/plugin install <name>@<marketplace>`:',
      '',
      ...markets.map(
        (m) => `- \`${m.name}\`${m.builtin ? ' _(built-in)_' : ''} — ${m.count} plugins`,
      ),
      '',
      'Add one: `/plugin marketplace add <owner/repo>`.',
    ].join('\n'),
  )
}
