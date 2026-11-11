import type { MarketplaceEntry, VersionSourceFacts } from './kit'

/**
 * What a marketplace entry's `source` tells about the plugin's version before anything is fetched,
 * for the kit's version rules (`pluginVersion` in `./kit`): a git source pinned to a commit knows
 * it and never moves, an unpinned one learns it from the remote, and a relative entry's commit is
 * its marketplace's, filled in by the caller.
 */

const FULL_SHA = /^[0-9a-f]{7,40}$/i

type Source = MarketplaceEntry['source']
type FactsOf<K extends Source['kind']> = (
  source: Extract<Source, { kind: K }>,
) => VersionSourceFacts

/** A git source pinned to a commit (`sha`, or a `ref` that is one) knows it and never moves. */
const gitFacts = (source: { sha?: string; ref?: string; path?: string }): VersionSourceFacts => {
  const pin = [source.sha, source.ref].find((value) => value !== undefined && FULL_SHA.test(value))
  const subdir = source.path === undefined ? {} : { subdir: source.path }
  return pin ? { kind: 'git', commitSha: pin, ...subdir, pinned: true } : { kind: 'git', ...subdir }
}

const FACTS: { readonly [K in Source['kind']]: FactsOf<K> } = {
  relative: () => ({ kind: 'relative' }),
  github: (source) => gitFacts({ ...source, path: undefined }),
  url: (source) => gitFacts({ ...source, path: undefined }),
  'git-subdir': gitFacts,
  npm: () => ({ kind: 'npm' }),
  archive: (source) =>
    source.sha256 === undefined ? { kind: 'archive' } : { kind: 'archive', sha256: source.sha256 },
  command: () => ({ kind: 'command' }),
}

const factsOf = <K extends Source['kind']>(source: Extract<Source, { kind: K }>) =>
  (FACTS[source.kind] as FactsOf<K>)(source)

export const entryVersionFacts = (entry: Pick<MarketplaceEntry, 'source'>): VersionSourceFacts =>
  factsOf(entry.source)
