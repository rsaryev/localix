import type { VaultItemSource, VaultItemType } from '@localixai/api/client'

/**
 * The Vault workspace's view vocabulary — the section a pane is showing and the two list
 * facets. Separate from the hook so the presentational views can name a filter value without
 * importing the workspace's whole state machine.
 */
export type VaultSection = 'items' | 'usage' | 'activity'
export type TypeFilter = 'all' | VaultItemType
export type SourceFilter = 'all' | VaultItemSource
