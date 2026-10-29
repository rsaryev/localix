import type {
  IconComponent,
  SearchDomainContribution,
  SearchDomainScope,
} from '@localixai/mini-app-sdk/ui'
import { isMiniAppContributionEnabled } from './miniAppActivation'

/**
 * OPEN search-domain registry — a feature or a mini app contributes its own search
 * behaviour (scope metadata + result icons) here instead of
 * core search hardcoding it. Mirrors `uiContrib`: each feature registers from its
 * `contrib.{ts,tsx}` (discovered generically — see `shared/contrib/discover.ts`),
 * so CORE search names no individual subsystem.
 *
 * The contribution CONTRACTS are OWNED by `@localixai/mini-app-sdk/ui`; this module
 * implements the registry and re-exports the types so internal import sites stay
 * unchanged.
 *
 * Scope METADATA (label / prefix / aliases / placeholder) still lives in the search
 * slice's `scopes.ts` because its pure grammar is pinned by unit tests; this registry
 * owns only the two genuinely subsystem-specific bits — the result glyphs and the
 * hit → open-work-item mapping.
 */
export type { SearchDomainContribution, SearchDomainScope } from '@localixai/mini-app-sdk/ui'

const registry = new Map<string, SearchDomainContribution>()

/** Register one globally-owned search domain. Duplicate ids keep their first owner. */
export function registerSearchDomain(contribution: SearchDomainContribution): void {
  const existing = registry.get(contribution.id)
  if (existing === contribution) return
  if (existing) {
    console.warn(
      `[search-domains] duplicate domain id "${contribution.id}" — keeping the first owner`,
    )
    return
  }
  registry.set(contribution.id, contribution)
}

/** Remove a contribution only when the caller still owns the registered entry. */
export function unregisterSearchDomain(contribution: SearchDomainContribution): void {
  if (registry.get(contribution.id) === contribution) registry.delete(contribution.id)
}

/** Drop every domain `owner` registered (a mini app reload or unload). */
export function removeSearchDomainsOf(owner: string): void {
  for (const [id, domain] of registry) if (domain.miniAppName === owner) registry.delete(id)
}

/** All registered domains, in insertion order. */
export function searchDomains(): SearchDomainContribution[] {
  return Array.from(registry.values()).filter((domain) =>
    isMiniAppContributionEnabled(domain.miniAppName),
  )
}

/** The contributed scope atoms (id + scope), in registration order. */
export function searchDomainScopes(): Array<{ id: string; scope: SearchDomainScope }> {
  const out: Array<{ id: string; scope: SearchDomainScope }> = []
  for (const domain of registry.values()) {
    if (!isMiniAppContributionEnabled(domain.miniAppName)) continue
    if (domain.scope) out.push({ id: domain.id, scope: domain.scope })
  }
  return out
}

/** Resolve a contributed glyph key → its icon (first domain that declares it). */
export function searchDomainIcon(key: string): IconComponent | undefined {
  for (const domain of registry.values()) {
    if (!isMiniAppContributionEnabled(domain.miniAppName)) continue
    const icon = domain.icons?.[key]
    if (icon) return icon
  }
  return undefined
}
