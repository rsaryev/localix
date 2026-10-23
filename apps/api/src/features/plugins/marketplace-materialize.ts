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
    await writeCatalog(staging, await fetchCatalogText(source.url))
  } else if (source.source === 'npm') {
    // Same staging helper as npm ENTRY sources: the tarball carries the catalog at its root.
    await (deps.fetchNpm ?? fetchNpmPlugin)(source, staging)
  } else {
    const url = sourceCloneUrl(source)
    if (!url) throw new Error('Unsupported marketplace source')
    assertGitArgs('Marketplace source', url, source.ref)
    await deps.cloneRepo(url, staging, source.ref, source.sparsePaths)
    commitSha = await readHeadCommit(staging)
  }
  await stripDotGit(staging)
  return commitSha ? { commitSha } : {}
}

/** Put a catalog where Claude Code reads it, `<root>/.claude-plugin/marketplace.json`. */
async function writeCatalog(root: string, text: string): Promise<void> {
  await fs.mkdir(join(root, MANIFEST_DIR), { recursive: true })
  await fs.writeFile(join(root, MARKETPLACE_FILE), text)
}

/**
 * Fetch an entry's remote plugin source into `staging` and return the plugin directory: the
 * checkout itself, or its `path` subdirectory (sparse-checked-out, confined to the checkout).
 */
export async function fetchEntryPlugin(
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
