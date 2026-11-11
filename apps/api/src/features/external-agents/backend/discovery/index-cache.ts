/**
 * The session index: a memoized, persisted map from a session's `(id, revision)` to its parsed
 * `SessionSummary`.
 *
 *   scan() = listSources()  →  diff against the cache by that key  →  read ONLY the misses
 *            →  persist.
 *
 * INVALIDATION IS ON A REAL SIGNAL, not a clock. `revision` is `mtime|size` for a file and the
 * row's own `time_updated` for a database row; both change exactly when the session's content does.
 *
 * TWO DEPTHS. A miss is first LISTED: an append-only adapter reads the transcript's head and tail
 * (identity, title, recency) and walks only what an append added to a session it walked before.
 * The whole-file walk for token usage is what statistics need, and only a `walked` scan pays it —
 * once per session, remembered across restarts as the `unwalked` set. Measured on a real history
 * (3,700 sessions, 10 GB) the cold list went from a 12 s walk of every byte to head-and-tail reads.
 *
 * Concurrent callers share work: scans of one provider coalesce for `SCAN_COALESCE_MS`, and one walk
 * runs per provider at a time, every `walked` caller awaiting the same one.
 */

import type { ProviderAdapter, AdapterEnv, SourceRef } from '../adapters/types'
import { nextFolds, readMisses } from './read-misses'
import { newestQuotas } from './newest-quotas'
import { emptyIndexState, indexPath, readIndexState, writeIndexState } from './index-store'
import type { ProviderStatus, SessionSummary } from '../../shared/contracts'

/** Two rapid callers share one scan; a third arriving later gets a fresh one. */
const SCAN_COALESCE_MS = 1_500

/**
 * The document is written at most this often; a change inside the interval trails it. The index in
 * memory is the truth while the process runs, and the document only spares the next start a re-read
 * — a write lost to a crash costs re-reading what changed since, which the folds make an append's
 * worth. Every refresh used to rewrite all of it: 7 MB every few seconds while an agent ran.
 */
const PERSIST_EVERY_MS = 30_000

export interface IndexTiming {
  readonly now: () => number
  /** Resolves when a trailing write is due. */
  readonly delay: (ms: number) => Promise<void>
}

const realTiming: IndexTiming = {
  now: Date.now,
  delay: (ms) =>
    new Promise((resolve) => {
      const timer = setTimeout(resolve, ms)
      timer.unref?.()
    }),
}

/** What a caller needs: rows to list, or rows whose usage has been walked to the end. */
export type ScanDepth = 'listed' | 'walked'

/**
 * The session id is part of the key, not just the revision: a revision is unique only WITHIN a
 * session (an opencode revision is a millisecond timestamp), and keying on it alone served one
 * session's summary under another's name.
 */
function cacheKey(ref: { nativeSessionId: string; revision: string }): string {
  return `${ref.nativeSessionId}|${ref.revision}`
}

export interface ProviderIndex {
  readonly summaries: readonly SessionSummary[]
  readonly status: ProviderStatus
}

/** What a list scan learned besides the state it updated. */
interface ScanOutcome {
  readonly roots: ProviderStatus['roots']
  readonly lastScanMs: number
  readonly error: string | undefined
}

export class SessionIndex {
  private readonly adapters: readonly ProviderAdapter[]
  private readonly env: AdapterEnv
  private readonly path: string
  private readonly log: (message: string) => void
  private state = emptyIndexState()
  private readonly inFlight = new Map<string, { at: number; promise: Promise<ScanOutcome> }>()
  private readonly walking = new Map<string, Promise<void>>()
  /** Each provider's refs from its last scan, by native session id. */
  private readonly refs = new Map<string, Map<string, SourceRef>>()
  /** The one read of the document, shared: a flag set before the read let providers scanned
   * alongside the first see "loaded" while it was still being read, and re-parse everything. */
  private loading: Promise<void> | undefined
  private writing: Promise<void> = Promise.resolve()
  private lastWrite = -Infinity
  private trailing: Promise<void> | undefined
  private readonly timing: IndexTiming

  constructor(
    adapters: readonly ProviderAdapter[],
    env: AdapterEnv,
    stateDir: string,
    log: (message: string) => void,
    timing: IndexTiming = realTiming,
  ) {
    this.adapters = adapters
    this.env = env
    this.path = indexPath(stateDir)
    this.log = log
    this.timing = timing
  }

  private loadAll(): Promise<void> {
    this.loading ??= readIndexState(this.path).then((state) => {
      this.state = state
    })
    return this.loading
  }

  /**
   * At once when the last write is older than the interval, otherwise once when it has passed —
   * whatever the state is then. Serialized: providers scanning in parallel share one target, and
   * overlapping temp+rename pairs would otherwise race and lose a section.
   */
  private persist(): Promise<void> {
    const wait = this.lastWrite + PERSIST_EVERY_MS - this.timing.now()
    if (wait <= 0) return this.write()
    this.trailing ??= this.timing.delay(wait).then(() => {
      if (!this.trailing) return
      this.trailing = undefined
      return this.write()
    })
    return Promise.resolve()
  }

  /** At shutdown: a write that is due lands now rather than being lost with the process. */
  close(): Promise<void> {
    if (!this.trailing) return this.writing
    this.trailing = undefined
    return this.write()
  }

  /** Settles when no write is due: the trailing one, if any, has landed. */
  async settled(): Promise<void> {
    await this.trailing
    await this.writing
  }

  private write(): Promise<void> {
    this.lastWrite = this.timing.now()
    this.writing = this.writing.then(() =>
      writeIndexState(this.path, this.state).catch((error: unknown) =>
        this.log(`external-agents: could not persist the session index: ${String(error)}`),
      ),
    )
    return this.writing
  }

  private async scanProvider(adapter: ProviderAdapter): Promise<ScanOutcome> {
    const startedAt = Date.now()
    const roots = await adapter.probeRoots(this.env)
    let error: string | undefined
    try {
      const refs = await adapter.listSources(this.env)
      this.refs.set(adapter.id, new Map(refs.map((ref) => [ref.nativeSessionId, ref])))
      await this.loadAll()
      const cache = this.state.summaries.get(adapter.id) ?? new Map<string, SessionSummary>()
      const misses = refs.filter((ref) => !cache.has(cacheKey(ref)))
      await this.read(adapter, refs, misses, false)
      if (misses.length > 0) await this.persist()
    } catch (cause) {
      // A provider whose scan throws must not take the whole roster down; it reports its own error.
      error = cause instanceof Error ? cause.message : String(cause)
      this.log(`external-agents: ${adapter.id} scan failed: ${error}`)
    }
    return { roots, lastScanMs: Date.now() - startedAt, error }
  }

  /**
   * Read `misses` (at the given depth) and rebuild the provider's maps over `refs`. Rebuilt rather
   * than mutated, so revisions of deleted or superseded sessions are evicted, not kept forever.
   */
  private async read(
    adapter: ProviderAdapter,
    refs: readonly SourceRef[],
    misses: readonly SourceRef[],
    walk: boolean,
  ): Promise<void> {
    const before = this.state.summaries.get(adapter.id) ?? new Map<string, SessionSummary>()
    const previous = new Map([...before.values()].map((s) => [s.nativeSessionId, s]))
    const read = await readMisses(
      adapter,
      misses,
      previous,
      this.state.folds.get(adapter.id),
      this.env,
      walk,
    )
    // Merged against the state as it is NOW: a walk may have finished while this read ran.
    const cache = this.state.summaries.get(adapter.id) ?? new Map<string, SessionSummary>()
    const folds = this.state.folds.get(adapter.id)
    const byId = new Map(read.summaries.map((s) => [s.nativeSessionId, s]))
    const owed = this.state.unwalked.get(adapter.id) ?? new Set<string>()
    const reread = new Set(misses.map((ref) => ref.nativeSessionId))
    const next = new Map<string, SessionSummary>()
    const nextOwed = new Set<string>()
    for (const ref of refs) {
      const id = ref.nativeSessionId
      const summary = reread.has(id) ? byId.get(id) : cache.get(cacheKey(ref))
      if (summary) next.set(cacheKey(ref), summary)
      if (reread.has(id) ? read.unwalked.has(id) : owed.has(id)) nextOwed.add(id)
    }
    this.state.summaries.set(adapter.id, next)
    this.state.folds.set(adapter.id, nextFolds(folds, refs, misses, read.folds))
    this.state.unwalked.set(adapter.id, nextOwed)
  }

  /** Walk every session of the provider a list read left unwalked, then persist once. */
  private async walkOwed(adapter: ProviderAdapter): Promise<void> {
    const owed = this.state.unwalked.get(adapter.id)
    const refs = [...(this.refs.get(adapter.id)?.values() ?? [])]
    const misses = refs.filter((ref) => owed?.has(ref.nativeSessionId))
    if (misses.length === 0) return
    await this.read(adapter, refs, misses, true)
    await this.persist()
  }

  /** Built from the state as it is when asked, so a coalesced caller sees a walk that finished. */
  private indexOf(
    adapter: ProviderAdapter,
    { roots, lastScanMs, error }: ScanOutcome,
  ): ProviderIndex {
    const summaries = error ? [] : [...(this.state.summaries.get(adapter.id)?.values() ?? [])]
    const children = summaries.filter((s) => s.parentNativeSessionId).length
    const quotas = newestQuotas(summaries)
    return {
      summaries,
      status: {
        provider: adapter.id,
        displayName: adapter.displayName,
        roots,
        sessionCount: summaries.length - children,
        ...(children ? { childSessionCount: children } : {}),
        error,
        lastScanMs,
        verified: adapter.verified,
        ...(quotas.length > 0 ? { quotas } : {}),
      },
    }
  }

  private listed(adapter: ProviderAdapter): Promise<ScanOutcome> {
    const pending = this.inFlight.get(adapter.id)
    if (pending && this.timing.now() - pending.at < SCAN_COALESCE_MS) return pending.promise
    const promise = this.scanProvider(adapter)
    this.inFlight.set(adapter.id, { at: this.timing.now(), promise })
    return promise
  }

  async scan(adapter: ProviderAdapter, depth: ScanDepth = 'listed'): Promise<ProviderIndex> {
    const listed = await this.listed(adapter)
    if (depth === 'walked' && !listed.error) await this.walk(adapter)
    return this.indexOf(adapter, listed)
  }

  private walk(adapter: ProviderAdapter): Promise<void> {
    const running = this.walking.get(adapter.id)
    if (running) return running
    const walk = this.walkOwed(adapter)
      .catch((cause: unknown) =>
        this.log(`external-agents: ${adapter.id} walk failed: ${String(cause)}`),
      )
      .finally(() => this.walking.delete(adapter.id))
    this.walking.set(adapter.id, walk)
    return walk
  }

  async scanAll(depth: ScanDepth = 'listed'): Promise<readonly ProviderIndex[]> {
    return Promise.all(this.adapters.map((a) => this.scan(a, depth)))
  }

  /**
   * One session's source and summary, from a (coalesced) scan rather than a listing of its own: a
   * transcript, a resume or a context read then costs the scan, not another whole-file walk.
   */
  async find(
    adapter: ProviderAdapter,
    nativeSessionId: string,
  ): Promise<{ ref: SourceRef; summary: SessionSummary } | undefined> {
    const index = await this.scan(adapter)
    const ref = this.refs.get(adapter.id)?.get(nativeSessionId)
    const summary = ref && index.summaries.find((s) => s.nativeSessionId === nativeSessionId)
    return ref && summary ? { ref, summary } : undefined
  }
}
