/**
 * WHERE THE CATALOG COMES FROM: models.dev over the network, and the snapshot shipped in
 * `@opencode-ai/models` when there is nothing better.
 *
 * `api.json?type=all` is a static file behind a CDN with an ETag: a conditional request for an
 * unchanged catalog answers 304 with no body, so checking often costs next to nothing. (A list of
 * types instead of `all` is filtered per request and loses the ETag.) `all` also carries the
 * decision models the default leaves out.
 */
import type { ProviderMap } from '@opencode-ai/models'

const MODELS_DEV_URL = 'https://models.dev/api.json?type=all'
const FETCH_TIMEOUT_MS = 30_000

type FetchOutcome =
  | { status: 'unchanged' }
  | { status: 'fetched'; providers: unknown; etag?: string }

/** One conditional fetch. Throws on a transport failure, a status other than 200/304, or a body that is not JSON. */
export async function fetchModelsDev(options: {
  etag?: string
  fetch?: typeof globalThis.fetch
}): Promise<FetchOutcome> {
  const response = await (options.fetch ?? fetch)(MODELS_DEV_URL, {
    headers: {
      accept: 'application/json',
      'user-agent': 'localix',
      ...(options.etag ? { 'if-none-match': options.etag } : {}),
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (response.status === 304) return { status: 'unchanged' }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error(`models.dev answered ${response.status}`)
  }
  const etag = response.headers.get('etag') ?? undefined
  return { status: 'fetched', providers: await response.json(), ...(etag ? { etag } : {}) }
}

/**
 * The catalog shipped with the installed SDK, for a first launch with no stored copy and no
 * network. Several megabytes, so it is imported only then.
 */
export async function loadSnapshot(): Promise<ProviderMap> {
  return (await import('@opencode-ai/models/snapshot')).providers
}
