import { backoffMs } from '@localixai/agent/backoff'
import type { ExchangeStreamBackend, StreamChannel, StreamParams, StreamPayload } from './backend'

/**
 * Live-stream lifecycle for the trading workbench — the pooled, refcounted owner of the
 * long-lived `ccxt.pro` clients, modelled directly on the Kubernetes workbench's
 * {@link ../../kubernetes/backend/watch.KubeWatchRegistry}. Where that registry keys a
 * `kubectl -w` child per `(context, namespace)`, this one keys a WATCH LOOP per
 * `(connectionId, channel, symbol, timeframe)` — but the pooled resource is coarser: ONE
 * websocket client per `connectionId`, SHARED by all that connection's channels and
 * closed only when its last stream goes away.
 *
 * It is REFCOUNTED: a loop starts on the first subscriber and tears down when the last
 * leaves (after a short idle-TTL grace so a fast symbol flip doesn't thrash a reconnect).
 * A loop that throws is restarted with capped exponential backoff; while it is down the
 * registry broadcasts a `down` status so the client falls back to REST polling, then
 * `live` again once it recovers. Consecutive failures that never reach `live` (e.g. a bad
 * symbol, an auth reject on a private channel) are capped, after which the loop stops
 * respawning until a fresh subscribe resets the budget — the exact unbounded-loop guard
 * `KubeWatchRegistry` has.
 *
 * The client factory and the timers are injectable so tests drive the whole thing without
 * ccxt, a socket, or a real timer.
 */

/** A live status the registry broadcasts so a client knows to poll (`down`) or stop (`live`). */
export type StreamStatus = 'live' | 'down'

/** One framed update for a single stream. `data` carries an already-normalized payload;
 *  `status` carries the live/down transition. The UI imports this to demux the socket. */
export type TradingStreamFrame =
  | { kind: 'data'; channel: StreamChannel; symbol?: string; payload: StreamPayload }
  | { kind: 'status'; status: StreamStatus }

/** A single subscriber's frame sink. */
export interface TradingStreamSubscriber {
  onFrame: (frame: TradingStreamFrame) => void
}

/**
 * Builds (or returns null for) the streaming client for a CONNECTION. Composed by the
 * orchestrator from the trading service — it resolves the connection's config +
 * credentials and calls `createCcxtStreamBackend`. Kept connection-keyed (not
 * config-keyed) because the registry pools one client per `connectionId`, and null means
 * the venue has no live driver (the caller polls).
 */
export type ConnectionStreamFactory = (
  connectionId: string,
) => Promise<ExchangeStreamBackend | null>

/** The timer surface the registry needs, injectable so tests advance a fake clock. */
export interface StreamTimers {
  set(fn: () => void, ms: number): unknown
  clear(handle: unknown): void
}

const realTimers: StreamTimers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

export interface TradingStreamRegistryOptions {
  /** Builds the per-connection streaming client (null → venue has no live driver). */
  createStream: ConnectionStreamFactory
  /** Grace before tearing down a stream that lost its last subscriber (default 5s). */
  idleTtlMs?: number
  /** First restart delay after a loop ends unexpectedly (default 1s), doubled up to max. */
  backoffBaseMs?: number
  /** Cap on the restart backoff (default 15s). */
  backoffMaxMs?: number
  /** Delay before an alive-but-quiet loop is declared `live` (default 800ms). */
  liveAfterMs?: number
  /** Consecutive never-went-live failures tolerated before giving up (default 5). */
  maxImmediateFailures?: number
  /** Injectable timers (default real setTimeout/clearTimeout). */
  timers?: StreamTimers
}

/** Backoff delay for the Nth restart attempt: `base·2^(n-1)`, capped at `max`. Pure. */
export function backoffDelay(attempt: number, baseMs: number, maxMs: number): number {
  if (attempt <= 0) return 0
  return backoffMs(attempt - 1, { baseMs, maxMs })
}

/** Stable key for a stream: connection + channel + symbol + timeframe. Pure. */
export function streamKeyOf(connectionId: string, params: StreamParams): string {
  return [connectionId, params.channel, params.symbol ?? '', params.timeframe ?? ''].join('\n')
}

const DEFAULT_MAX_IMMEDIATE_FAILURES = 5

/** One pooled websocket client, shared by every stream of a `connectionId`. */
interface Client {
  refCount: number
  backend: ExchangeStreamBackend | null
  /** In-flight creation, shared so concurrent first-subscribers don't build two clients. */
  creating: Promise<ExchangeStreamBackend | null> | null
  closed: boolean
}

interface StreamEntry {
  connectionId: string
  params: StreamParams
  subscribers: Set<TradingStreamSubscriber>
  status: StreamStatus
  /** A loop is active OR reserved (starting / awaiting a scheduled restart) — a single
   *  guard so a concurrent subscribe never double-starts a loop. */
  running: boolean
  controller: AbortController | null
  attempts: number
  /** Consecutive IMMEDIATE failures (a loop that ended before going live). A dedicated
   *  counter, separate from `attempts` (the backoff exponent), so a permanent reject
   *  can't masquerade as healthy backoff churn. Reset by a live loop or a fresh subscribe. */
  immediateFailures: number
  /** The generation that last reached `live`; `liveGen === gen` in `onLoopEnd` ⇒ this loop
   *  genuinely came up (not an immediate failure). */
  liveGen: number
  stopped: boolean
  /** Monotonic generation, bumped on each (re)start so a stale loop callback from an
   *  aborted loop never mutates the entry after a restart. */
  gen: number
  restartTimer: unknown
  idleTimer: unknown
  liveTimer: unknown
}

export class TradingStreamRegistry {
  private readonly clients = new Map<string, Client>()
  private readonly entries = new Map<string, StreamEntry>()
  private readonly createStream: ConnectionStreamFactory
  private readonly idleTtlMs: number
  private readonly backoffBaseMs: number
  private readonly backoffMaxMs: number
  private readonly liveAfterMs: number
  private readonly maxImmediateFailures: number
  private readonly timers: StreamTimers

  constructor(options: TradingStreamRegistryOptions) {
    this.createStream = options.createStream
    this.idleTtlMs = options.idleTtlMs ?? 5000
    this.backoffBaseMs = options.backoffBaseMs ?? 1000
    this.backoffMaxMs = options.backoffMaxMs ?? 15000
    this.liveAfterMs = options.liveAfterMs ?? 800
    this.maxImmediateFailures = options.maxImmediateFailures ?? DEFAULT_MAX_IMMEDIATE_FAILURES
    this.timers = options.timers ?? realTimers
  }

  /** Number of live streams. Diagnostic/tests. */
  get size(): number {
    return this.entries.size
  }

  /** Number of pooled websocket clients. Diagnostic/tests. */
  get clientCount(): number {
    return this.clients.size
  }

  /**
   * Subscribe to a live stream. Spawns the loop on the first subscriber and (lazily) the
   * connection's websocket client. The subscriber is immediately told the current status
   * so a late joiner to an already-live stream knows to stop polling. Returns an
   * unsubscribe that tears the loop down once the last subscriber leaves.
   */
  subscribe(connectionId: string, params: StreamParams, sub: TradingStreamSubscriber): () => void {
    const key = streamKeyOf(connectionId, params)
    let entry = this.entries.get(key)
    if (!entry) {
      entry = {
        connectionId,
        params,
        subscribers: new Set(),
        status: 'down',
        running: false,
        controller: null,
        attempts: 0,
        immediateFailures: 0,
        liveGen: -1,
        stopped: false,
        gen: 0,
        restartTimer: null,
        idleTimer: null,
        liveTimer: null,
      }
      this.entries.set(key, entry)
      this.ensureClient(connectionId).refCount++
    }
    // A pending idle teardown is cancelled — someone came back.
    if (entry.idleTimer) {
      this.timers.clear(entry.idleTimer)
      entry.idleTimer = null
    }
    entry.subscribers.add(sub)
    // Tell the new subscriber where things stand right now.
    sub.onFrame({ kind: 'status', status: entry.status })
    // Start the loop if nothing is running or pending. A fresh subscribe clears the
    // immediate-failure budget so a stream that gave up is retried when someone looks again.
    if (!entry.running && entry.restartTimer === null) {
      entry.immediateFailures = 0
      entry.running = true // reserve the slot synchronously (start is async)
      void this.start(entry)
    }
    return () => this.unsubscribe(key, sub)
  }

  private unsubscribe(key: string, sub: TradingStreamSubscriber): void {
    const entry = this.entries.get(key)
    if (!entry) return
    entry.subscribers.delete(sub)
    if (entry.subscribers.size > 0) return
    // Last subscriber left — grace period, then tear down (a fast flip re-subscribes
    // within the window and reuses the running loop + client).
    if (entry.idleTimer) this.timers.clear(entry.idleTimer)
    entry.idleTimer = this.timers.set(() => this.teardown(key), this.idleTtlMs)
  }

  private teardown(key: string): void {
    const entry = this.entries.get(key)
    if (!entry) return
    entry.stopped = true
    if (entry.restartTimer) this.timers.clear(entry.restartTimer)
    if (entry.idleTimer) this.timers.clear(entry.idleTimer)
    if (entry.liveTimer) this.timers.clear(entry.liveTimer)
    entry.controller?.abort()
    this.entries.delete(key)
    this.releaseClient(entry.connectionId)
  }

  private ensureClient(connectionId: string): Client {
    let c = this.clients.get(connectionId)
    if (!c) {
      c = { refCount: 0, backend: null, creating: null, closed: false }
      this.clients.set(connectionId, c)
    }
    return c
  }

  /** Drop one reference to a connection's client; close it when the last stream leaves. */
  private releaseClient(connectionId: string): void {
    const c = this.clients.get(connectionId)
    if (!c) return
    c.refCount--
    if (c.refCount > 0) return
    this.clients.delete(connectionId)
    c.closed = true
    c.backend?.stop()
    void c.backend?.close()
  }

  private async start(entry: StreamEntry): Promise<void> {
    if (entry.stopped) {
      entry.running = false
      return
    }
    entry.gen++
    const gen = entry.gen
    const client = this.ensureClient(entry.connectionId)

    // Build the connection's client once, shared across its channels.
    if (!client.backend && !client.closed) {
      client.creating ??= this.createStream(entry.connectionId).catch(() => null)
      const built = await client.creating
      client.creating = null
      if (built && !client.closed) client.backend = built
      else if (built && client.closed) void built.close() // connection torn down mid-build
    }
    const backend = client.backend

    // teardown/stop may have happened during the await.
    if (entry.stopped || entry.gen !== gen) {
      entry.running = false
      return
    }
    // No live driver for this venue, or the client was closed, or the venue can't serve
    // this channel (incl. a private channel on a credential-less connection): stay `down`
    // (the client polls) and do NOT loop or restart.
    if (!backend || client.closed || !backend.supports(entry.params.channel)) {
      entry.running = false
      this.setStatus(entry, 'down')
      return
    }

    const controller = new AbortController()
    entry.controller = controller
    // Declare live after a brief settle if the loop is still up (a loop that rejects fast
    // ends before this fires, so it never falsely reads live).
    if (entry.liveTimer) this.timers.clear(entry.liveTimer)
    entry.liveTimer = this.timers.set(() => {
      if (entry.gen === gen && entry.running) this.markLive(entry, gen)
    }, this.liveAfterMs)

    const onEnd = () => this.onLoopEnd(entry, gen)
    backend
      .watch(
        entry.params,
        (payload) => {
          if (entry.gen !== gen) return // superseded by a restart
          if (entry.status !== 'live') this.markLive(entry, gen) // first data proves it works
          const frame: TradingStreamFrame = {
            kind: 'data',
            channel: entry.params.channel,
            symbol: entry.params.symbol,
            payload,
          }
          for (const s of entry.subscribers) s.onFrame(frame)
        },
        controller.signal,
      )
      .then(onEnd, onEnd)
  }

  /** This loop genuinely came up: reset the backoff exponent, record the live generation,
   *  broadcast. */
  private markLive(entry: StreamEntry, gen: number): void {
    if (entry.liveTimer) {
      this.timers.clear(entry.liveTimer)
      entry.liveTimer = null
    }
    entry.attempts = 0
    entry.liveGen = gen
    this.setStatus(entry, 'live')
  }

  private setStatus(entry: StreamEntry, status: StreamStatus): void {
    if (entry.status === status) return
    entry.status = status
    const frame: TradingStreamFrame = { kind: 'status', status }
    for (const s of entry.subscribers) s.onFrame(frame)
  }

  private onLoopEnd(entry: StreamEntry, gen: number): void {
    if (entry.gen !== gen) return // a newer loop already owns the entry
    if (entry.liveTimer) {
      this.timers.clear(entry.liveTimer)
      entry.liveTimer = null
    }
    entry.controller = null
    entry.running = false
    if (entry.stopped || entry.subscribers.size === 0) return
    // Unexpected end with subscribers still watching — degrade to polling.
    this.setStatus(entry, 'down')
    // A loop that never reached `live` before ending is an IMMEDIATE failure (a bad
    // symbol, a private-channel reject…). Track those consecutively; a live loop resets
    // it. Once the cap is hit, stop respawning and stay down until a fresh subscribe
    // resets the budget.
    if (entry.liveGen === gen) {
      entry.immediateFailures = 0
    } else {
      entry.immediateFailures++
      if (entry.immediateFailures >= this.maxImmediateFailures) return
    }
    entry.attempts++
    const delay = backoffDelay(entry.attempts, this.backoffBaseMs, this.backoffMaxMs)
    entry.running = true // reserve the slot across the scheduled restart
    entry.restartTimer = this.timers.set(() => {
      entry.restartTimer = null
      if (!entry.stopped && entry.subscribers.size > 0) void this.start(entry)
      else entry.running = false
    }, delay)
  }

  /** Tear down every stream and close every client — called on shutdown. */
  stopAll(): void {
    for (const key of this.entries.keys()) this.teardown(key)
    // Defensive: any orphan client (should be none after teardown) is closed once.
    for (const [id, c] of this.clients) {
      c.closed = true
      c.backend?.stop()
      void c.backend?.close()
      this.clients.delete(id)
    }
  }
}

/** Build a trading stream registry. See {@link TradingStreamRegistry}. */
export function createTradingStreamRegistry(
  options: TradingStreamRegistryOptions,
): TradingStreamRegistry {
  return new TradingStreamRegistry(options)
}
