/**
 * The Hugging Face API, as the local-model catalog uses it — three calls:
 *
 *   - `models(query)`: one page of GGUF repositories (a publisher's, or a search across all of
 *     Hugging Face), each with what a catalog card needs: parameters, context, chat template,
 *     original model, file names, commit and dates (`expand[]`). One request for a whole list.
 *   - `repo(id)`: one repository with file sizes and LFS hashes (`?blobs=true`) — the exact
 *     files a download verifies. Asked only to show or install a particular model.
 *   - `meta(id)`: one repository's metadata without its files (an original model's date).
 *
 * The anonymous API is rate-limited: after a 429 every call fails fast for a minute (callers
 * serve their cached copy) instead of digging deeper. `HF_TOKEN` raises the limit.
 */

export const HF_BASE = 'https://huggingface.co'
/** The llama.cpp project's own conversions: the catalog's default publisher. */
export const DEFAULT_PUBLISHER = 'ggml-org'

/** A repository as the list API returns it with `expand[]` — and `repo()` with sizes too. */
export interface HfModel {
  id: string
  sha?: string
  pipeline_tag?: string | null
  createdAt?: string
  downloads?: number
  likes?: number
  /** `base_model`: the repository this one converts — whose date is the model's own. */
  cardData?: { license?: string; base_model?: string | string[] } | null
  gguf?: {
    architecture?: string
    context_length?: number
    total?: number
    chat_template?: string
  } | null
  siblings?: Array<{ rfilename: string; size?: number; lfs?: { sha256?: string } | null }>
}

/** A repository read with its files' sizes and hashes, at a known commit. */
export type HfRepoInfo = HfModel & { sha: string }

export interface HfModelsQuery {
  /** One publisher, or every publisher on Hugging Face when absent. */
  author?: string
  search?: string
  /** Only repositories with this pipeline tag. */
  pipeline?: string
  /** Only quantizations of this original model (`deepseek-ai/DeepSeek-V4.1-Flash`). */
  quantizationOf?: string
  limit: number
}

export interface HfClient {
  models(query: HfModelsQuery, signal?: AbortSignal): Promise<HfModel[]>
  repo(id: string, signal?: AbortSignal): Promise<HfRepoInfo>
  meta(id: string, signal?: AbortSignal): Promise<HfModel>
}

/** What a catalog card is built from: everything but file sizes, in the one list request. */
const LIST_FIELDS = [
  'downloads',
  'likes',
  'createdAt',
  'pipeline_tag',
  'sha',
  'gguf',
  'cardData',
  'siblings',
]
const RATE_LIMIT_PAUSE_MS = 60_000
const TIMEOUT_MS = 15_000

export class HfRateLimited extends Error {
  constructor() {
    super('Hugging Face is limiting requests; the catalog shows what it has and tries again soon')
    this.name = 'HfRateLimited'
  }
}

export function createHfClient(
  fetchImpl: typeof fetch = fetch,
  options: { token?: string; now?: () => number } = {},
): HfClient {
  const clock = options.now ?? Date.now
  let pausedUntil = 0
  const headers: Record<string, string> = options.token
    ? { authorization: `Bearer ${options.token}` }
    : {}

  async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
    if (clock() < pausedUntil) throw new HfRateLimited()
    const res = await fetchImpl(url, { headers, signal: signal ?? AbortSignal.timeout(TIMEOUT_MS) })
    if (res.status === 429) {
      pausedUntil = clock() + RATE_LIMIT_PAUSE_MS
      throw new HfRateLimited()
    }
    if (!res.ok) throw new Error(`Hugging Face answered ${res.status} for ${new URL(url).pathname}`)
    return (await res.json()) as T
  }

  return {
    models(query, signal) {
      const params = new URLSearchParams({
        filter: 'gguf',
        sort: 'downloads',
        limit: String(query.limit),
      })
      if (query.author) params.set('author', query.author)
      if (query.search) params.set('search', query.search)
      if (query.pipeline) params.set('pipeline_tag', query.pipeline)
      if (query.quantizationOf) {
        params.append('filter', `base_model:quantized:${query.quantizationOf}`)
      }
      for (const field of LIST_FIELDS) params.append('expand[]', field)
      return getJson<HfModel[]>(`${HF_BASE}/api/models?${params}`, signal)
    },
    repo: (id, signal) => getJson<HfRepoInfo>(`${HF_BASE}/api/models/${id}?blobs=true`, signal),
    meta: (id, signal) => getJson<HfModel>(`${HF_BASE}/api/models/${id}`, signal),
  }
}
