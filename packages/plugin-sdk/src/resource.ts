import { parseLocalixUri } from './navigation'

/**
 * Stable identity + presentation shared by backend resource trees and UI-only
 * anchors. Capabilities (bind, expand, open) live in separate registries and all
 * key off this one opaque URI.
 */
export interface AddressableResource {
  uri: string
  label: string
  detail?: string
  hasChildren: boolean
  icon?: string
  group?: string
  notice?: boolean
  /** Picker-only folder used to navigate into a resource provider/category.
   * It has an address-shaped URI but must never be linked or expanded itself. */
  navigationOnly?: boolean
}

export interface ParsedLocalixResourceUri {
  provider: string
  /** Encoded identity segments after the provider breadcrumb. */
  segments: string[]
  query: URLSearchParams
}

/** Strictly parse one canonical provider-owned resource identity. */
export function parseLocalixResourceUri(uri: string): ParsedLocalixResourceUri | null {
  const canonical = parseLocalixUri(uri)
  if (canonical?.primitive !== 'resource') return null
  try {
    const parsed = new URL(uri)
    const path = parsed.pathname.split('/').filter(Boolean)
    const encodedProvider = path.shift()
    if (!encodedProvider) return null
    // The provider rule has ONE owner: `parseLocalixUri` already tested this breadcrumb
    // against it and returned null otherwise. A second copy lived here and had DRIFTED —
    // case-insensitive (`/i`) plus a `.toLowerCase()` normalization — which read as "an
    // uppercase provider is accepted and folded". It is not: the owning regex is
    // case-sensitive, so `localix://resource/DB/x` never reaches this line. Two spellings of
    // one rule, one of them unreachable, is worse than no second check at all.
    const provider = canonical.breadcrumbs[0]!
    return { provider, segments: path, query: canonical.query }
  } catch {
    return null
  }
}

/**
 * Extract the first breadcrumb after a Localix primitive authority.
 *
 * Examples: `localix://resource/catalog/...` → `catalog`,
 * `localix://ui/settings/...` → `settings`. Registries keep dispatching on
 * provider/surface keys without any owner monopolising the `localix` scheme.
 */
export function localixUriNamespace(uri: string): string | null {
  const parsed = parseLocalixUri(uri)
  const owner = parsed?.breadcrumbs[0]
  return owner && /^[a-z][a-z0-9._-]{0,63}$/i.test(owner) ? owner.toLowerCase() : null
}
