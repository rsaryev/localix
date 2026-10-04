import { localixUriNamespace, type AddressableResource } from '../resource'
import { inertLine } from '../terminal-text'
import { utf8ByteLength } from '../utf8'
import { buildResourceUri, parseResourceUri, resourceNav } from './resource-uri'
import { withTimeout } from './timeout'

export {
  buildResourceUri,
  decodeResourceSegment,
  encodeResourceSegment,
  parseResourceUri,
  resourceDrillPartial,
  resourceNav,
  resourceParentPartial,
  providerSegments,
} from './resource-uri'
export type { ParsedResourceUri, ResourceNavTarget } from './resource-uri'

/**
 * RESOURCE-REF PROVIDER REGISTRY — the agnostic seam behind the single `resource`
 * context-ref kind (`features/chat/context-ref-kinds.ts`). A provider owns a URI
 * namespace (e.g. `db`) and exposes a hierarchical tree the composer `@`-menu / drag
 * drills into (`listChildren`) plus a node→model-facing-text resolver (`expand`).
 *
 * The core learns nothing about a provider's domain: the single `resource` expander in
 * `projects/expand-refs.ts` dispatches by provider to the matching provider, and the
 * one `GET /rpc/resource-refs` route lists children via this registry. Registering
 * ONE provider adds a whole new referenceable resource tree — no core edits.
 *
 * Lives in the plugin SDK so it stays free of host `features/*` value-imports; concrete
 * providers live in their own plugins/features and are injected at bootstrap.
 *
 * Pure of IO — the registry is a lookup table; providers do the work.
 */

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

/** One response cap for every client. Menus may window visually, never discard differently. */
export const RESOURCE_BROWSE_LIMIT = 50
/** A provider is an untrusted plugin boundary: never inspect an unbounded row array. */
export const RESOURCE_PROVIDER_NODE_LIMIT = 1_000
/** Interactive browse and explicit expansion must not wait forever on a plugin. */
export const RESOURCE_PROVIDER_TIMEOUT_MS = 5_000
/** Direct `@resource:` expansion can bypass Context Fabric's per-provider budget. */
export const RESOURCE_EXPANSION_MAX_BYTES = 64 * 1024

const RESOURCE_URI_MAX_CHARS = 4 * 1024
const RESOURCE_TITLE_MAX_CHARS = 256
const RESOURCE_LABEL_MAX_CHARS = 512
const RESOURCE_DETAIL_MAX_CHARS = 2_000
const RESOURCE_ACTION_LIMIT = 16
const RESOURCE_ERROR_MAX_CHARS = 1_024
const EXPANSION_TRUNCATION_MARKER = '\n[resource expansion truncated]'

const fold = (value: string): string => value.trim().toLocaleLowerCase()

// Provider labels are provider-CONTROLLED text. Normalize presentation fields once at the
// server boundary (see `inertLine`) so every client sees the same inert, single-line
// contract instead of each having to be trusted to sanitize.
const cleanPresentationText = (value: string, maxChars = RESOURCE_LABEL_MAX_CHARS): string =>
  inertLine(value, maxChars)

const providerTitle = (provider: ResourceRefProvider): string =>
  cleanPresentationText(provider.title, RESOURCE_TITLE_MAX_CHARS)

// Resource tokens are whitespace-delimited. Providers must percent-encode path
// segments rather than mint an identity that the parser will silently truncate.
// oxlint-disable-next-line no-control-regex -- rejects C0/C1 token injection
const TOKEN_SAFE_URI = /^[^\s\x00-\x1f\x7f-\x9f]+$/
const PRESENTATION_TOKEN = /^[a-z0-9][a-z0-9._:-]{0,63}$/i

const normalizeProviderNodes = (
  provider: ResourceRefProvider,
  value: unknown,
  limit: number,
): ResourceNode[] => {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const nodes: ResourceNode[] = []
  // Bound work before touching plugin-owned fields. The browse response is capped
  // again later, but doing that only after normalization still lets one provider
  // force arbitrarily many copies, regex passes and sort entries.
  for (let index = 0; index < Math.min(value.length, limit); index += 1) {
    const candidate: unknown = value[index]
    if (!candidate || typeof candidate !== 'object') continue
    const node = candidate as ResourceNode
    // A provider may only mint identities in the provider it registered. This keeps
    // a broken/plugin-contributed tree from smuggling another provider's address
    // into the picker and preserves one owner for browse + expansion.
    if (
      typeof node.uri !== 'string' ||
      node.uri.length > RESOURCE_URI_MAX_CHARS ||
      !TOKEN_SAFE_URI.test(node.uri) ||
      localixUriNamespace(node.uri) !== provider.provider
    )
      continue
    if (seen.has(node.uri)) continue
    seen.add(node.uri)
    const label =
      typeof node.label === 'string'
        ? cleanPresentationText(node.label, RESOURCE_LABEL_MAX_CHARS)
        : ''
    if (!label || typeof node.hasChildren !== 'boolean') continue
    const detail =
      typeof node.detail === 'string'
        ? cleanPresentationText(node.detail, RESOURCE_DETAIL_MAX_CHARS) || undefined
        : undefined
    const group =
      typeof node.group === 'string'
        ? cleanPresentationText(node.group, RESOURCE_TITLE_MAX_CHARS) || undefined
        : undefined
    const actionIds = new Set<string>()
    const actions: ResourceNodeAction[] = []
    if (Array.isArray(node.actions)) {
      for (const action of node.actions.slice(0, RESOURCE_ACTION_LIMIT)) {
        if (
          action?.kind !== 'link' ||
          typeof action.id !== 'string' ||
          !PRESENTATION_TOKEN.test(action.id) ||
          actionIds.has(action.id) ||
          typeof action.label !== 'string'
        )
          continue
        const actionLabel = cleanPresentationText(action.label, RESOURCE_LABEL_MAX_CHARS)
        if (!actionLabel) continue
        actionIds.add(action.id)
        actions.push({ id: action.id, label: actionLabel, kind: 'link' })
      }
    }
    const icon =
      typeof node.icon === 'string' && PRESENTATION_TOKEN.test(node.icon) ? node.icon : undefined
    // Rebuild from the public contract instead of spreading a plugin-owned object.
    // Besides making runtime output match the TypeScript shape, this prevents an
    // accidental provider-only field (credentials, raw response metadata, etc.)
    // from crossing the shared browse boundary.
    const normalized: ResourceNode = {
      uri: node.uri,
      label,
      hasChildren: node.hasChildren,
      ...(detail ? { detail } : {}),
      ...(group ? { group } : {}),
      ...(actions.length ? { actions } : {}),
      ...(icon ? { icon } : {}),
      ...(node.notice === true ? { notice: true } : {}),
      ...(node.navigationOnly === true ? { navigationOnly: true } : {}),
    }
    nodes.push(normalized)
  }
  return nodes
}

function positiveInteger(value: number | undefined, fallback: number, label: string): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`)
  }
  return resolved
}

/** Keep a string within a byte contract without cutting through a UTF-16 pair.
 *  Binary search only materializes prefixes no larger than the configured cap. */
function truncateUtf8(value: string, maxBytes: number): string {
  if (utf8ByteLength(value) <= maxBytes) return value
  const markerBytes = utf8ByteLength(EXPANSION_TRUNCATION_MARKER)
  if (markerBytes > maxBytes) return EXPANSION_TRUNCATION_MARKER.slice(0, maxBytes)
  const prefixBudget = Math.max(0, maxBytes - markerBytes)
  let low = 0
  let high = Math.min(value.length, prefixBudget)
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (utf8ByteLength(value.slice(0, middle)) <= prefixBudget) low = middle
    else high = middle - 1
  }
  if (low > 0 && /[\uD800-\uDBFF]/.test(value.charAt(low - 1))) low -= 1
  return `${value.slice(0, low)}${EXPANSION_TRUNCATION_MARKER}`
}

function normalizeProviderExpansion(value: unknown, maxBytes: number): ResourceExpansion {
  if (!value || typeof value !== 'object') {
    return { ok: false, error: 'resource provider returned an invalid expansion' }
  }
  const expansion = value as ResourceExpansion
  if (expansion.ok) {
    const content =
      typeof expansion.content === 'string' ? truncateUtf8(expansion.content, maxBytes) : undefined
    const language =
      typeof expansion.language === 'string' && PRESENTATION_TOKEN.test(expansion.language)
        ? expansion.language
        : undefined
    return {
      ok: true,
      ...(content !== undefined ? { content } : {}),
      ...(language ? { language } : {}),
    }
  }
  const error =
    typeof expansion.error === 'string'
      ? cleanPresentationText(expansion.error, RESOURCE_ERROR_MAX_CHARS)
      : ''
  return { ok: false, error: error || 'resource unavailable' }
}

const compareText = (a: string, b: string): number =>
  a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' })

const compareNodes = (a: ResourceNode, b: ResourceNode): number =>
  compareText(a.label, b.label) ||
  compareText(a.detail ?? '', b.detail ?? '') ||
  compareText(a.uri, b.uri)

const matchesBrowseQuery = (
  node: ResourceNode,
  query: string,
  provider: string,
  group: string,
): boolean => {
  if (!query) return true
  const identity = parseResourceUri(node.uri)?.rest ?? ''
  return fold(`${node.label}\n${node.detail ?? ''}\n${identity}\n${provider}\n${group}`).includes(
    query,
  )
}

/** Flatten groups for list-shaped clients while retaining the server-owned group label. */
export function flattenResourceBrowse(result: ResourceBrowseResult): ResourceNode[] {
  return result.groups.flatMap((group) =>
    group.resources.map((resource) => {
      // Provider section headers belong at root levels. A provider may still
      // explicitly group a drilled child level via the node's own `group`.
      const includeGroup =
        !resource.navigationOnly &&
        Boolean(resource.group || (result.parent === null && result.provider === null))
      return {
        ...resource,
        ...(includeGroup ? { group: resource.group ?? group.label } : {}),
      }
    }),
  )
}

/** Sugar for the single-link `actions` declaration every provider writes:
 *  a nicer verb for the container's "Link this …" row. */
export function linkAction(label: string): ResourceNodeAction[] {
  return [{ id: 'link', label, kind: 'link' }]
}

/**
 * A non-interactive NOTICE row for a listing that dropped items (a cap, a failed
 * read): the menu renders it as a plain hint — never linkable, never drillable —
 * so truncation is stated in-band instead of silently. `uri` is the PARENT's uri
 * (a notice needs a stable key, not an addressable target).
 */
export function noticeNode(parentUri: string, label: string, detail?: string): ResourceNode {
  return { uri: `${parentUri}#notice`, label, detail, hasChildren: false, notice: true }
}

/** The standard "Showing N of M — type to search" truncation notice. */
export function truncationNotice(
  parentUri: string,
  shown: number,
  total: number,
  what: string,
  query?: string,
): ResourceNode {
  return noticeNode(
    parentUri,
    `Showing ${shown} of ${total}${query ? ` matching "${query}"` : ''} ${what}`,
    'type to search the full list',
  )
}

/** Shared transport-failure row for client adapters. Provider failures already
 * arrive in `ResourceBrowseResult.notices`; this covers the route itself being
 * unreachable during backend restart/reconnect without pretending the level is
 * genuinely empty. */
export function resourceBrowseFailureNotice(partial: string): ResourceNode {
  const nav = resourceNav(partial.trim())
  const owner =
    nav.parent ??
    (nav.provider ? buildResourceUri(nav.provider) : buildResourceUri('system', ['browser']))
  return noticeNode(owner, 'Resource browser unavailable', 'Check the connection and try again')
}

export function createResourceProviderRegistry(
  options: ResourceProviderRegistryOptions = {},
): ResourceProviderRegistry {
  const byProvider = new Map<string, ResourceRefProvider>()
  const timeoutMs = positiveInteger(
    options.timeoutMs,
    RESOURCE_PROVIDER_TIMEOUT_MS,
    'resource provider timeoutMs',
  )
  const maxNodesPerProvider = positiveInteger(
    options.maxNodesPerProvider,
    RESOURCE_PROVIDER_NODE_LIMIT,
    'resource provider maxNodesPerProvider',
  )
  const maxExpansionBytes = positiveInteger(
    options.maxExpansionBytes,
    RESOURCE_EXPANSION_MAX_BYTES,
    'resource provider maxExpansionBytes',
  )
  const waitFor = options.withDeadline ?? withTimeout

  const listProviderChildren = (
    provider: ResourceRefProvider,
    userId: string,
    parentUri: string | null,
    query?: string,
    scope?: ResourceRefScope,
  ): Promise<unknown> =>
    waitFor(
      Promise.resolve().then(() => provider.listChildren(userId, parentUri, query, scope)),
      timeoutMs,
      `resource provider "${provider.provider}" listChildren`,
    )

  const expandProvider = (
    provider: ResourceRefProvider,
    userId: string,
    uri: string,
    scope?: ResourceRefScope,
  ): Promise<unknown> =>
    waitFor(
      Promise.resolve().then(() => provider.expand(userId, uri, scope)),
      timeoutMs,
      `resource provider "${provider.provider}" expand`,
    )

  /** One provider's failure must never break the whole `@`-menu — swallow to []
   *  but WARN with the provider so the failure is diagnosable, not invisible. */
  const warnListFailure = (provider: string, err: unknown): ResourceNode[] => {
    console.warn(`[resource-refs] provider "${provider}" listChildren failed:`, err)
    return []
  }

  const providerFailureNotice = (provider: ResourceRefProvider): ResourceNode =>
    noticeNode(
      buildResourceUri(provider.provider),
      `${providerTitle(provider)} unavailable`,
      'Could not load this resource group',
    )

  return {
    register(provider) {
      // Provider ids are exact registry keys. Require canonical lowercase grammar so
      // `DB` cannot become an unreachable/shadow namespace and malformed ids never enter a token.
      let canonicalProvider = false
      try {
        canonicalProvider =
          localixUriNamespace(buildResourceUri(provider.provider)) === provider.provider
      } catch {
        canonicalProvider = false
      }
      if (!canonicalProvider) {
        console.warn(
          `[resource-refs] invalid provider id "${provider.provider}" — expected a canonical lowercase resource provider`,
        )
        return false
      }
      if (!providerTitle(provider)) {
        console.warn(`[resource-refs] provider "${provider.provider}" has an empty title`)
        return false
      }
      const existing = byProvider.get(provider.provider)
      // Same object re-registered — idempotent, not a collision.
      if (existing === provider) return true
      if (existing) {
        console.warn(
          `[resource-refs] duplicate resource provider "${provider.provider}" — keeping the first; a plugin must namespace its provider id`,
        )
        return false
      }
      byProvider.set(provider.provider, provider)
      return true
    },
    unregister(provider) {
      const providerId = typeof provider === 'string' ? provider : provider.provider
      const live = byProvider.get(providerId)
      if (!live) return
      // Identity-checked: a plugin's disable must not evict a provider it never owned.
      if (typeof provider !== 'string' && live !== provider) return
      byProvider.delete(providerId)
    },
    get(provider) {
      return byProvider.get(provider)
    },
    list() {
      return [...byProvider.values()]
    },
    async listChildren(userId, parentUri, query, scope) {
      if (parentUri === null) {
        // ROOTS: concat every provider's roots (menu top level), tagging each with its
        // provider's title as a `group` so the composer menu can render section headers
        // ("Databases", "Repositories", …). Providers' roots stay contiguous (registration
        // order), so the menu groups by a simple change-of-group scan.
        const providers = [...byProvider.values()]
        const groups = await Promise.all(
          providers.map((p) =>
            listProviderChildren(p, userId, null, query, scope).catch((err) =>
              warnListFailure(p.provider, err),
            ),
          ),
        )
        return groups.flatMap((nodes, i) =>
          normalizeProviderNodes(providers[i], nodes, maxNodesPerProvider).map((n) => ({
            ...n,
            group: n.group ?? providerTitle(providers[i]),
          })),
        )
      }
      const parsed = parseResourceUri(parentUri)
      const provider = parsed ? byProvider.get(parsed.provider) : undefined
      if (!provider) return []
      // Same isolation at drill level — a throwing provider (dead DB connection,
      // missing git binary) must yield an empty listing, not a route 500.
      try {
        return normalizeProviderNodes(
          provider,
          await listProviderChildren(provider, userId, parentUri, query, scope),
          maxNodesPerProvider,
        )
      } catch (err) {
        return warnListFailure(provider.provider, err)
      }
    },
    async browse(userId, partial, scope) {
      const normalizedPartial = partial.trim()
      const { parent, segment, provider: providerScope } = resourceNav(normalizedPartial)
      const query = fold(segment)
      const notices: ResourceNode[] = []
      const collected: Array<{
        provider: string
        group: string
        node: ResourceNode
      }> = []

      // The global root is a lightweight category index. It does not eagerly list
      // every provider (or mix all of their roots into one long menu); selecting a
      // category scopes the next request to `localix://resource/<provider>`.
      if (parent === null && providerScope === null) {
        const categories = [...byProvider.values()]
          .filter(
            (provider) =>
              !query || fold(`${providerTitle(provider)}\n${provider.provider}`).includes(query),
          )
          .sort(
            (a, b) =>
              compareText(providerTitle(a), providerTitle(b)) ||
              compareText(a.provider, b.provider),
          )
        const total = categories.length
        const kept = categories.slice(0, RESOURCE_BROWSE_LIMIT)
        if (total > kept.length) {
          notices.push(
            noticeNode(
              buildResourceUri('system', ['groups']),
              `Showing ${kept.length} of ${total} matching resource groups`,
              'type to search the full list',
            ),
          )
        }
        return {
          version: 1,
          partial: normalizedPartial,
          parent,
          provider: providerScope,
          segment,
          groups: kept.map((provider) => ({
            id: `category:${provider.provider}`,
            provider: provider.provider,
            label: providerTitle(provider),
            resources: [
              {
                uri: buildResourceUri(provider.provider),
                label: providerTitle(provider),
                hasChildren: true,
                icon: provider.provider,
                navigationOnly: true,
              },
            ],
          })),
          notices,
          total,
          truncated: total > kept.length,
        }
      }

      if (parent === null) {
        const providers = [...byProvider.values()].filter(
          (provider) => providerScope === null || provider.provider === providerScope,
        )
        const listings = await Promise.all(
          providers.map(async (provider) => {
            // Once a provider root is selected, the segment is a RESOURCE search. The
            // category itself was already selected, so matching the provider title
            // must not turn `localix://resource/catalog/catalog` into an unfiltered root listing.
            const providerQuery = segment.trim() || undefined
            try {
              const nodes = normalizeProviderNodes(
                provider,
                await listProviderChildren(provider, userId, null, providerQuery, scope),
                maxNodesPerProvider,
              )
              return { provider, nodes, failed: false }
            } catch (err) {
              warnListFailure(provider.provider, err)
              return { provider, nodes: [], failed: true }
            }
          }),
        )
        for (const { provider, nodes, failed } of listings) {
          if (failed) notices.push(providerFailureNotice(provider))
          for (const node of nodes) {
            if (node.notice) {
              notices.push(node)
              continue
            }
            const group = node.group || providerTitle(provider)
            if (matchesBrowseQuery(node, query, provider.provider, group)) {
              collected.push({ provider: provider.provider, group, node })
            }
          }
        }
      } else {
        const parsed = parseResourceUri(parent)
        const provider = parsed ? byProvider.get(parsed.provider) : undefined
        if (provider) {
          let nodes: ResourceNode[] = []
          try {
            nodes = normalizeProviderNodes(
              provider,
              await listProviderChildren(
                provider,
                userId,
                parent,
                segment.trim() || undefined,
                scope,
              ),
              maxNodesPerProvider,
            )
          } catch (err) {
            warnListFailure(provider.provider, err)
            notices.push(providerFailureNotice(provider))
          }
          for (const node of nodes) {
            if (node.notice) {
              notices.push(node)
              continue
            }
            const group = node.group || providerTitle(provider)
            if (matchesBrowseQuery(node, query, provider.provider, group)) {
              collected.push({ provider: provider.provider, group, node })
            }
          }
        }
      }

      const ordered = collected.sort(
        (a, b) =>
          compareText(a.group, b.group) ||
          compareText(a.provider, b.provider) ||
          compareNodes(a.node, b.node),
      )
      const seenUris = new Set<string>()
      const unique = ordered.filter(({ node }) => {
        if (seenUris.has(node.uri)) return false
        seenUris.add(node.uri)
        return true
      })
      const total = unique.length
      const kept = unique.slice(0, RESOURCE_BROWSE_LIMIT)
      if (total > kept.length) {
        notices.push(
          noticeNode(
            parent ??
              buildResourceUri(providerScope ?? 'system', providerScope ? [] : ['resources']),
            `Showing ${kept.length} of ${total} matching resources`,
            'type to search the full list',
          ),
        )
      }
      const grouped = new Map<string, ResourceBrowseGroup>()
      for (const entry of kept) {
        const id = `${entry.provider}:${fold(entry.group)}`
        const group = grouped.get(id) ?? {
          id,
          provider: entry.provider,
          label: entry.group,
          resources: [],
        }
        group.resources.push(entry.node)
        grouped.set(id, group)
      }

      return {
        version: 1,
        partial: normalizedPartial,
        parent,
        provider: providerScope,
        segment,
        groups: [...grouped.values()],
        notices: notices.sort(compareNodes),
        total,
        truncated: total > kept.length,
      }
    },
    async expand(userId, uri, scope) {
      const parsed = parseResourceUri(uri)
      if (!parsed || uri.length > RESOURCE_URI_MAX_CHARS) {
        const safeUri = cleanPresentationText(uri, RESOURCE_LABEL_MAX_CHARS)
        return { ok: false, error: `not a resource URI: ${safeUri}` }
      }
      const provider = byProvider.get(parsed.provider)
      if (!provider)
        return { ok: false, error: `no resource provider for provider "${parsed.provider}"` }
      try {
        return normalizeProviderExpansion(
          await expandProvider(provider, userId, uri, scope),
          maxExpansionBytes,
        )
      } catch (err) {
        console.warn(`[resource-refs] provider "${provider.provider}" expand failed:`, err)
        return { ok: false, error: `${providerTitle(provider)} unavailable` }
      }
    },
  }
}
