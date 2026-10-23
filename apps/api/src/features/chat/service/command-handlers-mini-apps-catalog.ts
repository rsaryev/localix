import { errorMessage } from '../../../lib/errors'
import type { MiniAppService } from '../../mini-apps/service'

type CatalogService = Pick<MiniAppService, 'catalogs' | 'store'>

/** A catalog by where it lives: Localix's own, its host, or a folder on this computer. */
function catalogLabel(catalog: { url: string; builtIn: boolean }): string {
  if (catalog.builtIn) return 'Localix _(built in)_'
  try {
    const url = new URL(catalog.url)
    return url.protocol === 'file:' ? 'A folder on this computer' : url.host
  } catch {
    return catalog.url
  }
}

const apps = (count: number) => `${count} app${count === 1 ? '' : 's'}`

/**
 * `/mini-app catalog list|add|remove`: the catalogs the store reads. Adding one reads it first, so
 * the reply says who publishes it before it is kept; every write goes through the catalogs owner,
 * which announces it.
 */
export async function handleMiniAppCatalogCommand(
  service: CatalogService,
  action: string | undefined,
  url: string,
  reply: (text: string) => Promise<unknown>,
): Promise<void> {
  if (action === 'add') {
    if (!url) return void (await reply('Usage: `/mini-app catalog add <url>`'))
    try {
      const preview = await service.catalogs.preview(url)
      await service.catalogs.add(preview.url)
      const from = preview.publishers.length ? ` from ${preview.publishers.join(', ')}` : ''
      await reply(
        `Added the catalog at \`${preview.url}\`: ${apps(preview.apps)}${from}, shown as unverified. They are in the store now.`,
      )
    } catch (error) {
      await reply(`The catalog was not added: ${errorMessage(error)}`)
    }
    return
  }
  if (action === 'remove') {
    if (!url) return void (await reply('Usage: `/mini-app catalog remove <url>`'))
    try {
      await service.catalogs.remove(url)
      await reply(`Removed the catalog at \`${url}\`. Apps you installed from it stay installed.`)
    } catch (error) {
      await reply(`Remove failed: ${errorMessage(error)}`)
    }
    return
  }
  const [catalogs, { entries }] = await Promise.all([service.catalogs.list(), service.store.list()])
  const count = (url: string) => entries.filter((entry) => entry.source === url).length
  await reply(
    [
      '**Mini app catalogs** — the store reads these:',
      '',
      ...catalogs.map(
        (catalog) => `- ${catalogLabel(catalog)} — ${apps(count(catalog.url))} · ${catalog.url}`,
      ),
      '',
      'Add one with `/mini-app catalog add <url>`.',
    ].join('\n'),
  )
}
