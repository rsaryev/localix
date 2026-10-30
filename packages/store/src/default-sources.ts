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
  /** What the provider's add takes: `owner/repo`, a marketplace URL, a registry URL. */
  input: string
  /** Only these folders of a repository are checked out (a git source). */
  paths?: readonly string[]
  trust: Trust
  /** Ranking factor (`TRUST_WEIGHTS` by default). */
  weight: number
  /** Whether its featured flags and collections may reach Discover. */
  editorial: boolean
  /** What the Store calls it, rather than its id or a marketplace's URL. */
  label?: string
}

/** A trust's default ranking weight. */
export const TRUST_WEIGHTS: Readonly<Record<Trust, number>> = {
  localix: 1,
  official: 0.7,
  community: 0.35,
}

/**
 * LOCALIX'S OWN MARKETPLACE, and everything the core knows about Localix's plugins and mini apps:
 * the repository they live in. Its plugins are the Claude Code marketplace at its root; its mini
 * apps are the marketplace each of its releases publishes. They install, update and are trusted
 * through the same flow as anyone's — the core names none of them.
 */
export const LOCALIX_MARKETPLACE = {
  name: 'localix',
  repo: 'rsaryev/localix-marketplace',
  /** Only the plugin marketplace and the plugins are checked out, not the mini apps' sources. */
  paths: ['.claude-plugin', 'plugins'],
  /**
   * The Ed25519 public keys (base64) its mini app marketplace is signed with, as Localix ships them
   * (`docs/extending/mini-app-marketplace.md`, "Signing"). A release may name the keys of the next
   * one (`signingKeys`), so a key moves without a Localix release; shipping other keys here drops
   * every key kept from these, which is how a leaked key is replaced. Its private key signs each
   * release in the marketplace's CI (the `MINI_APP_SIGNING_KEY` secret).
   */
  signingKeys: ['bwCq5MPyZb+OxOHQnaBtzi9GmXBvu1U6WnGeyEPhdXg='] as readonly string[],
} as const

/**
 * LOCALIX COMMUNITY: a list, in its own repository, of the plugins and mini apps people publish in
 * their own repositories. It holds no code: each plugin entry names the repository it lives in (as
 * Anthropic's community marketplace does), and each mini app entry the marketplace its author's
 * releases publish, signed (or not) with the author's own key. Its own mini app marketplace is a
 * release like any, signed by the community's key. Localix lists it for browsing, at the
 * community trust: its publishers are not verified, and installing asks first.
 */
export const LOCALIX_COMMUNITY = {
  name: 'localix-community',
  repo: 'rsaryev/localix-community',
  /** As `LOCALIX_MARKETPLACE.signingKeys`; its private key is that repository's secret. */
  signingKeys: ['wORGUn4IvGMwsealgokrxlO0Q9j1LwayZgt6x0qwGhM='] as readonly string[],
} as const

export const DEFAULT_SOURCES: readonly DefaultSource[] = [
  {
    id: 'localix-mini-apps',
    kind: 'mini-app',
    input: LOCALIX_MARKETPLACE.repo,
    trust: 'localix',
    weight: TRUST_WEIGHTS.localix,
    editorial: true,
    label: 'Localix',
  },
  {
    id: 'localix-community-mini-apps',
    kind: 'mini-app',
    input: LOCALIX_COMMUNITY.repo,
    trust: 'community',
    weight: TRUST_WEIGHTS.community,
    editorial: false,
    label: 'Localix Community',
  },
  {
    id: LOCALIX_MARKETPLACE.name,
    kind: 'plugin',
    input: LOCALIX_MARKETPLACE.repo,
    paths: LOCALIX_MARKETPLACE.paths,
    trust: 'localix',
    weight: TRUST_WEIGHTS.localix,
    editorial: true,
    label: 'Localix',
  },
  {
    id: LOCALIX_COMMUNITY.name,
    kind: 'plugin',
    input: LOCALIX_COMMUNITY.repo,
    paths: ['.claude-plugin'],
    trust: 'community',
    weight: TRUST_WEIGHTS.community,
    editorial: false,
    label: 'Localix Community',
  },
  {
    id: 'claude-plugins-official',
    kind: 'plugin',
    input: 'anthropics/claude-plugins-official',
    trust: 'official',
    weight: TRUST_WEIGHTS.official,
    editorial: true,
    label: 'Claude plugins',
  },
  {
    id: 'claude-community',
    kind: 'plugin',
    input: 'anthropics/claude-plugins-community',
    trust: 'community',
    weight: TRUST_WEIGHTS.community,
    editorial: false,
    label: 'Claude community',
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
