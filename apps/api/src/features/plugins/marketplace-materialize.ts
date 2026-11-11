import { promises as fs } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { isPathWithin } from '../../lib/path-containment'
import { rmrf, stripDotGit } from '../ext/install-tree'
import {
  catalogHeaders,
  DEFAULT_MARKETPLACE_PATH,
  cloneUrl,
  marketplaceFetchPlan,
  type ResolvedEntrySource,
} from './kit'
import type { MarketplaceSource } from '@rsaryev/llx-plugin/marketplace'
import { assertGitArgs } from './marketplace-git-args'
import { fetchNpmPlugin } from './marketplace-source-npm'
import { fetchArchivePlugin, fetchCatalogText } from './marketplace-source-archive'
import type { MarketplaceRegistryDeps } from './marketplace-registry'
import { readHeadCommit } from './git-fetch'

/**
 * Fetching for the marketplace registry: a marketplace source into its staging dir, and one
 * entry's remote plugin source into a plugin dir. Both end in plain directories; the registry
 * owns staging names, activation and the records.
 */

/**
 * Fetch a marketplace into `staging` (replaced) by the kit's plan (`marketplaceFetchPlan`): a git
 * repository is cloned (only its sparse folders when it names them) and its catalog put where
 * Claude Code reads it; a hosted catalog (`http-file`) is only its `marketplace.json`, so its
 * relative plugin sources cannot resolve; an inline catalog (`settings`) is written from `inline`,
 * the catalog as its settings declare it. A local file or folder is never fetched: it is read
 * where it is (`marketplace-in-place.ts`).
 */
export async function materializeMarketplace(
  source: MarketplaceSource,
  staging: string,
  deps: MarketplaceRegistryDeps,
  inline?: unknown,
): Promise<{ commitSha?: string }> {
  const plan = marketplaceFetchPlan(source)
  await rmrf(staging)
  if (plan.kind === 'http-file') {
    const headers = await catalogHeaders(
      {
        url: plan.url,
        headers: plan.headers,
        ...(plan.helper === undefined ? {} : { headersHelper: plan.helper }),
      },
      { managedSettingsDir: deps.managedSettingsDir },
    )
    await writeCatalog(staging, await fetchCatalogText(plan.url, { headers }))
    return {}
  }
  if (plan.kind === 'inline') {
    if (inline === undefined) throw new Error('An inline marketplace is added from its settings')
    await writeCatalog(staging, JSON.stringify(inline))
    return {}
  }
  if (plan.kind !== 'git') throw new Error(`A ${source.kind} marketplace is read where it is`)
  const url = cloneUrl(plan.repo)
  assertGitArgs('Marketplace source', url, plan.ref)
  await deps.cloneRepo(url, staging, plan.ref, plan.sparsePaths && [...plan.sparsePaths])
  const commitSha = await readHeadCommit(staging)
  // `path` names the catalog inside the repository; the repository stays the marketplace root.
  if (plan.path !== DEFAULT_MARKETPLACE_PATH) {
    const file = resolve(staging, plan.path)
    if (!isPathWithin(resolve(staging), file))
      throw new Error(`Marketplace path escapes the repository: ${plan.path}`)
    await writeCatalog(staging, await fs.readFile(file, 'utf8'))
  }
  await stripDotGit(staging)
  return commitSha ? { commitSha } : {}
}

/** Put a catalog where Claude Code reads it, `<root>/.claude-plugin/marketplace.json`. */
async function writeCatalog(root: string, text: string): Promise<void> {
  const file = join(root, DEFAULT_MARKETPLACE_PATH)
  await fs.mkdir(dirname(file), { recursive: true })
  await fs.writeFile(file, text)
}

/** How long a fetch made for a Store page waits for the install that may follow it. */
export const PREFETCH_REUSE_MS = 10 * 60 * 1000

const prefetchMarker = (staging: string) => `${staging}.prefetch.json`

/**
 * A fetch the Store made to show a plugin's page, still fresh and of the same source: the install
 * that follows uses it once instead of fetching again.
 */
async function takePrefetched(
  key: string,
  staging: string,
  now: number,
): Promise<{ dir: string; commitSha?: string } | null> {
  const file = prefetchMarker(staging)
  const marker = await fs
    .readFile(file, 'utf8')
    .then(
      (text) => JSON.parse(text) as { key?: string; at?: number; dir?: string; commitSha?: string },
    )
    .catch(() => null)
  if (!marker) return null
  await fs.rm(file, { force: true })
  if (marker.key !== key || typeof marker.at !== 'number' || typeof marker.dir !== 'string')
    return null
  if (now - marker.at > PREFETCH_REUSE_MS) return null
  if (!(await fs.stat(marker.dir).catch(() => null))?.isDirectory()) return null
  return { dir: marker.dir, ...(marker.commitSha ? { commitSha: marker.commitSha } : {}) }
}

/**
 * Fetch an entry's remote plugin source into `staging` and return the plugin directory: the
 * checkout itself, or its `path` subdirectory (sparse-checked-out, confined to the checkout).
 * With `prefetch` (a Store page), the fetch is kept for the install that may follow.
 */
export async function fetchEntryPlugin(
  resolved: Exclude<ResolvedEntrySource, { localPath: string }>,
  staging: string,
  deps: MarketplaceRegistryDeps,
  opts: { prefetch?: boolean } = {},
): Promise<{ dir: string; commitSha?: string }> {
  const key = JSON.stringify(resolved)
  const now = Date.parse((deps.now ?? (() => new Date().toISOString()))())
  const reused = opts.prefetch ? null : await takePrefetched(key, staging, now)
  if (reused) return reused
  const fetched = await fetchInto(resolved, staging, deps)
  if (opts.prefetch)
    await fs.writeFile(prefetchMarker(staging), JSON.stringify({ key, at: now, ...fetched }))
  return fetched
}

async function fetchInto(
  resolved: Exclude<ResolvedEntrySource, { localPath: string }>,
  staging: string,
  deps: MarketplaceRegistryDeps,
): Promise<{ dir: string; commitSha?: string }> {
  await rmrf(staging)
  if ('npm' in resolved) {
    await (deps.fetchNpm ?? fetchNpmPlugin)(resolved.npm, staging)
    return { dir: staging }
  }
  if ('archive' in resolved) {
    await (deps.fetchArchive ?? fetchArchivePlugin)(resolved.archive, staging)
    return { dir: staging }
  }
  const { url, ref, subdir } = resolved.git
  assertGitArgs('Plugin source', url, ref)
  await deps.cloneRepo(url, staging, ref, subdir)
  const commitSha = await readHeadCommit(staging)
  await stripDotGit(staging)
  const commit = commitSha ? { commitSha } : {}
  if (!subdir) return { dir: staging, ...commit }
  const dir = resolve(staging, subdir)
  if (!isPathWithin(resolve(staging), dir))
    throw new Error(`Source path escapes the repository: ${subdir}`)
  if (!(await fs.stat(dir).catch(() => null))?.isDirectory())
    throw new Error(`Source path does not exist: ${subdir} in ${url}`)
  return { dir, ...commit }
}
