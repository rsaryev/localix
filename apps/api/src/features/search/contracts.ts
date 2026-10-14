import { z } from 'zod'
import type { Problem, SearchHit } from '../agent-core/search/provider'

/**
 * Request/response contracts for the ONE global-search endpoint (`POST /rpc/search`).
 * The heavy lifting (fan-out, ranking, grouping, pagination) is in the service; this
 * file just pins the wire shape shared with the UI via `@localixai/api/client`.
 */
export const searchRequestSchema = z.object({
  /** The query text — required, non-empty. */
  text: z.string().min(1),
  /** Restrict to these domain (provider) ids. Empty/omitted = all eager domains. A
   *  single id = a "scoped" query (paginated single group). */
  domains: z.array(z.string()).optional(),
  /** Aggregate view: hits per group. Scoped view: page size. */
  limit: z.coerce.number().int().min(1).max(100).optional(),
  /** Opaque offset cursor for the scoped ("show all") view. */
  cursor: z.string().optional(),
  /** Active session (drives the file provider's cwd + optional scoping). */
  sessionId: z.string().nullish(),
  /** Active project (optional scoping). */
  projectId: z.string().nullish(),
})

export type SearchRequest = z.infer<typeof searchRequestSchema>

/** One domain's slice of the results. `total` is the FULL count so the UI shows "Show all". */
export interface SearchGroup {
  domain: string
  title: string
  icon?: string
  hits: SearchHit[]
  total: number
}

export interface SearchResponse {
  /** Per-domain groups in registry order, each capped to the group limit (aggregate view). */
  groups: SearchGroup[]
  /** Flat cross-domain page sorted by score desc (the scoped single-domain view paginates this). */
  hits: SearchHit[]
  /** Overall matched count across the selected providers. */
  total: number
  /** Opaque offset cursor for the scoped view ("show all"); absent when there is no more. */
  nextCursor?: string
  /**
   * Domains that could not answer. Present ONLY when something failed, so an absent
   * field means "these results are complete" — the distinction a plain `[]` erased.
   * `field` carries the provider id; the raw daemon/CLI text stays in `detail`.
   */
  problems?: Problem[]
}

export interface SearchErrorResponse {
  error: string
  code: string
  detail?: string
}
