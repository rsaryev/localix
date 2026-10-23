/**
 * Search response → the compact JSON the model reads. Pure.
 *
 * Every hit keeps what the model needs to ACT on it: chat hits carry `session_id` (and
 * `message_id`, which `global_search around_message_id` opens), file hits a `path` and `line`
 * (which `read` opens), everything else its `ref` URI. The output is held under a budget by
 * dropping snippets first and then trailing hits — each step still valid JSON, and what was
 * dropped is counted, never silently cut.
 */
import { parseLocalixResourceUri } from '@localixai/mini-app-sdk/backend'
import type { SearchHit } from '../../search/provider'
import type { SearchResponse } from '../../../search/contracts'

export const GLOBAL_SEARCH_MAX_CHARS = 8192
const SNIPPET_CHARS = 240

export interface ModelHit {
  title: string
  subtitle?: string
  snippet?: string
  matched_by?: SearchHit['matchedBy']
  session_id?: string
  message_id?: string
  path?: string
  line?: number
  ref?: string
}

export interface ModelGroup {
  domain: string
  title: string
  total: number
  hits: ModelHit[]
}

const clip = (s: string, n: number) => {
  const flat = s.replace(/\s+/g, ' ').trim()
  return flat.length > n ? `${flat.slice(0, n)}…` : flat
}

/** Pull the ids a follow-up tool takes out of a hit's canonical URIs. */
export function locate(
  hit: SearchHit,
): Pick<ModelHit, 'session_id' | 'message_id' | 'path' | 'line' | 'ref'> {
  if (hit.id.startsWith('file://')) {
    const [path, anchor] = hit.id.slice('file://'.length).split('#L')
    return { path, ...(anchor ? { line: Number(anchor) } : {}) }
  }
  const parsed = parseLocalixResourceUri(hit.id)
  if (parsed?.provider === 'chat') {
    const [kind, sessionId, messageId] = parsed.segments.map(decodeURIComponent)
    if (kind === 'session' && sessionId) return { session_id: sessionId }
    if (kind === 'message' && sessionId && messageId) {
      return { session_id: sessionId, message_id: messageId }
    }
  }
  return { ref: hit.uri ?? hit.id }
}

export function toModelGroups(response: SearchResponse): ModelGroup[] {
  return response.groups.map((group) => ({
    domain: group.domain,
    title: group.title,
    total: group.total,
    hits: group.hits.map((hit) => ({
      title: clip(hit.title, 120),
      ...(hit.subtitle ? { subtitle: clip(hit.subtitle, 160) } : {}),
      ...(hit.snippet ? { snippet: clip(hit.snippet, SNIPPET_CHARS) } : {}),
      ...(hit.matchedBy ? { matched_by: hit.matchedBy } : {}),
      ...locate(hit),
    })),
  }))
}

/**
 * Drop the hits that point into the conversation the agent is in: it already has that
 * conversation, and its own just-sent question would otherwise be the best match for itself.
 */
export function withoutSession(groups: ModelGroup[], sessionId: string): ModelGroup[] {
  return groups.flatMap((group) => {
    const hits = group.hits.filter((hit) => hit.session_id !== sessionId)
    const dropped = group.hits.length - hits.length
    return hits.length
      ? [{ ...group, hits, total: Math.max(group.total - dropped, hits.length) }]
      : []
  })
}

export function strategyLine(response: SearchResponse): string {
  const s = response.strategy
  if (s.mode === 'hybrid') {
    return s.indexing
      ? 'words + meaning (index still building — results may be incomplete)'
      : 'words + meaning'
  }
  return s.reason === 'starting' || s.reason === 'unavailable'
    ? 'words only (meaning search is unavailable right now)'
    : 'words only'
}

/** Serialize under the budget: drop snippets, then subtitles, then trailing hits. */
export function capPayload(payload: { groups: ModelGroup[] } & Record<string, unknown>): string {
  let text = JSON.stringify(payload)
  if (text.length <= GLOBAL_SEARCH_MAX_CHARS) return text
  for (const field of ['snippet', 'subtitle'] as const) {
    for (const g of payload.groups) for (const h of g.hits) delete h[field]
    text = JSON.stringify(payload)
    if (text.length <= GLOBAL_SEARCH_MAX_CHARS) return text
  }
  let omitted = 0
  while (text.length > GLOBAL_SEARCH_MAX_CHARS) {
    const group = [...payload.groups].reverse().find((g) => g.hits.length > 0)
    if (!group) break
    group.hits.pop()
    omitted += 1
    payload.omitted_hits = omitted
    payload.note = `${omitted} hit(s) omitted to fit the output budget — narrow the query or pass domains`
    text = JSON.stringify(payload)
  }
  return text
}
