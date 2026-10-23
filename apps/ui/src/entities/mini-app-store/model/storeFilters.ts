import type { MiniAppCatalogEntryRecord, MiniAppStoreEntryRecord } from '@localixai/api/client'
import { API_BASE_URL } from '@/shared/api/internal'

/** What narrows the store: a category tab, one tag, one catalog and the search. */
export interface StoreFilter {
  /** A category id, or {@link ALL}. */
  category: string
  tag: string | null
  /** A catalog's address, or null for every catalog. */
  source: string | null
  query: string
}

export const ALL = 'all'
export const NO_FILTER: StoreFilter = { category: ALL, tag: null, source: null, query: '' }

/** The words a search matches: name, display name, description, publisher and tags. */
const haystack = (entry: MiniAppStoreEntryRecord) =>
  [entry.name, entry.displayName, entry.description, entry.publisher.name, ...(entry.tags ?? [])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

export function filterEntries(
  entries: readonly MiniAppStoreEntryRecord[],
  filter: StoreFilter,
): MiniAppStoreEntryRecord[] {
  const needle = filter.query.trim().toLowerCase()
  return entries.filter(
    (entry) =>
      (filter.category === ALL || entry.category === filter.category) &&
      (!filter.tag || (entry.tags ?? []).includes(filter.tag)) &&
      (!filter.source || entry.source === filter.source) &&
      (!needle || haystack(entry).includes(needle)),
  )
}

export const isBusy = (entry: MiniAppStoreEntryRecord) =>
  ['queued', 'downloading', 'installing'].includes(entry.job?.phase ?? '')

/** Which group an app is in: one that wants an update, one already here, or one to add. */
export function groupOf(entry: MiniAppStoreEntryRecord): 'updates' | 'installed' | 'available' {
  if (entry.update && !entry.incompatible) return 'updates'
  if (entry.installed && !isBusy(entry)) return 'installed'
  return 'available'
}

/** A catalog by where it lives: Localix's own, its host, or a folder on this computer. */
export function catalogLabel(catalog: Pick<MiniAppCatalogEntryRecord, 'url' | 'builtIn'>): string {
  if (catalog.builtIn) return 'Localix'
  try {
    const url = new URL(catalog.url)
    return url.protocol === 'file:' ? 'A folder on this computer' : url.host
  } catch {
    return catalog.url
  }
}

/** How many of the apps each catalog offers, by its address. */
export function countBySource(entries: readonly MiniAppStoreEntryRecord[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const entry of entries) counts[entry.source] = (counts[entry.source] ?? 0) + 1
  return counts
}

/** A store file's address on this host; the API names it by path. */
export const storeMediaSrc = (path: string) => `${API_BASE_URL}${path}`

export const appCount = (count: number) => `${count} app${count === 1 ? '' : 's'}`
