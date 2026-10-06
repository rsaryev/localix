/**
 * The service: the one object that owns the index, the manifests and the live store, and the only
 * place the layers are wired together. Routes and tools are thin callers of this.
 */

import { homedir } from 'node:os'
import type { TerminalRead } from '@localixai/plugin-sdk/backend'
import type { AdapterEnv, ProviderAdapter, SourceRef } from './adapters/types'
import { PROVIDER_ADAPTERS, adapterFor } from './adapters/registry'
import { SessionIndex } from './discovery/index-cache'
import { buildRoster } from './discovery/roster'
import { computeStats, type ExternalAgentStats, type StatsQuery } from './discovery/stats'
import { ManifestRegistry } from './detection/registry'
import { LiveStore, type LiveEntry } from './live/store'
import { CORRELATE_ATTEMPT_DELAYS_MS, correlateOnce } from './live/correlate'
import { observeToolCall } from './live/observe'
import { waitForStates, type WaitRequest, type WaitOutcome } from './live/waiters'
import { HistoryWatch, hostWatchSlot, watchFiles, type WatchPath } from './live/history-watch'
import { compose, DEFAULT_BUDGET_CHARS, type ComposeResult } from './context/compose'
import { linkKeyOf, parseLinkKey } from './../shared/identity'
import { MAX_TRANSCRIPT_EVENTS } from '../shared/contracts'
import type {
  Bounded,
  ProviderStatus,
  RosterQuery,
  RosterRow,
  StateExplain,
  TranscriptSlice,
} from '../shared/contracts'

const DEFAULT_MAX_EVENTS = 400
/** How often a wait re-reads the panes it is waiting on. */
const WAIT_POLL_MS = 2_000
const DEFAULT_MAX_EVENT_CHARS = 4_000

export class AgentSessionsService {
  private readonly log: (message: string) => void
  private readonly availableProviders?: () => readonly string[]
  readonly manifests: ManifestRegistry
  readonly live: LiveStore
  /** Says when any provider's history moved — what the roster's push stream forwards. */
  readonly history: HistoryWatch
  private readonly index: SessionIndex
  /** The log each live delegation is tailed from, found once — see `turnSource`. */
  private readonly turnSources = new Map<string, { adapter: ProviderAdapter; ref: SourceRef }>()
  private readonly env: AdapterEnv
  private readonly timers = new Set<ReturnType<typeof setTimeout>>()

  constructor(
    stateDir: string,
    log: (message: string) => void,
    /**
     * Where the provider histories live. Defaults to this machine's real ones, which is the only
     * thing production ever wants — and the reason a test that only cares about LIVE delegations was
     * silently paying for a cold scan of the developer's own 1965 sessions on every case. That cost
     * 380 ms when the summary was a bounded window; once summaries began a full pass for token usage
     * it became 3.2 s, and under parallel suite load the case tipped past its timeout. An empty home
     * makes such a test hermetic as well as fast.
     */
    env?: AdapterEnv,
    availableProviders?: () => readonly string[],
  ) {
    this.log = log
    this.availableProviders = availableProviders
    this.env = env ?? { env: process.env, homeDir: homedir() }
    this.manifests = new ManifestRegistry(stateDir, log)
    this.live = new LiveStore(this.manifests)
    this.index = new SessionIndex(PROVIDER_ADAPTERS, this.env, stateDir, log)
    this.history = new HistoryWatch(
      async () =>
        (await Promise.all(this.availableAdapters().map((a) => a.probeRoots(this.env)))).flat(),
      { watchPath: this.pathWatch.watch },
    )
  }

  /** The host's native watcher, held like the terminal reader (see `hostWatchSlot`). */
  private readonly pathWatch = hostWatchSlot()
  setPathWatch = (watch: WatchPath | undefined) => this.pathWatch.set(watch)

  /**
   * The host's read-only terminal access, when this load has it.
   *
   * Held rather than injected in the constructor because the service is a process singleton and
   * `register(ctx)` runs more than once: the boot load carries host services, the per-run loads for
   * tools and hooks do not. Re-registering must never DROP a reader the boot load provided.
   */
  private terminalRead?: TerminalRead

  setTerminalRead(read: TerminalRead | undefined): void {
    if (read) this.terminalRead = read
  }

  /**
   * The delegation's CURRENT screen, read on demand.
   *
   * The live store is an observation log — it holds whatever the model last looked at. This takes a
   * reading instead, which is the difference between "blocked as of four minutes ago" and "blocked".
   * Returns null when the host gave this load no reader, or when the terminal is not this session's.
   */
  async readScreen(key: string, sessionId: string | null): Promise<string | null> {
    const entry = this.live.byKey(key)
    if (!entry || !this.terminalRead) return null
    const screen = await this.terminalRead.screen({ sessionId, terminalId: entry.terminalId })
    if (!screen) return null
    // A fresh reading is also an observation: folding it back in means the roster and any waiter
    // see it too, rather than it being known only to whoever asked.
    this.live.observeScreen(entry.terminalId, screen.text)
    return screen.text
  }

  async start(): Promise<void> {
    await this.manifests.loadOverrides()
  }

  shutdown(): void {
    for (const timer of this.timers) clearTimeout(timer)
    this.timers.clear()
    this.history.close()
  }

  /** Hook entrypoint — see live/observe.ts for why observation is the whole live mechanism. */
  handleToolCall(event: {
    toolName: string
    input: unknown
    result: { content: string; details?: unknown }
    sessionId: string
  }): void {
    observeToolCall(
      {
        live: this.live,
        log: this.log,
        onOpened: (terminalId) => this.scheduleCorrelation(terminalId),
      },
      event,
    )
  }

  /**
   * Correlation is retried on a decaying schedule because a transcript does not exist at the
   * instant the terminal opens. Timers are tracked so shutdown can cancel them.
   */
  private scheduleCorrelation(terminalId: string, attempt = 0): void {
    if (attempt >= CORRELATE_ATTEMPT_DELAYS_MS.length) return
    const timer = setTimeout(() => {
      this.timers.delete(timer)
      void this.tryCorrelate(terminalId).then((adopted) => {
        if (!adopted) this.scheduleCorrelation(terminalId, attempt + 1)
      })
    }, CORRELATE_ATTEMPT_DELAYS_MS[attempt])
    this.timers.add(timer)
  }

  private async tryCorrelate(terminalId: string): Promise<boolean> {
    const entry = this.live.get(terminalId)
    if (!entry || entry.nativeSessionId || entry.closed) return true
    const adapter = adapterFor(entry.provider)
    if (!adapter) return true
    // The launch cwd is what makes correlation unambiguous when two agents of the same provider
    // start seconds apart (see live/correlate.ts). It is absent whenever the launch command did not
    // announce a directory, and `correlateOnce` only narrows by a cwd that leaves candidates, so
    // passing it through is strictly better than the `undefined` this call used to hardcode.
    const result = await correlateOnce(this.index, adapter, this.live, terminalId, entry.cwd)
    if (result.adopted) {
      this.log(`agent-sessions: terminal ${terminalId} ${result.reason}`)
      return true
    }
    return false
  }

  async providers(): Promise<readonly ProviderStatus[]> {
    const indexes = await Promise.all(
      this.availableAdapters().map((adapter) => this.index.scan(adapter)),
    )
    return indexes.map((i) => i.status)
  }

  /**
   * The roster is machine-wide: every provider's on-disk history plus every live delegation,
   * whoever is asking. `_localixSessionId` is still accepted because callers (the resource
   * provider's port, the HTTP route) hand their scope through, but no row is relative to it now
   * that a session-to-session relation no longer exists.
   */
  async roster(query: RosterQuery, localixSessionId?: string): Promise<Bounded<RosterRow>> {
    // Refresh the LIVE rows before listing them. Without this the roster is a fresh list of stale
    // states: the panel re-fetches every few seconds while something is running, but a delegation's
    // state came from whatever the model last happened to screen, so the list moved and the states
    // did not. Bounded by construction — one VT render per live delegation, of panes already in
    // memory, and there are only ever a handful.
    await this.refreshLiveStates(localixSessionId ?? null)
    // Only scan the providers the query actually asks about: filtering by provider should make the
    // request cheaper, not just the result shorter.
    const wanted = query.providers?.length
      ? this.availableAdapters().filter((a) => query.providers?.includes(a.id))
      : this.availableAdapters()
    if (!wanted.length) return { items: [], total: 0, withheld: 0 }
    const indexes = await Promise.all(wanted.map((a) => this.index.scan(a)))
    const summaries = indexes.flatMap((i) => i.summaries)
    return buildRoster({
      summaries,
      live: this.live,
      query: { ...query, providers: wanted.map((adapter) => adapter.id) },
      includeChildren: query.includeChildren,
    })
  }

  /**
   * Statistics over discovered history. Reads the SAME index the roster reads — a summary fold, not
   * a second scan — so opening the stats view costs no disk beyond what was already paid for.
   */
  async stats(query: StatsQuery): Promise<ExternalAgentStats> {
    // ALWAYS every provider, even under a provider filter — unlike the roster, which narrows its
    // scan to what was asked for. The agent distribution is the control you drill WITH, so it has
    // to keep showing the agents you are not currently looking at. Narrowing here would make that
    // impossible and buys nothing: this is the same warm index the roster already paid for.
    const indexes = await Promise.all(this.availableAdapters().map((a) => this.index.scan(a)))
    return computeStats(
      indexes.flatMap((i) => i.summaries),
      query,
      Date.now(),
    )
  }

  /** Re-read every live delegation of this session, when the host gave this load a reader. */
  private async refreshLiveStates(sessionId: string | null): Promise<void> {
    if (!this.terminalRead) return
    const entries = this.live.list(sessionId ?? undefined)
    await Promise.all(
      entries.map((entry) =>
        this.terminalRead!.screen({ sessionId, terminalId: entry.terminalId })
          .then((screen) => {
            if (screen) this.live.observeScreen(entry.terminalId, screen.text)
          })
          // A pane that vanished between listing and reading is not an error worth failing a
          // roster over; its own `close` observation will land through the hook.
          .catch(() => undefined),
      ),
    )
    await this.refreshTurnStates(entries)
  }

  /**
   * Where the screen said nothing, ask the agent's own log.
   *
   * Only for entries the manifest degraded (`fallbackReason`) and that have been correlated to a
   * transcript — for Claude Code that is every non-blocked screen, which is why a wait could settle
   * on a working delegation. The read is the LAST 64 KB of an append-only file, so it costs the same
   * whether the session is a minute or a month old.
   */
  private async refreshTurnStates(entries: readonly LiveEntry[]): Promise<void> {
    await Promise.all(entries.map((entry) => this.readTurn(entry)))
  }

  /**
   * One delegation's log, folded back into the live store like a screen reading is.
   *
   * Public for the same reason `readScreen` is: `wait` needs it per key. A wait evaluates its
   * condition BEFORE its first poll — the right rule, since a condition that
   * already holds must not block — so a wait that only read transcripts on its ticks would still
   * settle instantly on the degraded `idle` this exists to replace.
   */
  async readTurn(entry: LiveEntry): Promise<void> {
    const speaksHere = entry.explain.fallbackReason || entry.explain.authority === 'transcript'
    if (entry.closed || !speaksHere || !entry.nativeSessionId) return
    const now = Date.now()
    const key = linkKeyOf({ provider: entry.provider, nativeSessionId: entry.nativeSessionId })
    try {
      const found = await this.turnSource(key)
      // The ADAPTER decides how its own storage answers — an appending log's last records, a row
      // that says the session ended, or nothing at all. A provider that cannot answer keeps the
      // manifest's degraded state with its stated reason, which is the honest outcome.
      if (!found?.adapter.readTurnState) return
      const state = await found.adapter.readTurnState(found.ref, this.env, now)
      if (state) this.live.observeTurn(entry.terminalId, state, now)
    } catch {
      // A transcript that cannot be read is simply no evidence; the degraded state stands. Forget
      // where it was, so a log that moved is looked for again rather than missed for good.
      this.turnSources.delete(key)
    }
  }

  /**
   * Where a delegation's log lives, enumerated ONCE. `findSource` lists the provider's whole
   * history to find one file, and a wait asked it on every tick for every waited key — ~2,000 stats
   * every 2 s per key to re-find a path that never changes for the life of a session.
   */
  private async turnSource(key: string) {
    const known = this.turnSources.get(key)
    if (known) return known
    const found = await this.findSource(key)
    if (found) this.turnSources.set(key, found)
    return found
  }

  /** The waited keys' logs, for the keys that have a live entry at all. */
  private async readTurnsFor(keys: readonly string[]): Promise<void> {
    const entries = keys
      .map((key) => this.live.byKey(key))
      .filter((entry): entry is LiveEntry => entry !== undefined)
    await Promise.all(entries.map((entry) => this.readTurn(entry)))
  }

  async explain(key: string): Promise<StateExplain | null> {
    const entry = this.live.byKey(key)
    return entry ? entry.explain : null
  }

  private async findSource(key: string): Promise<{
    adapter: ProviderAdapter
    ref: Awaited<ReturnType<ProviderAdapter['listSources']>>[number]
  } | null> {
    const parsed = parseLinkKey(key)
    if (!parsed) return null
    const adapter = adapterFor(parsed.provider)
    if (!adapter || !this.availableAdapters().includes(adapter)) return null
    const refs = await adapter.listSources(this.env)
    const ref = refs.find((r) => r.nativeSessionId === parsed.nativeSessionId)
    return ref ? { adapter, ref } : null
  }

  private availableAdapters(): readonly ProviderAdapter[] {
    const ids = this.availableProviders?.()
    return ids ? PROVIDER_ADAPTERS.filter((adapter) => ids.includes(adapter.id)) : PROVIDER_ADAPTERS
  }

  async transcript(
    key: string,
    maxEvents?: number,
    maxCharsPerEvent?: number,
    /** Read the session's END rather than its opening. Free — see adapters/event-window.ts. */
    tail?: boolean,
    /** Start at this ordinal — the only way to reach the middle of a session past the event cap. */
    from?: number,
  ): Promise<TranscriptSlice | null> {
    const found = await this.findSource(key)
    if (!found) return null
    const { adapter, ref } = found
    const [summary] = await adapter.readSummaries([ref], this.env)
    if (!summary) return null
    const limit = Math.min(Math.max(1, maxEvents ?? DEFAULT_MAX_EVENTS), MAX_TRANSCRIPT_EVENTS)
    const result = await adapter.readTranscript(
      {
        ref,
        maxEvents: limit,
        maxCharsPerEvent: maxCharsPerEvent ?? DEFAULT_MAX_EVENT_CHARS,
        ...(tail ? { tail: true } : {}),
        ...(from ? { from } : {}),
      },
      this.env,
    )
    return {
      key,
      summary,
      events: result.events,
      withheld: Math.max(0, result.total - result.events.length),
      total: result.total,
      ...(result.sourceTruncated ? { sourceTruncated: true } : {}),
      // Recorded here rather than in six adapters: this is the request that produced the slice, and
      // every adapter honours it through `eventWindow`.
      readFrom: tail === true ? 'tail' : 'head',
    }
  }

  /**
   * Pull context from SEVERAL sessions at once. See context/compose.ts for the ordering decision.
   *
   * Reads each session's END by default, which is the opposite of `transcript`. The reason is the
   * ratio: pulling the five largest sessions of a real history delivered 175 of 23,147 events (0.76%),
   * so the end you read is not a detail of the answer, it IS the answer. Someone naming five
   * sessions at once is asking where those agents got to — `transcript` stays head-first because
   * reading ONE session to learn what it was asked is a real use, and this is not it. Pass
   * `tail: false` for the openings; either way each section states which positions it holds.
   */
  async context(
    keys: readonly string[],
    budgetChars?: number,
    tail?: boolean,
  ): Promise<ComposeResult> {
    const slices: TranscriptSlice[] = []
    // ONE section per session, however many times it was named.
    //
    // A repeated key used to be read again, rendered again, and charged against the budget again:
    // measured on a real session, passing one key three times produced three identical sections and
    // 10,665 characters where 3,435 were warranted. Assembling `keys` from two places is the
    // ordinary way that happens, and the cost falls on the OTHER sessions, whose fair share shrinks
    // to pay for a copy. The FIRST occurrence is the one kept; where its section then lands is
    // `compose`'s business, which orders by recency and breaks ties on the key so the text a model
    // sees is stable across calls.
    const seen = new Set<string>()
    const unique = keys.filter((key) => (seen.has(key) ? false : (seen.add(key), true)))
    /**
     * Read in PARALLEL, in the order asked.
     *
     * Each read enumerates its provider's sources to find the file — 6 ms for the 1,177 Claude Code
     * sessions of a real history, 3 ms for Codex — and serially that repeated once per key: measured
     * at 136 ms for two sessions and 263 ms for twelve, most of the difference being enumerations
     * waiting on each other. The reads touch different files and share nothing, so the only reason
     * they were sequential is that a `for` loop is the shorter thing to write.
     */
    const read = await Promise.all(
      unique.map((key) => this.transcript(key, undefined, undefined, tail ?? true)),
    )
    for (const slice of read) if (slice) slices.push(slice)
    return compose(slices, budgetChars ?? DEFAULT_BUDGET_CHARS)
  }

  /**
   * Wait for the listed sessions to settle — and READ them while waiting.
   *
   * Waiters wake on `live.onChange`, and until the host exposed a terminal reader the only thing
   * that fired it was the model running a `bash` terminal action. During a wait the model is
   * blocked inside this very call and runs nothing, so a state change detected FROM THE SCREEN
   * could not arrive: a wait on "blocked" for a screen-detected agent could only ever end at its
   * timeout. Reports and a closed terminal still woke it, which is why the gap was not obvious.
   *
   * So the wait polls the panes it is waiting on. Only those, only while it is waiting, and only
   * when the host gave this load a reader — everywhere else the previous behaviour is unchanged.
   */
  async wait(
    request: WaitRequest,
    signal?: AbortSignal,
    sessionId?: string | null,
  ): Promise<WaitOutcome> {
    // BEFORE the first evaluation, not on the first tick: a wait returns immediately when its
    // condition already holds, and for a screen-detected agent the condition it holds is the
    // manifest's degraded `idle` — which is the very reading this replaces. Reading the logs first
    // is what turns "settled instantly" into "settled when the turn actually ended".
    await this.readTurnsFor(request.keys)

    /**
     * Two independent readers, and the poll must not be gated on the terminal one.
     *
     * It was: `if (!this.terminalRead) return` sat above the timer, so a load without a reader
     * polled nothing — and the transcript reader needs no terminal at all. A delegation that
     * finished mid-wait was then only noticed at the next roster, which during a wait is never.
     */
    const watched = request.keys.filter((key) => this.live.byKey(key))
    if (!this.terminalRead && watched.length === 0) return waitForStates(this.live, request, signal)

    // Slower than a screen redraw and far faster than a human notices: the point is to observe a
    // transition, not to animate one. Each tick is a VT render of panes already in memory, plus the
    // tail of each waited log — a screen that says nothing and a file that does must both be read.
    const timer = setInterval(() => {
      void Promise.all([
        ...(this.terminalRead
          ? request.keys.map((key) => this.readScreen(key, sessionId ?? null).catch(() => null))
          : []),
        this.readTurnsFor(request.keys).catch(() => null),
      ])
    }, WAIT_POLL_MS)
    this.timers.add(timer as unknown as ReturnType<typeof setTimeout>)
    // A log has a change event; the tick alone noticed a finished turn up to WAIT_POLL_MS late.
    // The screen has none (it is the host's in-memory pane), so the tick stays for it.
    const logs = new Set(
      request.keys.flatMap((key) => this.turnSources.get(key)?.ref.sourcePath ?? []),
    )
    const unwatch = watchFiles(
      [...logs],
      () => void this.readTurnsFor(request.keys).catch(() => null),
      { watchPath: this.pathWatch.watch },
    )
    try {
      return await waitForStates(this.live, request, signal)
    } finally {
      unwatch()
      clearInterval(timer)
      this.timers.delete(timer as unknown as ReturnType<typeof setTimeout>)
    }
  }
}
