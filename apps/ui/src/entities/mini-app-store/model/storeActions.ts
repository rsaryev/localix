import type {
  MiniAppCatalogEntryRecord,
  MiniAppCatalogPreviewRecord,
  MiniAppStoreEntryRecord,
  MiniAppStorePageRecord,
} from '@localixai/api/client'

/** What the store can do to the apps it lists. */
export interface StoreActions {
  onInstall: (name: string, opts?: { acceptUnverified?: boolean }) => void
  onRemove: (name: string) => void
}

/** The catalogs the store reads, and what can be done to them. */
export interface StoreCatalogs {
  list: MiniAppCatalogEntryRecord[]
  /** Read a catalog before it is added; rejects with why it is not one. */
  preview: (url: string) => Promise<MiniAppCatalogPreviewRecord>
  add: (url: string) => Promise<void>
  remove: (url: string) => Promise<void>
}

/**
 * A mini app's desktop app (its own Mac app), as the store offers it. Handed in by the page that
 * shows the store, which reads it from the port the standalone-app feature provides; absent where
 * no desktop app can be made.
 */
export interface StoreDesktopApps {
  available: (entry: MiniAppStoreEntryRecord) => boolean
  has: (name: string) => boolean
  /** Rejects with what went wrong. */
  install: (name: string, title: string) => Promise<void>
  remove: (name: string) => Promise<void>
}

export type LoadStorePage = (name: string) => Promise<MiniAppStorePageRecord>
