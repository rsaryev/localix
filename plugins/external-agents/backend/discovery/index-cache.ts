/**
 * The session index: a memoized, persisted map from a session's `(id, revision)` to its parsed
 * `SessionSummary`.
 *
 * WHY THIS EXISTS. `listSources()` is cheap (readdir+stat: 1-4 ms per provider in a real local history).
 * `readSummaries()` is not: summarizing all 694 discovered sessions cold costs ~119 ms of parsing.
 * That is tolerable once and intolerable per keystroke or per render. So:
 *
 *   scan() = listSources()  →  diff against the cache by that key  →  readSummaries() ONLY for
 *            the misses  →  persist.
 *
 * INVALIDATION IS ON A REAL SIGNAL, not a clock. `revision` is `mtime|size` for a file and the
 * row's own `time_updated` for a database row. Both change exactly when the session's content
 * changes. There is deliberately no TTL: a TTL would either re-parse unchanged history or serve
 * stale rows for a live session, and neither is necessary when the source tells you the truth.
 *
 * The in-memory layer is additionally guarded by `SCAN_COALESCE_MS`, which does NOT cache results
 * — it collapses concurrent/rapid callers onto one in-flight scan. Without it, a roster, a search
 * and a tool call arriving together each walk the filesystem.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ProviderAdapter, AdapterEnv } from '../adapters/types'
import type { ProviderStatus, QuotaReading, SessionSummary } from '../../shared/contracts'

/** Two rapid callers share one scan; a third arriving later gets a fresh one. */
const SCAN_COALESCE_MS = 1_500

interface CacheFile {
  version: number
  /** provider id -> `<sessionId>|<revision>` -> summary. The provider id is a KEY IN THE DOCUMENT,
   *  never a path. */
  providers: Record<string, Record<string, SessionSummary>>
}

/**
 * Bumped when the summary shape or a parser changes in a way that invalidates stored rows.
 *
 * 8: Gemini sessions carry a `cwd`, resolved from `~/.gemini/projects.json`. NOTHING ABOUT THE
 * SHAPE MOVED — the field was always declared, it was always absent for this provider, and the
 * derivation is what changed. That is the one case `cache-shape.test.ts` cannot see: a row cached
 * under 7 parses cleanly, keeps its empty attribution, and 29 sessions stay in the "no working
 * directory recorded" bucket until their files happen to change. A bump is a rescan, and a rescan is
 * the only thing that re-derives.
 *
 * 7: sessions carry `model` — a single-model provider's own record, so the model axis works without
 * token usage. A stale row parses fine without it, and the axis silently stays empty for those
 * providers, which is the same silence 6 was bumped for.
 *
 * 6: sessions carry `quotas` (a reading per window). Two changes landed on shape 5 without a bump —
 * `quota` and then its replacement — and the symptom is silence, not an error: the stale rows parse
 * fine and simply lack the field, so every quota surface goes blank until something else forces a
 * rescan. Caught by running the tool against a state dir written by the previous build.
 */
const CACHE_VERSION = 8

/**
 * Cache key for one discovered session.
 *
 * The SESSION ID is part of it, not just the revision. A revision is only unique WITHIN a session —
 * it is `mtime|size` for a file and the row's own `time_updated` for a database row — so keying on
 * it alone made two sessions that happened to share one collide, and the cache then served one
 * session's summary under the other's name. For opencode, where the revision is a millisecond
 * timestamp, two sessions saved in the same millisecond is not a hypothetical.
 *
 * Invalidation is unaffected: the key still changes exactly when the revision does.
 */
function cacheKey(ref: { nativeSessionId: string; revision: string }): string {
  return `${ref.nativeSessionId}|${ref.revision}`
}

export interface ProviderIndex {
  readonly summaries: readonly SessionSummary[]
  readonly status: ProviderStatus
}

/**
 * The account's CURRENT windows: the newest reading of EACH one any of its sessions recorded.
 *
 * Folded here rather than on a session because a quota is not a property of a session — every
 * session of one agent draws on the same windows, so an older session's percentage describes a
 * moment, not a state. Ordered by when the provider WROTE the reading, not by when the file was
 * touched: a transcript can be rewritten by a later append without the quota line changing.
 *
 * Keyed on the window's LENGTH, which is the correction this fold needed. `primary` is not a fixed
 * window — with two open, Codex puts the 5-hour one there and moves the weekly to `secondary` — so a
 * single "newest reading" flips between a 5-hour percentage and a weekly one depending on which
 * session wrote last, and presents them as the same quantity.
 */
export function newestQuotas(summaries: readonly SessionSummary[]): readonly QuotaReading[] {
  const byWindow = new Map<number, QuotaReading>()
  for (const summary of summaries) {
    for (const quota of summary.quotas ?? []) {
      const seen = byWindow.get(quota.windowMinutes)
      if (!seen || quota.observedAt > seen.observedAt) byWindow.set(quota.windowMinutes, quota)
    }
  }
  // Shortest window first: it is the one most likely to bind, and a stable order keeps the workspace
  // from reshuffling between scans.
  return [...byWindow.values()].sort((a, b) => a.windowMinutes - b.windowMinutes)
}

export class SessionIndex {
  private readonly memory = new Map<string, Map<string, SessionSummary>>()
  private readonly inFlight = new Map<string, { at: number; promise: Promise<ProviderIndex> }>()
  private readonly last = new Map<string, ProviderIndex>()
  private loadedAll = false
  private writing: Promise<void> = Promise.resolve()

  constructor(
    private readonly adapters: readonly ProviderAdapter[],
    private readonly env: AdapterEnv,
    private readonly stateDir: string,
    private readonly log: (message: string) => void,
  ) {}

  /**
   * ONE cache document, whose name is a constant.
   *
   * The earlier shape was one file per provider, named by sanitizing the provider id into a path
   * segment. That is a filesystem key, and deriving one here re-spelled a rule the repo owns in
   * exactly one place (`@localixai/plugin-sdk/backend`'s `safeFileKey`) — the fifth near-copy of a
   * security primitive, which `safe-file-key-contract.test.ts` exists to reject. It was also
   * subtly WRONG as a copy: it permitted `.`, which the owner does not.
   *
   * The owner is not reachable from here — it is not exported by `@localixai/plugin-sdk`, and a
   * plugin importing `apps/api/src/**` is rejected by `check:architecture`. So rather than keep a
   * near-copy or widen the host, the derivation is DELETED: no untrusted-ish value ever becomes a
   * path segment, because the provider id now lives in the JSON document instead of in its name.
   * A rule you do not need is better than a rule you copy.
   *
   * Trade, stated: any provider's scan now rewrites the whole document rather than its own file.
   * Writes are serialized through `writing` and the in-memory map is the source of truth, so
   * concurrent scans cannot lose each other's sections. At the real size here (694 summaries,
   * ~400 KB) a full rewrite is single-digit milliseconds, and it only happens when a scan actually
   * found something new.
   */
  private cachePath(): string {
    return join(this.stateDir, 'index.json')
  }

  private async loadAll(): Promise<void> {
    if (this.loadedAll) return
    this.loadedAll = true
    try {
      const parsed = JSON.parse(await readFile(this.cachePath(), 'utf8')) as CacheFile
      if (parsed.version !== CACHE_VERSION || !parsed.providers) return
      for (const [provider, entries] of Object.entries(parsed.providers)) {
        const map = new Map<string, SessionSummary>()
        for (const [key, summary] of Object.entries(entries)) map.set(key, summary)
        this.memory.set(provider, map)
      }
    } catch {
      // A missing or corrupt cache is a cold start, never an error: the source of truth is on disk.
    }
  }

  private async load(provider: string): Promise<Map<string, SessionSummary>> {
    await this.loadAll()
    const cached = this.memory.get(provider)
    if (cached) return cached
    const map = new Map<string, SessionSummary>()
    this.memory.set(provider, map)
    return map
  }

  private async persist(): Promise<void> {
    const path = this.cachePath()
    const providers: Record<string, Record<string, SessionSummary>> = {}
    for (const [provider, map] of this.memory) providers[provider] = Object.fromEntries(map)
    const payload: CacheFile = { version: CACHE_VERSION, providers }
    // Serialize: four providers scanning in parallel share one target, so overlapping temp+rename
    // pairs would otherwise race and one section could be lost.
    this.writing = this.writing.then(async () => {
      try {
        await mkdir(dirname(path), { recursive: true })
        // temp+rename: a crash mid-write must not leave a half-JSON cache that then fails to parse
        // on every subsequent boot.
        const tmp = `${path}.${process.pid}.tmp`
        await writeFile(tmp, JSON.stringify(payload), 'utf8')
        await rename(tmp, path)
      } catch (error) {
        this.log(`external-agents: could not persist the session index: ${String(error)}`)
      }
    })
    return this.writing
  }

  private async scanProvider(adapter: ProviderAdapter): Promise<ProviderIndex> {
    const startedAt = Date.now()
    const roots = await adapter.probeRoots(this.env)
    let summaries: SessionSummary[] = []
    let error: string | undefined
    try {
      const refs = await adapter.listSources(this.env)
      const cache = await this.load(adapter.id)
      const hits: SessionSummary[] = []
      const misses = []
      for (const ref of refs) {
        const hit = cache.get(cacheKey(ref))
        if (hit) hits.push(hit)
        else misses.push(ref)
      }
      const parsed = misses.length > 0 ? await adapter.readSummaries(misses, this.env) : []
      // Rebuild rather than mutate, so revisions belonging to deleted or superseded sessions are
      // evicted instead of growing the cache without bound.
      const next = new Map<string, SessionSummary>()
      for (const ref of refs) {
        const hit = cache.get(cacheKey(ref))
        if (hit) next.set(cacheKey(ref), hit)
      }
      const byId = new Map(parsed.map((s) => [s.nativeSessionId, s]))
      for (const ref of misses) {
        const summary = byId.get(ref.nativeSessionId)
        if (summary) next.set(cacheKey(ref), summary)
      }
      this.memory.set(adapter.id, next)
      if (misses.length > 0) await this.persist()
      summaries = [...hits, ...parsed]
    } catch (cause) {
      // A provider whose scan throws must not take the whole roster down; it reports its own error.
      error = cause instanceof Error ? cause.message : String(cause)
      this.log(`external-agents: ${adapter.id} scan failed: ${error}`)
    }
    const quotas = newestQuotas(summaries)
    return {
      summaries,
      status: {
        provider: adapter.id,
        displayName: adapter.displayName,
        roots,
        sessionCount: summaries.filter((s) => !s.parentNativeSessionId).length,
        ...(summaries.some((s) => s.parentNativeSessionId)
          ? { childSessionCount: summaries.filter((s) => s.parentNativeSessionId).length }
          : {}),
        error,
        lastScanMs: Date.now() - startedAt,
        verified: adapter.verified,
        ...(quotas.length > 0 ? { quotas } : {}),
      },
    }
  }

  async scan(adapter: ProviderAdapter): Promise<ProviderIndex> {
    const pending = this.inFlight.get(adapter.id)
    if (pending && Date.now() - pending.at < SCAN_COALESCE_MS) return pending.promise
    const promise = this.scanProvider(adapter).then((result) => {
      this.last.set(adapter.id, result)
      return result
    })
    this.inFlight.set(adapter.id, { at: Date.now(), promise })
    return promise
  }

  async scanAll(): Promise<readonly ProviderIndex[]> {
    return Promise.all(this.adapters.map((a) => this.scan(a)))
  }

  /** Last completed scan, without triggering one. Used by paths that must not block on I/O. */
  peek(provider: string): ProviderIndex | undefined {
    return this.last.get(provider)
  }
}
