import type { IconComponent, MiniAppOwnedContribution } from './contrib'

/**
 * Search-domain contribution contracts — a subsystem contributes its own search
 * behaviour (scope metadata + result icons) instead of the host hardcoding it.
 */

/**
 * The scope-picker atom a subsystem contributes (a "filter atom"). Its
 * `id` is the contribution's `id` (the backend provider id); the host's search slice
 * maps this into its own scope definition so core scope grammar never names an
 * individual domain.
 */
export interface SearchDomainScope {
  /** Chip + dropdown label. */
  label: string
  /** Typed prefix (without the colon) that promotes into this scope. */
  prefix: string
  /** Extra prefixes that also select it. */
  aliases?: string[]
  /** Glyph key (mapped to an icon by the surface). */
  icon: string
  /** Placeholder shown when the scope is active. */
  placeholder?: string
  /** Heavy domain that only runs when explicitly scoped. */
  lazy?: boolean
}

export interface SearchDomainContribution extends MiniAppOwnedContribution {
  /** Backend search-provider id (matches the scope id). */
  id: string
  /** The scope-picker atom this domain adds (label / prefix / aliases / placeholder). */
  scope?: SearchDomainScope
  /** Extra glyph-key → icon entries this domain adds to the search icon vocabulary. */
  icons?: Record<string, IconComponent>
}
