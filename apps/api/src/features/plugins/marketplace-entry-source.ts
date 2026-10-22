import { resolve } from 'node:path'

import { isPathWithin } from '../../lib/path-containment'
import { assertGitArgs } from './marketplace-git-args'
import { parseNpmEntrySource, type NpmEntrySource } from './marketplace-source-npm'
import type { MarketplaceEntry } from './marketplace'

/**
 * Where one marketplace entry's plugin comes from (Claude Code's plugin sources): a directory
 * inside the materialized marketplace, git coordinates, an npm package, or an HTTPS zip archive.
 */
export type ResolvedEntrySource =
  | { localPath: string }
  | { git: { url: string; subdir?: string; ref?: string } }
  | { npm: NpmEntrySource }
  | { archive: { url: string; sha256?: string } }

const GITHUB_SHORTHAND = /^[\w.-]+\/[\w.-]+$/

/** The checkout target, `sha > commit > ref`: a pinned commit survives a deleted branch. */
function checkoutRef(obj: Record<string, unknown>): string | undefined {
  for (const key of ['sha', 'commit', 'ref'] as const) {
    if (typeof obj[key] === 'string' && obj[key]) return obj[key]
  }
  return undefined
}

/** A relative string source, resolved from the marketplace root and confined to it. */
function relativeSource(
  marketplaceDir: string,
  entry: MarketplaceEntry,
  src: string,
  pluginRoot?: string,
): { localPath: string } {
  if (src.includes('..'))
    throw new Error(`Entry "${entry.name}" source "${src}" escapes the marketplace root`)
  const root = resolve(marketplaceDir)
  // `metadata.pluginRoot` applies only to a bare name (no `/`); `./x` is always from the root.
  const bare = src !== '.' && !src.startsWith('./') && !src.includes('/')
  const base = bare && pluginRoot ? resolve(root, pluginRoot) : root
  const abs = resolve(base, src)
  if (!isPathWithin(root, abs))
    throw new Error(`Entry "${entry.name}" source resolves outside the marketplace`)
  return { localPath: abs }
}

/**
 * Resolve a marketplace entry's `source` to either a local plugin directory (a relative path
 * inside the materialized marketplace, `..`-escapes rejected) or the coordinates the caller
 * fetches: git (`github`, `url`, `git-subdir`, and the untyped `{url|repo}` shape), `npm`, or an
 * `archive`. A `command` source is refused: it runs a command on this machine that the user
 * would first have to review.
 */
export function resolveEntrySource(
  marketplaceDir: string,
  entry: MarketplaceEntry,
  opts?: { pluginRoot?: string },
): ResolvedEntrySource {
  const src = entry.source
  if (typeof src === 'string') return relativeSource(marketplaceDir, entry, src, opts?.pluginRoot)
  const obj = src as Record<string, unknown>
  const kind = typeof obj.source === 'string' ? obj.source : undefined
  if (kind === 'command')
    throw new Error(
      `Entry "${entry.name}" uses a "command" source, which Localix does not run; install the plugin from the directory that command prints`,
    )
  if (kind === 'archive') {
    if (typeof obj.url !== 'string' || !obj.url.startsWith('https://'))
      throw new Error(`Entry "${entry.name}" archive source needs an https:// "url"`)
    return {
      archive: {
        url: obj.url,
        ...(typeof obj.sha256 === 'string' ? { sha256: obj.sha256.toLowerCase() } : {}),
      },
    }
  }
  // npm source → registry coordinates (parse throws per-entry on a bad package name).
  const npm = parseNpmEntrySource(entry.name, obj)
  if (npm) return { npm }
  const rawUrl = typeof obj.url === 'string' ? obj.url : undefined
  // `git-subdir` also takes GitHub `owner/repo` shorthand for its `url`.
  const url =
    rawUrl !== undefined
      ? kind === 'git-subdir' && GITHUB_SHORTHAND.test(rawUrl)
        ? `https://github.com/${rawUrl}.git`
        : rawUrl
      : typeof obj.repo === 'string'
        ? `https://github.com/${obj.repo}.git`
        : undefined
  if (!url) throw new Error(`Entry "${entry.name}" has an unrecognized source`)
  const ref = checkoutRef(obj)
  // Both become git arguments: no option-shaped value, no `ext::` command transport.
  assertGitArgs(`Entry "${entry.name}" source`, url, ref)
  return {
    git: {
      url,
      subdir: typeof obj.path === 'string' ? obj.path : undefined,
      ...(ref ? { ref } : {}),
    },
  }
}
