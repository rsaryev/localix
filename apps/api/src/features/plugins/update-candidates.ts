import type { CapabilitySourceRepository } from '../capabilities/source-repository'
import type { DiscoveredPlugin } from './discovery-types'
import type { MarketplaceEntry } from '@rsaryev/llx-plugin/marketplace'
import {
  precheckUpdate,
  readMarketplace,
  resolveEntryName,
  UNKNOWN_VERSION,
  updateCheck,
  type KnownMarketplace,
} from './kit'
import { parseMarketplaceRef, sourceMatchesRef } from './marketplace-source'
import { readInstallRecords } from './plugin-cache'
import { fetchedVersionInput } from './plugin-version'

/**
 * WHAT AN UPDATE WOULD INSTALL, decided by the kit as Claude Code decides it (plugins/loading.md,
 * "Versions and updates"): the version of each user-scope plugin installed from a marketplace is
 * computed again from a fresh fetch of its current listing entry, and a new copy is made only when
 * it differs from the recorded one. A relative entry is read in the marketplace's copy, fetched
 * with its listing; any other is fetched as the install fetches it, and the update that follows
 * within ten minutes reuses that fetch (`marketplace-materialize.ts`). An entry that runs a
 * command the person accepts (a `headersHelper`, a `command` source) is left to them.
 */
export interface MarketplaceInstall {
  /** `<plugin>@<marketplace>`. */
  id: string
  name: string
  marketplace: string
  /** The install row's source, what an update installs again. */
  source: string
  version: string
}

export interface UpdateCandidate {
  version: string
  /** Set when the entry is one an update leaves for the person (a `headersHelper` entry). */
  manual?: string
}

/** Localix's user-scope plugins that a marketplace installed and Localix updates. */
export async function listMarketplaceInstalls(deps: {
  repo: CapabilitySourceRepository
  userId: string
  home: string
  find: (name: string) => Promise<DiscoveredPlugin | null>
}): Promise<MarketplaceInstall[]> {
  const records = await readInstallRecords(deps.home)
  const rows = await deps.repo.listForScope(deps.userId, '')
  const installs = await Promise.all(
    rows.map(async (row): Promise<MarketplaceInstall | null> => {
      const ref = parseMarketplaceRef(row.source)
      if (!ref || row.projectId) return null
      const plugin = await deps.find(row.name)
      // Built-in ones update with Localix, in-place ones load their folder, Claude Code owns its own.
      if (!plugin || plugin.inPlaceInstall || plugin.claudeCodeInstall) return null
      const id = plugin.cachedInstall?.id ?? `${ref.plugin}@${ref.marketplace}`
      const record = records[id]
      return {
        id,
        name: id.slice(0, id.lastIndexOf('@')),
        marketplace: id.slice(id.lastIndexOf('@') + 1),
        source: row.source,
        version: record?.version ?? plugin.manifest.version ?? UNKNOWN_VERSION,
      }
    }),
  )
  return installs.filter((install): install is MarketplaceInstall => install !== null)
}

/** The registered marketplace an install names, by its catalog name or the source it was added from. */
export function marketplaceRecord(
  known: Record<string, KnownMarketplace>,
  marketplace: string,
): [string, KnownMarketplace] | undefined {
  const byName = known[marketplace]
  if (byName) return [marketplace, byName]
  return Object.entries(known).find(([, record]) => sourceMatchesRef(record.source, marketplace))
}

/** What an update fetches: the install's plugin, from its marketplace, as the install fetches it. */
export type FetchPlugin = (ref: {
  plugin: string
  marketplace: string
}) => Promise<{ dir: string; commitSha?: string }>

/** Entries an update leaves for the person: each runs a command they accept (`planUpdate`). */
const leftToPerson = (entry: MarketplaceEntry): string | undefined => {
  if (entry.headersHelper !== undefined) return 'its marketplace entry sets a headersHelper'
  return entry.source.kind === 'command'
    ? 'its marketplace entry installs with a command'
    : undefined
}

/**
 * What an update of the install would bring, or null when it brings nothing or the entry is no
 * longer listed: the kit's check before the fetch (`precheckUpdate`), then on the fetched copy
 * (`updateCheck`).
 */
export async function candidateFor(
  install: MarketplaceInstall,
  known: Record<string, KnownMarketplace>,
  fetch: FetchPlugin,
): Promise<UpdateCandidate | null> {
  const found = marketplaceRecord(known, install.marketplace)
  if (!found) return null
  const [marketplace, record] = found
  const market = await readMarketplace(record).catch(() => null)
  if (!market) return null
  let name: string
  try {
    name = resolveEntryName(market, install.name).name
  } catch {
    return null
  }
  const entry = market.plugins.find((plugin) => plugin.name === name)
  if (!entry) return null
  const manual = leftToPerson(entry)
  if (manual) return { version: install.version, manual }
  const subject = { source: entry.source, origin: record.source }
  if (precheckUpdate(subject, install.version) !== 'fetch') return null
  const fetched = await fetch({ plugin: name, marketplace })
  const version = await fetchedVersionInput({ ...fetched, entry })
  const verdict = await updateCheck({ ...subject, version }, install.version)
  if (verdict.check !== 'new copy') return null
  return { version: verdict.version }
}
