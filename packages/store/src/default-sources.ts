import type { PackageKind, Trust } from './contract'

/**
 * THE DEFAULT SOURCES (`docs/internals/store-scale.md`, "Default sources"): the configuration a
 * fresh profile starts with. Adding a source is one entry here. Each provider registers its own
 * entries for browsing only — nothing from them is installed or enabled — and remembers the ones
 * the person removed, so they are not added back. A source the person adds that is not on this
 * list is `community`, with the community weight.
 */
export interface DefaultSource {
  /** Stable id: the provider's own name for the source once added. */
  id: string
  kind: PackageKind
  /** What the provider's add takes: a catalog URL, `owner/repo`, a registry URL. */
  input: string
  /** Only these folders of a repository are checked out (a git source). */
  paths?: readonly string[]
  trust: Trust
  /** Ranking factor (`TRUST_WEIGHTS` by default). */
  weight: number
  /** Whether its featured flags, hero and collections may reach Discover. */
  editorial: boolean
}

/** A trust's default ranking weight. */
export const TRUST_WEIGHTS: Readonly<Record<Trust, number>> = {
  localix: 1,
  official: 0.7,
  community: 0.35,
}

export const DEFAULT_SOURCES: readonly DefaultSource[] = [
  {
    id: 'localix-mini-apps',
    kind: 'mini-app',
    input: 'https://github.com/rsaryev/localix/releases/latest/download/mini-app-catalog.json',
    trust: 'localix',
    weight: TRUST_WEIGHTS.localix,
    editorial: true,
  },
  {
    id: 'localix',
    kind: 'plugin',
    input: 'rsaryev/localix',
    paths: ['.claude-plugin', 'plugins'],
    trust: 'localix',
    weight: TRUST_WEIGHTS.localix,
    editorial: true,
  },
  {
    id: 'claude-plugins-official',
    kind: 'plugin',
    input: 'anthropics/claude-plugins-official',
    trust: 'official',
    weight: TRUST_WEIGHTS.official,
    editorial: true,
  },
  {
    id: 'claude-community',
    kind: 'plugin',
    input: 'anthropics/claude-plugins-community',
    trust: 'community',
    weight: TRUST_WEIGHTS.community,
    editorial: false,
  },
]

export const defaultSource = (id: string): DefaultSource | undefined =>
  DEFAULT_SOURCES.find((source) => source.id === id)

/** What a source the person added themselves is. */
export const COMMUNITY_SOURCE = {
  trust: 'community',
  weight: TRUST_WEIGHTS.community,
  editorial: false,
} as const satisfies Pick<DefaultSource, 'trust' | 'weight' | 'editorial'>
