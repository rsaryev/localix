import {
  planPluginFetch,
  type Marketplace,
  type MarketplaceEntry,
  type NpmFetchPlan,
} from '@rsaryev/llx-plugin/marketplace'
import { parseMarketplace } from './catalog'

/** A marketplace as the kit reads it, from the fields a catalog writes (`name`, `owner` filled). */
export const kitMarketplace = (fields: Record<string, unknown>): Marketplace =>
  parseMarketplace({ name: 'm', owner: { name: 'o' }, plugins: [], ...fields })

/** One marketplace entry as the kit reads it, from the fields a catalog writes. */
export function kitEntry(fields: Record<string, unknown>): MarketplaceEntry {
  const entry = kitMarketplace({ plugins: [fields] }).plugins[0]
  if (!entry) throw new Error(`The kit leaves this entry out: ${JSON.stringify(fields)}`)
  return entry
}

/** The kit's plan for an npm source (`package` as a catalog writes it, a name or a tarball link). */
export function npmPlan(source: { package: string; version?: string; registry?: string }) {
  const { plan, issues } = planPluginFetch({ kind: 'npm', ...source }, { platform: 'posix' })
  if (plan?.kind !== 'npm')
    throw new Error(`The kit refuses this npm source: ${issues[0]?.message}`)
  return plan satisfies NpmFetchPlan
}
