/**
 * Pages of Hugging Face's model list, cached: what the catalog's cards are built from.
 *
 * A BROWSE listing (a publisher's whole list, embedding repositories) is one request and changes
 * slowly: kept six hours, in memory and on disk, and served stale when Hugging Face cannot be
 * reached — a catalog offline is yesterday's list, never an empty one. A SEARCH is a person
 * typing: kept ten minutes in memory for the last few dozen queries, so going back and forth
 * between two queries asks nothing twice.
 */
import path from 'node:path'
import type { HfClient, HfModel, HfModelsQuery } from './hf-client'
import { createJsonFile } from './json-file'

const BROWSE_TTL_MS = 6 * 60 * 60_000
const SEARCH_TTL_MS = 10 * 60_000
const SEARCHES_KEPT = 50
const VERSION = 1

interface Page {
  at: number
  rows: HfModel[]
}

export function createListings(deps: {
  root: string
  hf: HfClient
  log?: (event: string, fields: Record<string, unknown>) => void
  now?: () => number
}) {
  const clock = deps.now ?? Date.now
  const file = createJsonFile<Record<string, Page>>(path.join(deps.root, 'listings.json'), VERSION)
  const browsed = new Map<string, Page>()
  const searched = new Map<string, Page>()
  const inFlight = new Map<string, Promise<HfModel[]>>()
  let restored: Promise<void> | null = null

  const restore = () =>
    (restored ??= file.read().then((data) => {
      for (const [key, page] of Object.entries(data ?? {})) browsed.set(key, page)
    }))

  /** One request per key at a time: a second reader shares the first's answer. */
  function once(key: string, load: () => Promise<HfModel[]>) {
    const running = inFlight.get(key)
    if (running) return running
    const job = load().finally(() => inFlight.delete(key))
    inFlight.set(key, job)
    return job
  }

  return {
    /** A slow-changing list (`key` names it): six hours fresh, stale rather than empty. */
    async browse(key: string, query: HfModelsQuery): Promise<HfModel[]> {
      await restore()
      const cached = browsed.get(key)
      if (cached && clock() - cached.at < BROWSE_TTL_MS) return cached.rows
      try {
        const rows = await once(`browse:${key}`, () => deps.hf.models(query))
        browsed.set(key, { at: clock(), rows })
        file.save(() => Object.fromEntries(browsed))
        return rows
      } catch (err) {
        deps.log?.('local_models.listing_unreachable', { key, error: String(err) })
        return cached?.rows ?? []
      }
    },

    /** A search page; failures read as no results (the browse list still stands). */
    async search(query: HfModelsQuery): Promise<HfModel[]> {
      const key = JSON.stringify(query)
      const cached = searched.get(key)
      if (cached && clock() - cached.at < SEARCH_TTL_MS) return cached.rows
      try {
        const rows = await once(`search:${key}`, () => deps.hf.models(query))
        searched.delete(key)
        searched.set(key, { at: clock(), rows })
        while (searched.size > SEARCHES_KEPT) searched.delete(searched.keys().next().value!)
        return rows
      } catch (err) {
        deps.log?.('local_models.search_unreachable', { error: String(err) })
        return cached?.rows ?? []
      }
    },

    flush: () => file.flush(),
  }
}

export type Listings = ReturnType<typeof createListings>
