import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { readManifest, type PluginManifest } from '@rsaryev/llx-plugin/format'
import {
  catalogDependencies,
  installClosure,
  normalizeDependency,
  type CatalogPlugin,
  type DependencyInstallOperation,
  type EnabledPlugins,
  type InstallPlan,
  type InstalledRecord,
  type MarketplaceEntry,
  type NormalizedDependency,
} from '@rsaryev/llx-plugin/marketplace'
import { PLUGIN_MANIFEST } from '../catalog/plugin-folder'

/**
 * The dependency closure of an install, planned by the kit (`installClosure`, judgment
 * `installNeeds`): every registered marketplace's entries form the catalog, each with its entry's
 * dependencies only (`manifestUnread`); the plan names what it reached in `needs`, the host fetches
 * those, their `plugin.json` fills their dependencies (`catalogDependencies`) and the kit plans
 * again until nothing is needed. Localix supplies the facts and the fetch; the rules are the kit's.
 */

export type ClosureScope = 'user' | 'project'

/** A registered marketplace as the closure reads it. */
export interface ClosureMarketplace {
  readonly name: string
  readonly plugins: readonly MarketplaceEntry[]
  readonly allowCrossMarketplaceDependenciesOn: readonly string[]
}

/** What a fetch of a catalog plugin's current copy tells the plan. */
export interface FetchedCopy {
  /** Its `plugin.json` as written (`readFetchedManifest`); `undefined` when it has none. */
  readonly manifest: PluginManifest | undefined
  /** The tags of the repository that hosts it, for a git source. */
  readonly tags?: readonly string[]
}

export interface ClosureInput {
  /** `name@marketplace` of the plugin being installed. */
  readonly root: string
  readonly scope: ClosureScope
  readonly operation: DependencyInstallOperation
  /** The root's own copy, already fetched. */
  readonly rootCopy: FetchedCopy
  readonly installed: readonly InstalledRecord[]
  readonly enabled: EnabledPlugins
  readonly marketplaces: readonly ClosureMarketplace[]
  /** Fetch the current copy of `id`, a plugin the plan needs. */
  fetch(id: string): Promise<FetchedCopy>
}

const idOf = (name: string, marketplace: string) => `${name}@${marketplace}`

function catalogPlugin(
  entry: MarketplaceEntry,
  marketplace: string,
  copy?: FetchedCopy,
): CatalogPlugin {
  const declared = catalogDependencies(entry, marketplace, copy?.manifest)
  const version = copy?.manifest?.version
  return {
    name: entry.name,
    marketplace,
    source: entry.source,
    dependencies: declared.dependencies,
    ...(copy ? {} : { manifestUnread: true as const }),
    ...(copy?.tags ? { tags: copy.tags } : {}),
    ...(version === undefined ? {} : { currentCopyVersion: version }),
    ...(entry.headersHelper === undefined ? {} : { headersHelper: entry.headersHelper }),
    ...(entry.defaultEnabled === undefined ? {} : { defaultEnabled: entry.defaultEnabled }),
  }
}

/** The plan of the whole closure: the kit's, planned again after each fetch until `needs` is empty. */
export async function planInstallClosure(input: ClosureInput): Promise<InstallPlan> {
  const catalog: Record<string, CatalogPlugin> = {}
  const entries = new Map<string, { entry: MarketplaceEntry; marketplace: string }>()
  for (const market of input.marketplaces)
    for (const entry of market.plugins) {
      const id = idOf(entry.name, market.name)
      entries.set(id, { entry, marketplace: market.name })
      catalog[id] = catalogPlugin(entry, market.name)
    }
  const fill = (id: string, copy: FetchedCopy) => {
    const listed = entries.get(id)
    if (listed) catalog[id] = catalogPlugin(listed.entry, listed.marketplace, copy)
  }
  fill(input.root, input.rootCopy)
  const facts = {
    installed: input.installed,
    enabled: input.enabled,
    catalog,
    allowlists: Object.fromEntries(
      input.marketplaces.map((market) => [market.name, market.allowCrossMarketplaceDependenciesOn]),
    ),
  }
  const request = { root: input.root, scope: input.scope, operation: input.operation }
  let plan = installClosure(request, facts)
  while (plan.needs.length > 0) {
    for (const id of plan.needs) fill(id, await input.fetch(id))
    plan = installClosure(request, facts)
  }
  return plan
}

/** A fetched copy's `plugin.json` as written, read by the kit (`readManifest`); none, or one that does not read, is `undefined`. */
export async function readFetchedManifest(dir: string): Promise<PluginManifest | undefined> {
  try {
    return readManifest(JSON.parse(await fs.readFile(join(dir, PLUGIN_MANIFEST), 'utf8'))).manifest
  } catch {
    return undefined
  }
}

/**
 * An installed plugin as the plan counts it: its `name@marketplace` (bare for one from a folder or
 * a git URL), its scope, the version its manifest states and its dependencies, bare names resolving
 * in its own marketplace (`normalizeDependency`).
 */
export function installedRecord(input: {
  id: string
  scope: ClosureScope
  manifest: { version?: string; dependencies?: unknown }
}): InstalledRecord {
  const at = input.id.lastIndexOf('@')
  const marketplace = at > 0 ? input.id.slice(at + 1) : undefined
  const raw: unknown[] = Array.isArray(input.manifest.dependencies)
    ? input.manifest.dependencies
    : []
  const dependencies = raw.flatMap((item, index): NormalizedDependency[] => {
    const dep = normalizeDependency(item, marketplace, `dependencies[${index}]`)
    return 'severity' in dep ? [] : [dep]
  })
  return {
    id: input.id,
    scope: input.scope,
    dependencies,
    ...(input.manifest.version ? { version: input.manifest.version } : {}),
  }
}
