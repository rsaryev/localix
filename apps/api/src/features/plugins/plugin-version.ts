import type { MarketplaceEntry, VersionInput } from '@rsaryev/llx-plugin/marketplace'
import { readFetchedManifest } from './kit'

/**
 * What a marketplace entry's `source` tells the kit's version rules (`pluginVersion` in `./kit`)
 * before anything is fetched: a git source pinned to a commit knows it and never moves, an unpinned
 * one learns it from the fetch, and a relative entry's commit is its marketplace's (`withCommit`).
 */

const FULL_SHA = /^[0-9a-f]{7,40}$/i
const BASE = { inGitRepository: false, enclosingRepoIgnored: false } as const

type Source = MarketplaceEntry['source']
type InputOf<K extends Source['kind']> = (source: Extract<Source, { kind: K }>) => VersionInput

/** A git source pinned to a commit (`sha`, or a `ref` that is one) knows it and never moves. */
const pinOf = (source: { sha?: string; ref?: string }) => {
  const pin = [source.sha, source.ref].find((value) => value !== undefined && FULL_SHA.test(value))
  return pin ? { commitSha: pin } : {}
}

const INPUTS: { readonly [K in Source['kind']]: InputOf<K> } = {
  relative: () => ({ ...BASE, sourceKind: 'relative' }),
  github: (source) => ({ ...BASE, sourceKind: 'github', ...pinOf(source) }),
  url: (source) => ({ ...BASE, sourceKind: 'url', ...pinOf(source) }),
  'git-subdir': (source) => ({
    ...BASE,
    sourceKind: 'git-subdir',
    subdir: source.path,
    ...pinOf(source),
  }),
  npm: () => ({ ...BASE, sourceKind: 'npm' }),
  archive: (source) => ({
    ...BASE,
    sourceKind: 'archive',
    ...(source.sha256 === undefined ? {} : { archiveSha256: source.sha256 }),
  }),
  command: () => ({ ...BASE, sourceKind: 'command' }),
}

export const entryVersionInput = <K extends Source['kind']>(entry: {
  readonly source: Extract<Source, { kind: K }>
}): VersionInput => (INPUTS[entry.source.kind] as InputOf<K>)(entry.source)

const GIT_KINDS: ReadonlySet<VersionInput['sourceKind']> = new Set(['github', 'url', 'git-subdir'])

/** The commit a clone or the marketplace gave a git or relative source; a relative one is then in git. */
export const withCommit = (input: VersionInput, commitSha: string | undefined): VersionInput =>
  !commitSha || !(GIT_KINDS.has(input.sourceKind) || input.sourceKind === 'relative')
    ? input
    : { ...input, commitSha, ...(input.sourceKind === 'relative' ? { inGitRepository: true } : {}) }

/**
 * What the kit computes a fetched plugin's version from: its entry's source, the commit its files
 * came from, the manifest's `version` and the entry's (plugins/loading.md, "How Claude Code
 * computes the version"). The install names its cache folder by it; an update check compares it.
 */
export async function fetchedVersionInput(fetched: {
  readonly dir: string
  readonly entry: MarketplaceEntry
  readonly commitSha?: string
}): Promise<VersionInput> {
  const declared = (await readFetchedManifest(fetched.dir))?.version
  const { version } = fetched.entry
  return {
    ...withCommit(entryVersionInput(fetched.entry), fetched.commitSha),
    ...(declared === undefined ? {} : { manifestVersion: declared }),
    ...(version === undefined ? {} : { entryVersion: version }),
  }
}
