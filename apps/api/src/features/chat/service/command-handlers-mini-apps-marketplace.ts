import { errorMessage } from '../../../lib/errors'
import type { MiniAppService } from '../../mini-apps/service'

type MarketplaceService = Pick<MiniAppService, 'marketplaces' | 'store'>

const apps = (count: number) => `${count} app${count === 1 ? '' : 's'}`

/**
 * `/mini-app marketplace list|add|remove`: the marketplaces the store reads, each by the name its
 * apps carry (`<app>@<name>`). Adding one reads it first, so the reply says what it is called and
 * who keeps it before it is kept; every write goes through the marketplaces owner, which announces
 * it.
 */
export async function handleMiniAppMarketplaceCommand(
  service: MarketplaceService,
  action: string | undefined,
  input: string,
  reply: (text: string) => Promise<unknown>,
): Promise<void> {
  if (action === 'add') {
    if (!input) return void (await reply('Usage: `/mini-app marketplace add <owner/repo or url>`'))
    try {
      const preview = await service.marketplaces.preview(input)
      await service.marketplaces.add(input)
      const keeper = preview.publishers.length ? ` kept by ${preview.publishers.join(', ')}` : ''
      await reply(
        `Added the marketplace \`${preview.name}\` (\`${input}\`): ${apps(preview.apps)}${keeper}, shown as unverified. They are in the store now, as \`<app>@${preview.name}\`.`,
      )
    } catch (error) {
      await reply(`The marketplace was not added: ${errorMessage(error)}`)
    }
    return
  }
  const marketplaces = await service.marketplaces.list()
  if (action === 'remove') {
    if (!input) return void (await reply('Usage: `/mini-app marketplace remove <name>`'))
    const found = marketplaces.find((it) => it.name === input || it.url === input)
    if (!found)
      return void (await reply(
        `No marketplace here is called \`${input}\`; \`/mini-app marketplace list\` shows them`,
      ))
    try {
      await service.marketplaces.remove(found.url)
      await reply(
        `Removed the marketplace \`${found.name}\`. Apps you installed from it stay installed.`,
      )
    } catch (error) {
      await reply(`Remove failed: ${errorMessage(error)}`)
    }
    return
  }
  const { entries } = await service.store.list()
  const count = (url: string) => entries.filter((entry) => entry.source === url).length
  await reply(
    [
      '**Mini app marketplaces** — the store reads these:',
      '',
      ...marketplaces.map(
        (it) =>
          `- \`${it.name}\`${it.builtIn ? ' _(built in)_' : ''} — ${apps(count(it.url))} · ${it.url}`,
      ),
      '',
      'Add one with `/mini-app marketplace add <owner/repo or url>`.',
    ].join('\n'),
  )
}
