import type { AddressableResource } from '../resource'

/**
 * An action offered for a node, surfaced at the TOP of the node's drill level in
 * the composer `@`-menu (above its drillable children). EVERY node is at minimum
 * LINKABLE, so a node with no explicit `actions` gets a synthetic default "Link
 * this here" client-side — a provider only declares `actions` to give the link a
 * nicer verb ("Link this commit") or to add future non-link actions. `kind` is the
 * agnostic seam: today only `link` (insert the node's ref); it leaves room for
 * command-style kinds later WITHOUT the core learning anything provider-specific.
 */
export interface ResourceNodeAction {
  /** Stable id, unique within the node (`link`, or a future command id). */
  id: string
  /** Menu-row label (the verb the user sees, e.g. "Link this commit"). */
  label: string
  /** Action family. `link` = insert this node's ref. Extensible; core stays agnostic. */
  kind: 'link'
}

/** A node in a provider's referenceable tree (a menu row / drag source). */
export interface ResourceNode extends AddressableResource {
  /**
   * Node-specific actions surfaced at the TOP of this node's drill level (above its
   * children). OMIT to get the default "Link this here" — declare only to relabel
   * the link or add extra actions. Provider-agnostic: see {@link ResourceNodeAction}.
   */
  actions?: ResourceNodeAction[]
}

/** One backend-owned section in the `@resource:` picker. */
export interface ResourceBrowseGroup {
  /** Stable group key. Includes the provider id so equal labels never collide. */
  id: string
  /** Provider that owns every resource in this group. */
  provider: string
  /** Human section label rendered by the client. */
  label: string
  /** Already searched and sorted resources. Clients must preserve this order. */
  resources: ResourceNode[]
}

/**
 * Versioned, backend-authoritative response for one `@resource:` drill level.
 * Clients pass the raw partial and render this result; they do not recompute
 * navigation, filtering, grouping, ordering, or caps independently.
 */
export interface ResourceBrowseResult {
  version: 1
  partial: string
  /** URI whose children are listed; null means provider roots. */
  parent: string | null
  /** Provider scope inferred from `localix://resource/<provider>`; null at the catalog root. */
  provider: string | null
  /** Trailing partial segment used for search/highlighting. */
  segment: string
  groups: ResourceBrowseGroup[]
  /** Display-only provider notices, never selectable. */
  notices: ResourceNode[]
  /** Matching selectable rows before the shared response cap. */
  total: number
  truncated: boolean
}

/** The model-facing resolution of a node URI. */
export interface ResourceExpansion {
  ok: boolean
  /** Model-facing text (DDL, listing…) when ok. */
  content?: string
  /** Fence language hint (e.g. `sql`). */
  language?: string
  /** Why resolution failed (unknown provider, not found, not connected…). */
  error?: string
}

/** Request scope for resources whose visibility belongs to one live chat. */
export interface ResourceRefScope {
  sessionId?: string
}

export interface ResourceRefProvider {
  /** Provider dispatch id, e.g. `db`. */
  provider: string
  /** Human label for the top of the `@`-menu drill-down ("Databases"). */
  title: string
  /**
   * List children of a node. `parentUri === null` = the provider's ROOTS
   * (e.g. the user's connections). Always scoped to `userId` for ownership.
   *
   * `query` is the partial segment the user is typing. OPTIONAL on both sides: the menu already
   * filters the returned nodes client-side, so a provider that ignores it behaves exactly as
   * before. A provider whose listing is CAPPED must honour it — otherwise typing can only ever
   * narrow the capped page, and the entries the cap dropped are unreachable no matter what is
   * typed. (A provider may cap a large remote catalog to a bounded first page.)
   */
  listChildren(
    userId: string,
    parentUri: string | null,
    query?: string,
    scope?: ResourceRefScope,
  ): Promise<ResourceNode[]>
  /** Resolve a node URI → model-facing expansion text. */
  expand(userId: string, uri: string, scope?: ResourceRefScope): Promise<ResourceExpansion>
}

export interface ResourceProviderRegistry {
  /** Register a provider. A DUPLICATE provider is rejected and the FIRST registration wins
   *  — the rule its sibling registries already enforce (context-fabric's `tryRegister`,
   *  ws-frame's by-construction reject, search-provider's). This used to overwrite, so a
   *  plugin claiming `git` silently shadowed the core provider registered at boot.
   *  Returns false when the provider was already taken by someone else. */
  register(provider: ResourceRefProvider): boolean
  /** Remove a provider — hot plugin disable. Pass the provider object you registered, not a bare
   *  provider id: with an id alone a disable removed whatever currently sits under it, which
   *  on a collision is somebody else's live provider — including CORE's, which nothing
   *  re-registers. Unknown/foreign entries are a no-op. */
  unregister(provider: ResourceRefProvider | string): void
  get(provider: string): ResourceRefProvider | undefined
  list(): ResourceRefProvider[]
  /**
   * Children of `parentUri`. `null` = the ROOTS across ALL providers (the top
   * level of the `@`-menu); otherwise dispatched by the parent URI's provider.
   */
  listChildren(
    userId: string,
    parentUri: string | null,
    query?: string,
    scope?: ResourceRefScope,
  ): Promise<ResourceNode[]>
  /** Canonical picker contract: navigation + search + grouping + sorting happen here. */
  browse(userId: string, partial: string, scope?: ResourceRefScope): Promise<ResourceBrowseResult>
  /** Resolve a node URI to model-facing text, dispatched by provider. */
  expand(userId: string, uri: string, scope?: ResourceRefScope): Promise<ResourceExpansion>
}

/** Host policy for plugin-owned resource calls. All fields are optional so the
 *  zero-argument registry API remains source- and runtime-compatible. */
export interface ResourceProviderRegistryOptions {
  /** Wall-clock deadline for one provider list/expand call. */
  timeoutMs?: number
  /** Maximum raw rows inspected from one provider response. */
  maxNodesPerProvider?: number
  /** Maximum UTF-8 bytes returned as model-facing expansion content. */
  maxExpansionBytes?: number
  /**
   * Injectable deadline primitive for deterministic tests/embedders. Production
   * callers should leave this unset and use the SDK's timer-owning `withTimeout`.
   */
  withDeadline?: <T>(promise: Promise<T>, timeoutMs: number, label: string) => Promise<T>
}
