// REST client for the global-search backend (`POST /rpc/search`). The endpoint is
// best-effort (per-provider failures degrade to empty), so this rarely throws — but
// we still surface a typed error the surfaces can show inline.
import type { ClientResponse } from 'hono/client'
import type { ResponseFormat } from 'hono/types'
import { client, type OkBody } from '@/shared/api/internal'
import type { SearchRequest, SearchResponse, SearchErrorResponse } from '@localixai/api/client'

export class SearchApiError extends Error {
  readonly code?: string
  readonly detail?: string
  constructor(message: string, code?: string, detail?: string) {
    super(message)
    this.name = 'SearchApiError'
    this.code = code
    this.detail = detail
  }
}

/**
 * What we say when a search request fails, from the code the server sent.
 *
 * The server answers the app's `{error:{code,message}}` envelope; this reader used to test
 * `typeof json.error === 'string'`, match nothing, and hand the object itself to `new
 * SearchApiError(...)` — which the tab then printed as the literal text "[object Object]".
 */
function searchFailureMessage(code: string | undefined): string {
  if (code === 'validation_error' || code === 'bad_request') return 'That search was rejected'
  if (code === 'unauthorized' || code === 'forbidden') return 'You are not allowed to search here'
  return 'The search could not run'
}

async function readOr<R extends ClientResponse<unknown, number, ResponseFormat>>(
  res: R,
): Promise<OkBody<R>> {
  const body = await res.json().catch(() => null)
  // What the error shapes below look at; the success body is returned as the route declares it.
  const json = body as (Partial<SearchErrorResponse> & { error?: unknown }) | null
  // Two shapes reach here: this endpoint's own flat `{error, code, detail}` and the app-wide
  // `{error:{code,message}}` envelope every route's error handler answers.
  const flat = json && typeof json.error === 'string' ? json.error : null
  const envelope =
    json && typeof json.error === 'object' && json.error !== null
      ? (json.error as { code?: string; message?: string })
      : null
  if (res.ok && !flat && !envelope) return body as OkBody<R>
  const code = json?.code ?? envelope?.code
  // The server's own words become the detail; the surface line gets a sentence.
  const detail = json?.detail ?? flat ?? envelope?.message ?? `HTTP ${res.status}`
  throw new SearchApiError(searchFailureMessage(code), code, detail)
}

export const searchApi = {
  /** Fan a query across the domain providers → ranked, grouped, paginated results. */
  async search(req: SearchRequest, signal?: AbortSignal): Promise<SearchResponse> {
    return readOr(await client.rpc.search.$post({ json: req }, { init: { signal } }))
  },
}
