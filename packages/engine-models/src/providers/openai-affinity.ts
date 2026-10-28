import type { CatalogEntry } from '../catalog/catalog'
import type { WireProfile } from '../wire/prompt'
import type { ProviderAccess } from './connect'

/** The longest cache key OpenAI takes; a longer one is cut, not refused. */
const CACHE_KEY_MAX = 64

/** The session id as OpenAI's cache key: the body key and the routing headers carry the same one. */
export const cacheKeyOf = (sessionId: string) =>
  Array.from(sessionId).slice(0, CACHE_KEY_MAX).join('')

/**
 * What routes a request to the machine that holds its prefix. The engine this one replaced sent
 * the session id as `session_id` and `x-client-request-id` beside the body's `prompt_cache_key`,
 * as Codex does, to keep an append-only session on one cache; this engine sent the key alone and
 * its hit rate on OpenAI models was uneven (a few percent in some sessions, over 90% in others).
 * Whether the headers are what evens it out is not measured against the live API.
 * The ChatGPT backend takes its own `session-id` (`auth/flows/openai-codex.ts`).
 */
export function openaiAffinity(
  entry: CatalogEntry,
  access: Pick<ProviderAccess, 'baseURL'> | undefined,
): WireProfile['requestHeaders'] {
  // Only OpenAI's own address is known to take the underscore header: a proxy or another vendor's
  // OpenAI-compatible host may refuse it (the replaced engine kept it off such hosts too).
  const toOpenAI = entry.provider.id === 'openai' && !entry.route.baseURL && !access?.baseURL
  return ({ sessionId, promptCacheKey }) => {
    const key = cacheKeyOf(promptCacheKey ?? sessionId)
    return { ...(toOpenAI ? { session_id: key } : {}), 'x-client-request-id': key }
  }
}
