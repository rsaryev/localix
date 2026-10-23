import { localixUriNamespace } from '../resource'
import { buildResourceUri, parseResourceUri } from './resource-uri'
import { withTimeout } from './timeout'
import { createResourceBrowser } from './resource-ref-browse'
import type {
  ResourceNode,
  ResourceProviderRegistry,
  ResourceProviderRegistryOptions,
  ResourceRefProvider,
  ResourceRefScope,
} from './resource-ref-contracts'
import {
  cleanPresentationText,
  normalizeProviderExpansion,
  normalizeProviderNodes,
  positiveInteger,
  providerTitle,
  RESOURCE_EXPANSION_MAX_BYTES,
  RESOURCE_LABEL_MAX_CHARS,
  RESOURCE_PROVIDER_NODE_LIMIT,
  RESOURCE_PROVIDER_TIMEOUT_MS,
  RESOURCE_URI_MAX_CHARS,
} from './resource-ref-normalize'

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

export type {
  ResourceNodeAction,
  ResourceNode,
  ResourceBrowseGroup,
  ResourceBrowseResult,
  ResourceExpansion,
  ResourceRefScope,
  ResourceRefProvider,
  ResourceProviderRegistry,
  ResourceProviderRegistryOptions,
} from './resource-ref-contracts'
export {
  RESOURCE_BROWSE_LIMIT,
  RESOURCE_PROVIDER_NODE_LIMIT,
  RESOURCE_PROVIDER_TIMEOUT_MS,
  RESOURCE_EXPANSION_MAX_BYTES,
} from './resource-ref-normalize'
export {
  flattenResourceBrowse,
  linkAction,
  noticeNode,
  truncationNotice,
  resourceBrowseFailureNotice,
} from './resource-ref-presentation'

/**
 * RESOURCE-REF PROVIDER REGISTRY — the agnostic seam behind the single `resource`
 * context-ref kind (`contracts/context-ref-kinds.ts`). A provider owns a URI
 * namespace (e.g. `db`) and exposes a hierarchical tree the composer `@`-menu / drag
 * drills into (`listChildren`) plus a node→model-facing-text resolver (`expand`).
 *
 * The core learns nothing about a provider's domain: the single `resource` expander in
 * `projects/expand-refs.ts` dispatches by provider to the matching provider, and the
 * one `GET /rpc/resource-refs` route lists children via this registry. Registering
 * ONE provider adds a whole new referenceable resource tree — no core edits.
 *
 * Lives in the mini app SDK so it stays free of host `features/*` value-imports; concrete
 * providers live in their own mini apps/features and are injected at bootstrap.
 *
 * Pure of IO — the registry is a lookup table; providers do the work.
 */

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
          `[resource-refs] duplicate resource provider "${provider.provider}" — keeping the first; a mini app must namespace its provider id`,
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
      // Identity-checked: a mini app's disable must not evict a provider it never owned.
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
    browse: createResourceBrowser({
      byProvider,
      listProviderChildren,
      maxNodesPerProvider,
      warnListFailure,
    }),
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
