/**
 * REST search provider — matches saved requests by name, method and url over the workbench
 * search. Hit ids reuse the `rest://` grammar so a result opens / drag-links straight into chat.
 *
 * `eager`: unlike trading (which hits a live exchange and must stay lazy), our whole corpus is one
 * small per-user JSON file behind a cached store. It costs nothing to include in a default
 * "search everything", and a saved request is exactly the kind of thing a user hunts for by half
 * a name.
 */

import {
  bestFieldScore,
  type SearchHit,
  type SearchProvider,
} from '@localixai/mini-app-sdk/backend'
import type { ResourceRequestPort } from './resource-provider'
import { redactSpec } from './store'
import { buildRequestUri } from './uri'

/** Below this, a fuzzy match is noise rather than a hit. */
const MIN_SCORE = 0.3

/**
 * What a hit says under its name — everything the name does NOT already say. The method and url
 * are the two facts that distinguish `github-user` from `github-user-2`, which is precisely the
 * pair an import's dedup suffix creates.
 */
export function requestSubtitle(method: string, url: string, authType: string): string {
  const parts = [`${method} ${url}`]
  if (authType !== 'none') parts.push(authType)
  return parts.join(' · ')
}

export function createRestSearchProvider(port: ResourceRequestPort): SearchProvider {
  return {
    id: 'api:requests',
    title: 'REST requests',
    tier: 'eager',
    icon: 'request',

    async search(userId, query): Promise<SearchHit[]> {
      // The contract says a provider MUST resolve, never throw — a failure here would take down
      // the whole federated search, not just our group.
      let all
      try {
        all = await port.list(userId, {
          sessionId: query.sessionId ?? undefined,
        })
      } catch {
        return []
      }

      const hits: SearchHit[] = []
      for (const saved of all) {
        const spec = redactSpec(saved.spec)
        const score = bestFieldScore([saved.name, spec.url, spec.method], query.text)
        if (score < MIN_SCORE) continue
        hits.push({
          id: buildRequestUri(saved.name),
          domain: 'api:requests',
          title: saved.name,
          subtitle: requestSubtitle(spec.method, spec.url, spec.auth.type),
          icon: 'request',
          score,
        })
      }
      return hits
    },
  }
}
