import type { ListingRef, Scope } from '@localixai/store'
import { errorMessage } from '../../../lib/errors'
import { planText } from '../../agent-core/tools/store-call'
import type { SessionRecord } from '../repository'
import type { ChatServiceDeps } from './context'

/**
 * The `/plugin` commands that name a Store listing, through the Store (`docs/internals/store.md`)
 * rather than the plugin service: the same plan, consent and install job the Store screen runs.
 * Reached through `deps.store`, wired in `bootstrap/` (A4).
 *
 * A listing is `<name>@<marketplace>`, a marketplace the person already added. An address (a git
 * URL, `owner/repo`, a folder) names no listing; those installs stay the plugin service's.
 */

export type StoreCommandContext = { deps?: Pick<ChatServiceDeps, 'store'> }

const LISTING_ID = /^[\w.-]+@[\w.-]+$/u
const BARE_NAME = /^[\w.-]+$/u

/** Whether an install's source is a Store listing, with the marketplace it names or adds. */
export function isStoreInstall(source: string, marketplace: string | undefined): boolean {
  return marketplace ? BARE_NAME.test(source) : LISTING_ID.test(source)
}

const NO_STORE = 'The Store is not available here.'

/** The marketplace a just-added source made: the one that was not there before. */
async function addedMarketplace(
  store: NonNullable<StoreCommandContext['deps']>['store'] & {},
  source: string,
  before: readonly string[],
) {
  const plugins = (await store.sources()).sources.filter((entry) => entry.kind === 'plugin')
  return (
    plugins.find((entry) => !before.includes(entry.id)) ??
    // Already added: it is the one whose address is what the person typed.
    plugins.find((entry) => entry.id === source || entry.url === source)
  )
}

const pluginSourceIds = async (store: {
  sources(): Promise<{ sources: { kind: string; id: string }[] }>
}) =>
  (await store.sources()).sources
    .filter((entry) => entry.kind === 'plugin')
    .map((entry) => entry.id)

/** `/plugin marketplace add <source>`: the Store's Add source. */
export async function addMarketplaceThroughStore(
  ctx: StoreCommandContext,
  source: string,
): Promise<string> {
  const store = ctx.deps?.store
  if (!store) return `Marketplace add failed: ${NO_STORE}`
  try {
    const before = await pluginSourceIds(store)
    await store.addSource('plugin', source)
    const added = await addedMarketplace(store, source, before)
    if (!added) return 'Added the marketplace. Find its plugins in the Store.'
    return `Added marketplace \`${added.id}\` (${added.count} plugins). Install one with \`/plugin install <name>@${added.id}\`.`
  } catch (err) {
    return `Marketplace add failed: ${errorMessage(err)}`
  }
}

/**
 * `/plugin install <name>@<marketplace> | <name> --marketplace <source>`: read the plan, and queue
 * the install. A plan that needs consent (a community marketplace, a program it runs) is listed and
 * installed only when the command is repeated with `--yes`.
 */
export async function installThroughStore(
  ctx: StoreCommandContext,
  userId: string,
  session: SessionRecord,
  input: { source: string; marketplace: string | undefined; toProject: boolean; yes: boolean },
): Promise<string> {
  const store = ctx.deps?.store
  if (!store) return `Install failed: ${NO_STORE}`
  const scope: Scope = input.toProject ? 'project' : 'user'
  const actor = { userId, projectId: session.projectId ?? null }
  try {
    let id = input.source
    if (input.marketplace) {
      const before = await pluginSourceIds(store)
      await store.addSource('plugin', input.marketplace)
      const added = await addedMarketplace(store, input.marketplace, before)
      if (!added)
        throw new Error('could not tell which marketplace that added; use name@marketplace')
      id = `${input.source}@${added.id}`
    }
    const ref: ListingRef = { kind: 'plugin', id }
    const plan = await store.plan(ref, scope, actor)
    if (plan.needsConsent && !input.yes) {
      return [
        `Installing \`${id}\` asks for your consent first:`,
        '',
        ...planText(plan).map((line) => `- ${line}`),
        '',
        `Accept it with \`/plugin install ${id}${input.toProject ? ' --project' : ''} --yes\`.`,
      ].join('\n')
    }
    await store.install(ref, scope, { plan: input.yes }, actor)
    return `Install of \`${id}\` started for ${scope === 'project' ? 'this project' : 'all chats'}. It runs in the background; \`/plugin list\` shows it once it is done.`
  } catch (err) {
    return `Install failed: ${errorMessage(err)}`
  }
}
