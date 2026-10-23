import { createHash } from 'node:crypto'

import type { MarketplaceEntry } from './marketplace'

/**
 * THE VERSION OF AN INSTALLED PLUGIN, computed as Claude Code computes it (loading.md, "How Claude
 * Code computes the version"): the manifest's `version`, else the marketplace entry's `version`,
 * else one derived from the source — a git commit shortened to 12 characters (a `git-subdir` adds a
 * hash of its path), an archive's sha256 shortened to 12, the commit of a git-hosted marketplace for
 * a relative entry, and `unknown` for a local folder or an npm package. The version names the cache
 * folder (`plugin-cache.ts`) and is how an update is detected: an unchanged version installs
 * nothing.
 */

/** What the source says about the version, as far as it is known. */
export type VersionSourceFacts =
  | { kind: 'git'; commitSha?: string; subdir?: string; pinned?: boolean }
  | { kind: 'relative'; commitSha?: string }
  | { kind: 'archive'; sha256?: string }
  | { kind: 'npm' }

export const UNKNOWN_VERSION = 'unknown'

const short = (hex: string) => hex.toLowerCase().slice(0, 12)

/** A version names a folder: one path segment, nothing that climbs out. */
function asSegment(version: string): string {
  const safe = version.trim().replace(/[^A-Za-z0-9._+-]+/g, '-')
  return !safe || /^\.+$/.test(safe) ? UNKNOWN_VERSION : safe
}

function derived(source: VersionSourceFacts): string {
  if (source.kind === 'archive') return source.sha256 ? short(source.sha256) : UNKNOWN_VERSION
  if (source.kind === 'npm' || !source.commitSha) return UNKNOWN_VERSION
  if (source.kind === 'git' && source.subdir) {
    const pathHash = createHash('sha256').update(source.subdir).digest('hex').slice(0, 8)
    return `${short(source.commitSha)}-${pathHash}`
  }
  return short(source.commitSha)
}

export function resolvePluginVersion(input: {
  manifestVersion?: string
  entryVersion?: string
  source: VersionSourceFacts
}): string {
  const declared = [input.manifestVersion, input.entryVersion].find(
    (value) => typeof value === 'string' && value.trim(),
  )
  return asSegment(declared ?? derived(input.source))
}

const FULL_SHA = /^[0-9a-f]{7,40}$/i

/**
 * What an entry's `source` tells about its version before anything is fetched. A git source pinned
 * to a commit (`sha`, or a `commit`/`ref` that is one) knows its commit and never moves; an unpinned
 * one learns it from the remote. The caller fills a relative entry's commit from its marketplace.
 */
export function entryVersionFacts(
  entry: Pick<MarketplaceEntry, 'name' | 'source'>,
): VersionSourceFacts {
  const src = entry.source
  if (typeof src === 'string') return { kind: 'relative' }
  const obj = src as Record<string, unknown>
  if (obj.source === 'npm' || typeof obj.npm === 'string' || typeof obj.package === 'string')
    return { kind: 'npm' }
  if (obj.source === 'archive')
    return typeof obj.sha256 === 'string'
      ? { kind: 'archive', sha256: obj.sha256 }
      : { kind: 'archive' }
  const pin = [obj.sha, obj.commit, obj.ref].find(
    (value): value is string => typeof value === 'string' && FULL_SHA.test(value),
  )
  const subdir = typeof obj.path === 'string' ? { subdir: obj.path } : {}
  return pin ? { kind: 'git', commitSha: pin, ...subdir, pinned: true } : { kind: 'git', ...subdir }
}
