import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import type { CapabilitySourceRepository } from '../capabilities/source-repository'
import { isRecord } from '../../lib/record'
import type { DiscoveredPlugin } from './discovery-types'
import { resolveEntryName } from './marketplace'
import { readMarketplace, type KnownMarketplace } from './marketplace-catalog'
import { resolveEntrySource } from './marketplace-entry-source'
import { parseMarketplaceRef, sourceMatchesRef } from './marketplace-source'
import { readInstallRecords } from './plugin-cache'
import {
  entryVersionFacts,
  resolvePluginVersion,
  UNKNOWN_VERSION,
  type VersionSourceFacts,
} from './plugin-version'

/**
 * WHAT AN UPDATE WOULD INSTALL, computed without installing: the version of each user-scope plugin
 * installed from a marketplace, against the version its current listing resolves to by Claude
 * Code's rule (`plugin-version.ts`). A relative entry is read in the marketplace's copy (its
 * manifest, else the entry, else the marketplace's commit); a git entry pinned to a commit is that
 * commit and never moves; an unpinned git entry asks the remote for its commit (`git ls-remote`),
 * since its manifest is not known before a fetch, and counts as newer only when the commit differs
 * from the one installed. An npm or an unpinned archive entry is `unknown`, so it never updates
 * unless a `version` field changes, as in Claude Code.
 */
export interface MarketplaceInstall {
  /** `<plugin>@<marketplace>`. */
  id: string
  name: string
  marketplace: string
  /** The install row's source, what an update installs again. */
  source: string
  version: string
  commitSha?: string
}

export interface UpdateCandidate {
  version: string
  /** The commit the listing points at, for a git source. */
  commitSha?: string
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
      const declared = plugin.rawManifest?.version
      return {
        id,
        name: id.slice(0, id.lastIndexOf('@')),
        marketplace: id.slice(id.lastIndexOf('@') + 1),
        source: row.source,
        version: record?.version ?? (typeof declared === 'string' ? declared : UNKNOWN_VERSION),
        ...(record?.gitCommitSha ? { commitSha: record.gitCommitSha } : {}),
      }
    }),
  )
  return installs.filter((install): install is MarketplaceInstall => install !== null)
}

async function manifestVersion(dir: string): Promise<string | undefined> {
  try {
    const json = JSON.parse(await fs.readFile(join(dir, '.claude-plugin', 'plugin.json'), 'utf8'))
    return isRecord(json) && typeof json.version === 'string' ? json.version : undefined
  } catch {
    return undefined
  }
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

/** The version the install's current listing resolves to, or null when it is no longer listed. */
export async function candidateFor(
  install: MarketplaceInstall,
  known: Record<string, KnownMarketplace>,
  remoteCommit: (url: string, ref?: string) => Promise<string | undefined>,
): Promise<UpdateCandidate | null> {
  const found = marketplaceRecord(known, install.marketplace)
  if (!found) return null
  const [, record] = found
  const market = await readMarketplace(record.installLocation).catch(() => null)
  if (!market) return null
  let name: string
  try {
    name = resolveEntryName(market, install.name).name
  } catch {
    return null
  }
  const entry = market.plugins.find((plugin) => plugin.name === name)
  if (!entry) return null
  if ((entry as Record<string, unknown>).headersHelper !== undefined)
    return { version: install.version, manual: 'its marketplace entry sets a headersHelper' }
  let facts: VersionSourceFacts = entryVersionFacts(entry)
  let declared: string | undefined
  const resolved = (() => {
    try {
      return resolveEntrySource(record.installLocation, entry, {
        pluginRoot: market.metadata?.pluginRoot,
      })
    } catch {
      return null
    }
  })()
  if (resolved && 'localPath' in resolved) {
    declared = await manifestVersion(resolved.localPath)
    if (record.gitCommitSha) facts = { kind: 'relative', commitSha: record.gitCommitSha }
  } else if (resolved && 'git' in resolved && facts.kind === 'git' && !facts.commitSha) {
    const commitSha = await remoteCommit(resolved.git.url, resolved.git.ref)
    if (commitSha) facts = { ...facts, commitSha }
  }
  const version = resolvePluginVersion({
    manifestVersion: declared,
    entryVersion: entry.version,
    source: facts,
  })
  const commitSha = 'commitSha' in facts ? facts.commitSha : undefined
  return { version, ...(commitSha ? { commitSha } : {}) }
}

/** Whether installing the candidate would change the install, as far as can be known now. */
export function isNewer(install: MarketplaceInstall, candidate: UpdateCandidate): boolean {
  if (candidate.manual || candidate.version === UNKNOWN_VERSION) return false
  if (candidate.version === install.version) return false
  // A remote git source whose commit is the installed one has nothing new, whatever the version
  // string the listing alone can compute.
  return !(candidate.commitSha && install.commitSha === candidate.commitSha)
}
