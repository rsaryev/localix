import { resolve } from 'node:path'
import {
  planPluginFetch,
  type FetchPlan,
  type MarketplaceEntry,
  type MarketplaceSource,
} from '@rsaryev/llx-plugin/marketplace'
import { isPathWithin } from '../../../../lib/path-containment'
import { issueLine } from '../catalog/issue-line'
import { hostPlatform } from '../ports/host-io'

/**
 * How one marketplace entry's plugin is fetched, as the kit plans it (`planPluginFetch`). Localix's
 * transports run the plan (`marketplace-materialize.ts`); a `command` source is refused, because
 * Localix does not run one.
 */
export type EntryFetchPlan = Exclude<FetchPlan, { kind: 'command' }>

/** The plan for `entry`'s source, the marketplace added from `origin`, or throw why there is none. */
export function entryFetchPlan(
  entry: MarketplaceEntry,
  origin?: MarketplaceSource,
): EntryFetchPlan {
  const { plan, issues } = planPluginFetch(entry.source, {
    platform: hostPlatform(),
    ...(origin === undefined ? {} : { marketplaceOrigin: origin }),
  })
  if (!plan)
    throw new Error(
      `Entry "${entry.name}" source: ${issues.map(issueLine).join('; ') || 'refused'}`,
    )
  if (plan.kind === 'command')
    throw new Error(
      `Entry "${entry.name}" uses a "command" source, which Localix does not run; install the plugin from the directory that command prints`,
    )
  return plan
}

/** The folder a `local` plan names inside the marketplace rooted in `root`; throw when it leaves it. */
export function localEntryDir(
  root: string,
  entry: MarketplaceEntry,
  plan: Extract<FetchPlan, { kind: 'local' }>,
): string {
  const dir = resolve(root, plan.fromMarketplaceRoot)
  if (!isPathWithin(resolve(root), dir))
    throw new Error(`Entry "${entry.name}" source resolves outside the marketplace`)
  return dir
}

/** The folder of `entry` inside its marketplace, or `null` for a remote source; throws as above. */
export function entryFolder(
  root: string,
  entry: MarketplaceEntry,
  origin?: MarketplaceSource,
): string | null {
  const plan = entryFetchPlan(entry, origin)
  return plan.kind === 'local' ? localEntryDir(root, entry, plan) : null
}
