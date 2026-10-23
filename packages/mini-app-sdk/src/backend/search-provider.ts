/**
 * SEARCH PROVIDER REGISTRY — the agnostic seam behind the single `POST /rpc/search`
 * endpoint. A provider owns a DOMAIN (e.g. `sessions`) and turns a text query into a
 * flat list of ranked hits over ONE existing feature service via a narrow port.
 *
 * Mirrors `agent-core/resource-refs/provider.ts`: the core learns NOTHING about any
 * concrete domain — the search service fans a query out to the registered providers
 * and merges / ranks / groups the results. Registering ONE provider adds a whole new
 * searchable domain with no core edits. Lives in `agent-core` so it stays free of
 * `features/*` value-imports; a concrete provider lives in its own feature and is
 * injected at bootstrap.
 *
 * Pure of IO — the registry is a lookup + parallel fan-out; providers do the work and
 * MUST resolve, so an absent container engine / unreachable cluster never fails the
 * whole query. The SERVICE owns ranking, grouping, and pagination so the endpoint and a
 * future agent tool share ONE code path.
 *
 * WHY A PROVIDER CAN SAY "I COULD NOT SEARCH". Degrading a failure to `[]` made a dead
 * daemon and "no matches" the same answer: a person searching `nginx` with Docker
 * stopped read "nothing here", which is a lie the UI had no way to detect. So the
 * fan-out has TWO outputs now — the hits, and the problems that made the hit list
 * incomplete. A provider opts in by answering `{ hits, problem }` instead of a bare
 * array; the array form still compiles and still means "this went fine". The registry
 * itself mints one for the two failures it owns and the provider cannot see — a throw
 * and a timeout — so every domain gets a truthful line without editing any provider.
 *
 * A problem here obeys the product-wide rule: `message` is one classified sentence, the
 * raw daemon/CLI/HTTP text goes in `detail`. The `Problem` shape is the SAME one the UI
 * renders, so nothing translates between the two ends.
 */
import type { Problem } from '../ui/problems'
import type { SemanticQuery } from './semantic'
import { DeadlineExceededError, withTimeout } from './timeout'

/** A single search result across any domain. */
export interface SearchHit {
  /** Stable opaque id — REUSE canonical resource URIs where possible
   *  (`localix://resource/chat/…`, `localix://resource/catalog/…`) so a hit is directly
   *  re-openable / draggable into chat. */
  id: string
  /**
   * Canonical UI destination when the hit's stable identity is not itself
   * openable. Consumers navigate to `uri ?? id`.
   */
  uri?: string
  /** The producing provider's id — the GROUP key. Stamped by the registry. */
  domain: string
  /** Primary display label. */
  title: string
  /** One-line secondary text (dialect, namespace, project, role…). */
  subtitle?: string
  /** Optional longer match context (e.g. an FTS snippet with `[match]` markers). */
  snippet?: string
  /** Icon hint the UI maps to a glyph (reuses the composer `RESOURCE_ICONS` vocabulary). */
  icon?: string
  /** Provider-local relevance in [0,1]; higher = better. The service sorts on it. */
  score: number
  /**
   * What made this a match, when the provider knows: the query's words, its meaning
   * (semantic strategy only), or both. Absent for providers that only match text.
   */
  matchedBy?: 'words' | 'meaning' | 'both'
}

/** The query handed to every provider. */
export interface SearchQuery {
  /** The user's raw query text (trimmed, non-empty). */
  text: string
  /** Restrict to these provider ids. Empty / undefined = every EAGER provider. */
  domains?: string[]
  /** Soft cap per provider so one noisy domain can't starve the merged page. */
  limitPerProvider?: number
  /** Active session — the file provider resolves its cwd from this; others may scope by it. */
  sessionId?: string | null
  /** Active project — domain providers may scope by it. */
  projectId?: string | null
  /** Cancellation for slow (CLI / live-connection) providers. */
  signal?: AbortSignal
  /**
   * The SEMANTIC strategy for this query, present only when semantic search is on and its
   * engine can answer. A provider that has a semantic collection fuses it with its own
   * word matching; every other provider ignores it and the lexical strategy is unchanged.
   */
  semantic?: SemanticQuery
}

/**
 * A provider's answer when it has more to say than a hit list.
 *
 * `problem` states that THIS domain's hits are incomplete — the daemon is down, the
 * cluster is unreachable, one of two listings failed. It is not an error return: a
 * provider that answers `{ hits: [...], problem }` still contributes every hit it did
 * find, and the query as a whole still succeeds.
 */
export interface SearchProviderResult {
  hits: SearchHit[]
  /** One classified sentence in `message`, the raw engine text in `detail`. */
  problem?: Problem
}

/** What `search()` may resolve to: the plain hit list, or hits plus a problem. */
export type SearchProviderAnswer = SearchHit[] | SearchProviderResult

/**
 * The hits out of either answer shape.
 *
 * Fifteen providers answer with a bare array and a handful now answer with the envelope, so every
 * caller — the registry, and every provider's own tests — has to narrow. One exported narrowing
 * beats fifteen copies of `Array.isArray`, and it is the seam to change if a third shape ever
 * appears.
 */
export const searchHitsOf = (answer: SearchProviderAnswer): SearchHit[] =>
  Array.isArray(answer) ? answer : answer.hits

/** Both halves of one fan-out: everything found, and everything that stopped it. */
export interface SearchFanOut {
  hits: SearchHit[]
  /** Per-domain incompleteness, `field` stamped with the producing provider's id. */
  problems: Problem[]
}

/** The narrow per-domain port each feature implements. */
export interface SearchProvider {
  /** Stable domain id, e.g. `sessions`. Also the group key + each `hit.domain`. */
  id: string
  /** Human group label, e.g. "Chats". */
  title: string
  /**
   * `eager` providers run on every default query; `lazy` providers run ONLY when
   * their id is explicitly present in `query.domains` (so a heavy domain that shells
   * out or needs a live connection never stalls a default "search everything").
   */
  tier: 'eager' | 'lazy'
  /** Icon hint for the group header (RESOURCE_ICONS vocabulary). */
  icon?: string
  /**
   * Run the search. MUST resolve — a throw is caught and reported as this domain
   * having failed, which is coarser than what the provider knows. Return
   * `{ hits, problem }` to keep partial results AND say what was lost.
   */
  search(userId: string, query: SearchQuery): Promise<SearchProviderAnswer>
}

export interface SearchProviderRegistry {
  /** Register a provider. A DUPLICATE id is rejected and the first registration wins —
   *  the rule every sibling contribution registry already enforces (context-fabric's
   *  `tryRegister`, ws-frame-registry's by-construction reject). Re-registering the same
   *  object is idempotent: the host re-runs `register` for already-wired backends when the
   *  registry is attached. Returns false when the id was already taken by someone else. */
  register(provider: SearchProvider): boolean
  /** Remove a provider — hot plugin disable. Pass the PROVIDER you registered, not a bare
   *  id: with an id alone a disable removed whatever currently sits under that id, which
   *  on an id collision is somebody else's live provider. Unknown/foreign entries are a
   *  no-op. */
  unregister(provider: SearchProvider | string): void
  get(id: string): SearchProvider | undefined
  list(): SearchProvider[]
  /**
   * Fan the query out to the selected providers (all eager when `query.domains` is
   * empty; exactly the named ids otherwise), in parallel. No provider's failure can
   * fail the query — it becomes a `problem` beside the hits. Returns the flat hit list
   * with `domain` stamped from the producing provider. Ranking / grouping / pagination
   * is the SERVICE's job, not the registry's.
   */
  searchAll(userId: string, query: SearchQuery): Promise<SearchFanOut>
}

/** Per-provider wall-clock cap in `searchAll` — a slow domain degrades to [] not a stall. */
export const PROVIDER_TIMEOUT_MS = 2500

/** Which providers a query targets: the named ids when given, else every eager one. */
export function selectProviders(
  providers: SearchProvider[],
  domains: string[] | undefined,
): SearchProvider[] {
  if (domains && domains.length > 0) {
    const wanted = new Set(domains)
    return providers.filter((p) => wanted.has(p.id))
  }
  return providers.filter((p) => p.tier === 'eager')
}

export function createSearchProviderRegistry(): SearchProviderRegistry {
  const byId = new Map<string, SearchProvider>()

  return {
    register(provider) {
      const existing = byId.get(provider.id)
      // Same object re-registered (host re-wiring) — idempotent, not a collision.
      if (existing === provider) return true
      if (existing) {
        console.warn(
          `[search] duplicate provider id "${provider.id}" — keeping the first; a plugin must namespace its provider id`,
        )
        return false
      }
      byId.set(provider.id, provider)
      return true
    },
    unregister(provider) {
      const id = typeof provider === 'string' ? provider : provider.id
      const live = byId.get(id)
      if (!live) return
      // Identity-checked: a plugin's disable must not evict a provider it never owned.
      if (typeof provider !== 'string' && live !== provider) return
      byId.delete(id)
    },
    get(id) {
      return byId.get(id)
    },
    list() {
      return [...byId.values()]
    },
    async searchAll(userId, query) {
      const selected = selectProviders([...byId.values()], query.domains)
      const cap = query.limitPerProvider
      const answers = await Promise.all(
        selected.map(async (p): Promise<SearchFanOut> => {
          try {
            // Bound each provider so ONE slow domain (a CLI shell-out, a live
            // DB/catalog fetch, ripgrep) can never stall the whole query. A provider
            // takes no signal, so the deadline primitive is the right tool — and it
            // is `lib/timeout.ts`'s, not ours: the hand-rolled race this replaced
            // left its timer live (and un-unref'd) for the full window after a fast
            // provider had already answered.
            const answer = await withTimeout(
              p.search(userId, query),
              PROVIDER_TIMEOUT_MS,
              `search provider "${p.id}"`,
            )
            const result = Array.isArray(answer) ? { hits: answer } : answer
            const capped = cap != null ? result.hits.slice(0, cap) : result.hits
            return {
              // Stamp `domain` from the producing provider so grouping is always consistent.
              hits: capped.map((h) => ({ ...h, domain: p.id })),
              problems: result.problem ? [stampDomain(result.problem, p)] : [],
            }
          } catch (err) {
            // The two failures a provider cannot report about itself. They are kept
            // apart because the actions differ: a slow domain is worth trying again,
            // a broken one is not. The sentence is the registry's (it knows only the
            // domain's name); the raw throw text is the operator's.
            const timedOut = err instanceof DeadlineExceededError
            return {
              hits: [],
              problems: [
                stampDomain(
                  {
                    message: timedOut
                      ? `${p.title} did not answer in time`
                      : `${p.title} could not be searched`,
                    detail: err instanceof Error ? err.message : String(err),
                  },
                  p,
                ),
              ],
            }
          }
        }),
      )
      return {
        hits: answers.flatMap((a) => a.hits),
        problems: answers.flatMap((a) => a.problems),
      }
    },
  }
}

/** Address a domain problem to its provider so the Event Center row names it. */
function stampDomain(problem: Problem, provider: SearchProvider): Problem {
  return problem.field ? problem : { ...problem, field: provider.id }
}
