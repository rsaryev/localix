import { promises as fs } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

import { MANIFEST_DIR, MARKETPLACE_FILE } from '@localixai/claude-plugin'

import { isPathWithin } from '../../lib/path-containment'
import { copyExtensionTree, rmrf, stripDotGit } from '../ext/install-tree'
import {
  sourceCloneUrl,
  type MarketplaceSource,
  type ResolvedEntrySource,
} from './marketplace-source'
import { assertGitArgs } from './marketplace-git-args'
import { fetchNpmPlugin } from './marketplace-source-npm'
import { fetchArchivePlugin, fetchCatalogText } from './marketplace-source-archive'
import type { MarketplaceRegistryDeps } from './marketplace-registry'
import { readHeadCommit } from './git-fetch'
import { urlSourceHeaders } from './marketplace-headers'

/**
 * Fetching for the marketplace registry: a marketplace source into its staging dir, and one
 * entry's remote plugin source into a plugin dir. Both end in plain directories; the registry
 * owns staging names, activation and `known.json`.
 */

/**
 * Materialize a marketplace source into `staging` (replaced). A directory is copied, keeping only
 * the symlinks that resolve inside it (installing a plugin later dereferences those); a catalog
 * file brings its marketplace root (two levels up, when it sits in `.claude-plugin/`) or else only
 * itself; a hosted catalog (`url`) is just its `marketplace.json`, so its relative plugin sources
 * cannot resolve; git and npm sources are fetched.
 */
export async function materializeMarketplace(
  source: MarketplaceSource,
  staging: string,
  deps: MarketplaceRegistryDeps,
): Promise<{ commitSha?: string }> {
  await rmrf(staging)
  let commitSha: string | undefined
  if (source.source === 'local') {
    await copyExtensionTree(source.path, staging)
  } else if (source.source === 'file') {
    const file = resolve(source.path)
    const inLayout = basename(dirname(file)) === MANIFEST_DIR
    if (inLayout) await copyExtensionTree(dirname(dirname(file)), staging)
    await writeCatalog(staging, await fs.readFile(file, 'utf8'))
  } else if (source.source === 'url') {
    const headers = await urlSourceHeaders(source)
    await writeCatalog(staging, await fetchCatalogText(source.url, { headers }))
  } else if (source.source === 'settings') {
    // An inline catalog: its plugins name object sources, there being no repository to resolve in.
    const { name, owner, plugins } = source
    await fs.mkdir(staging, { recursive: true })
    await writeCatalog(staging, JSON.stringify({ name, owner: owner ?? { name }, plugins }))
  } else if (source.source === 'npm') {
    // Same staging helper as npm ENTRY sources: the tarball carries the catalog at its root.
    await (deps.fetchNpm ?? fetchNpmPlugin)(source, staging)
  } else {
    const url = sourceCloneUrl(source)
    if (!url) throw new Error('Unsupported marketplace source')
    assertGitArgs('Marketplace source', url, source.ref)
    await deps.cloneRepo(url, staging, source.ref, source.sparsePaths)
    commitSha = await readHeadCommit(staging)
    // `path` names the catalog inside the repository; the repository stays the marketplace root.
    if (source.path) {
      const file = resolve(staging, source.path)
      if (!isPathWithin(resolve(staging), file))
        throw new Error(`Marketplace path escapes the repository: ${source.path}`)
      await writeCatalog(staging, await fs.readFile(file, 'utf8'))
    }
  }
  await stripDotGit(staging)
  return commitSha ? { commitSha } : {}
}

/** Put a catalog where Claude Code reads it, `<root>/.claude-plugin/marketplace.json`. */
async function writeCatalog(root: string, text: string): Promise<void> {
  await fs.mkdir(join(root, MANIFEST_DIR), { recursive: true })
  await fs.writeFile(join(root, MARKETPLACE_FILE), text)
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
