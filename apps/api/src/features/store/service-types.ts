import type { Scope, ShelfId, StoreCategory, Trust } from '@localixai/store'

/** What narrows a page: a shelf, a search, a scope, installed or not, and the facets' filters. */
export interface ListingQuery {
  shelf?: ShelfId
  q?: string
  scope?: Scope
  installed?: boolean
  category?: StoreCategory
  source?: string
  trust?: Trust
  projectId?: string
  cursor?: string
  limit?: number
}

/** The global search service, as the Store asks it (wired in `bootstrap/`, A4). */
export type StoreSearchPort = (
  userId: string,
  request: {
    text: string
    domains: string[]
    limit: number
    cursor?: string
    projectId?: string | null
    providerOptions: unknown
  },
) => Promise<{
  hits: Array<{ id: string }>
  nextCursor?: string
  strategy: { mode: 'lexical' | 'hybrid'; reason?: string }
}>
