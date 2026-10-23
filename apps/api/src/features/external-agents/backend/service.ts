/**
 * The service: the one object that owns the index, the manifests and the live store, and the only
 * place the layers are wired together. Routes and tools are thin callers of this.
 */

import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import type { TerminalRead } from '@localixai/mini-app-sdk/backend'
import type { AdapterEnv, ProviderAdapter, SourceRef } from './adapters/types'
import { sessionResume } from './resume-session'
import { PROVIDER_ADAPTERS, adapterFor } from './adapters/registry'
import { SessionIndex } from './discovery/index-cache'
import { buildRoster } from './discovery/roster'
import { computeStats, type ExternalAgentStats, type StatsQuery } from './discovery/stats'
import { ManifestRegistry } from './detection/registry'
import { LiveStore, type LiveEntry } from './live/store'
import { correlateOnce } from './live/correlate'
import { scheduleCorrelationAttempt } from './live/correlation-scheduler'
import { observeToolCall } from './live/observe'
import { waitForStates, type WaitRequest, type WaitOutcome } from './live/waiters'
import { startWaitPoll } from './live/wait-poll'
import { HistoryWatch, hostWatchSlot, type WatchPath } from './live/history-watch'
import { compose, DEFAULT_BUDGET_CHARS, type ComposeResult } from './context/compose'
import { linkKeyOf, parseLinkKey } from './../shared/identity'
import {
  transcriptEventLimit,
  transcriptRequest,
  transcriptSlice,
  uniqueContextKeys,
} from './session-transcript'
import type {
  Bounded,
  SessionSummary,
  ProviderStatus,
  RosterQuery,
  RosterRow,
  StateExplain,
  TranscriptSlice,
} from '../shared/contracts'

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
  private stopped = false

  constructor(
    stateDir: string,
    log: (message: string) => void,
    /** Provider history roots. Defaults to this machine's home; tests can supply
     * an isolated home to avoid scanning real session histories. */
    env?: AdapterEnv,
    availableProviders?: () => readonly string[],
  ) {
    this.log = log
    this.availableProviders = availableProviders
    this.env = env ?? { env: process.env, homeDir: homedir() }
    this.manifests = new ManifestRegistry(stateDir, log)
    this.live = new LiveStore(this.manifests)
    this.index = new SessionIndex(PROVIDER_ADAPTERS, this.env, stateDir, log)
    // A closed delegation's log is never read again; keep only the live ones' locations.
    this.live.onChange((entry) => {
      if (entry.closed && entry.nativeSessionId)
        this.turnSources.delete(
          linkKeyOf({ provider: entry.provider, nativeSessionId: entry.nativeSessionId }),
        )
    })
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
    this.stopped = true
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
    // A correlation in flight at shutdown would otherwise schedule its retry onto a dead service.
    if (this.stopped) return
    scheduleCorrelationAttempt({
      attempt,
      timers: () => this.timers,
      correlate: () => this.tryCorrelate(terminalId),
      retry: () => this.scheduleCorrelation(terminalId, attempt + 1),
    })
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
   * Provider history and live delegations, filtered by the query's directory and provider.
   * The asking Localix session controls live screen refreshes, not which native rows exist.
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
        this.refreshEntry(sessionId, entry.terminalId)
          // A pane that vanished between listing and reading is not an error worth failing a
          // roster over.
          .catch(() => undefined),
      ),
    )
    await this.refreshTurnStates(entries)
  }

  /**
   * One delegation's screen, or its end. Only the model's own `bash close` used to close an entry,
   * so an agent that exited by itself, or whose pane the user closed, stayed live in the roster and
   * held every wait on it to its timeout. A retained final screen is the host saying it exited.
   */
  private async refreshEntry(sessionId: string | null, terminalId: string): Promise<void> {
    const read = this.terminalRead
    if (!read) return
    const screen = await read.screen({ sessionId, terminalId })
    if (screen) {
      this.live.observeScreen(terminalId, screen.text)
      return
    }
    const final = await read.finalScreen({ sessionId, terminalId })
    if (!final) return
    this.live.observeScreen(terminalId, final.text)
    this.live.close(terminalId)
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
      // The ref is kept for the life of the delegation, so its modification time is not: a stale
      // one would age every `working` reading past its evidence window within 90 s of the first.
      const { mtimeMs } = await stat(found.ref.sourcePath)
      const ref = { ...found.ref, updatedAtHint: mtimeMs }
      const state = await found.adapter.readTurnState(ref, this.env, now)
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

  /** A session's adapter, source and indexed summary — one coalesced scan, no listing per call. */
  private async findSource(key: string): Promise<{
    adapter: ProviderAdapter
    ref: SourceRef
    summary: SessionSummary
  } | null> {
    const parsed = parseLinkKey(key)
    if (!parsed) return null
    const adapter = adapterFor(parsed.provider)
    if (!adapter || !this.availableAdapters().includes(adapter)) return null
    const found = await this.index.find(adapter, parsed.nativeSessionId)
    return found ? { adapter, ...found } : null
  }

  private availableAdapters(): readonly ProviderAdapter[] {
    const ids = this.availableProviders?.()
    return ids ? PROVIDER_ADAPTERS.filter((adapter) => ids.includes(adapter.id)) : PROVIDER_ADAPTERS
  }

  /** Resolve native continuation without loading the conversation's events. */
  async nativeSummary(key: string) {
    return (await this.findSource(key))?.summary ?? null
  }

  async resume(key: string) {
    return sessionResume((await this.findSource(key))?.summary ?? null)
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
    const { adapter, ref, summary } = found
    const limit = transcriptEventLimit(maxEvents)
    const result = await adapter.readTranscript(
      transcriptRequest(ref, limit, maxCharsPerEvent, tail, from),
      this.env,
    )
    return transcriptSlice(key, summary, result, tail)
  }

  /** Read unique sessions in parallel and compose their context.
   * Defaults to each session's latest events; `tail: false` reads the openings.
   * The composer determines section order and enforces the character budget. */
  async context(
    keys: readonly string[],
    budgetChars?: number,
    tail?: boolean,
  ): Promise<ComposeResult> {
    const slices: TranscriptSlice[] = []
    const unique = uniqueContextKeys(keys)
    // Preserve request order while independent session reads run in parallel.
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
   * So the wait reads the panes it is waiting on — only those, only while it is waiting, and only
   * when the host gave this load a reader — on their output and exit (`live/wait-poll.ts`).
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

    // Two independent readers: the log one is never gated on the terminal one, or a load without
    // a terminal reader misses a delegation that finished mid-wait until the next roster.
    const watched = request.keys.filter((key) => this.live.byKey(key))
    if (!this.terminalRead && watched.length === 0) return waitForStates(this.live, request, signal)

    const stopReading = startWaitPoll({
      request,
      sessionId,
      hasTerminalRead: () => Boolean(this.terminalRead),
      watchScreen: this.terminalRead?.watch
        ? (key, askingSession, onEvent) => {
            const entry = this.live.byKey(key)
            if (!entry) return null
            return this.terminalRead!.watch!(
              { sessionId: askingSession, terminalId: entry.terminalId },
              onEvent,
            )
          }
        : undefined,
      readScreen: (key, askingSession) => this.readScreen(key, askingSession),
      readEnd: async (key, askingSession) => {
        const entry = this.live.byKey(key)
        if (entry) await this.refreshEntry(askingSession, entry.terminalId)
      },
      readTurnsFor: (keys) => this.readTurnsFor(keys),
      timers: () => this.timers,
      sourcePath: (key) => this.turnSources.get(key)?.ref.sourcePath,
      watchPath: () => this.pathWatch.watch,
    })
    try {
      return await waitForStates(this.live, request, signal)
    } finally {
      stopReading()
    }
  }
}
