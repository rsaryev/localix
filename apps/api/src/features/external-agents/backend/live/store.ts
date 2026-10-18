/**
 * Live delegation state, maintained by OBSERVING the host rather than by owning a PTY.
 *
 * The plugin cannot open or read a terminal directly — there is no terminal surface in the plugin
 * SDK (see README, "Missing core seam"). What it CAN see is every `bash` tool call the model
 * makes, through the `onPostToolCall` hook, whose `result.details` for a terminal action carries
 * `{ action, terminalId, command, screen }` — the same rendered `ScreenSnapshot` the model reads.
 * That is a complete input for screen detection, at zero extra cost, because the
 * screen was rendered for the model anyway.
 *
 * The consequence, stated honestly: this store only knows what the model looked at. A delegation
 * the model has not screened since it changed state shows its last observed state, with
 * `lastScreenAt` saying when that was. It is an observation log, not a poller.
 */

import type { AgentState, StateExplain } from '../../shared/state'
import type { ManifestRegistry } from '../detection/registry'
import { resolveState } from '../detection/evaluate'
import { adapterFor } from '../adapters/registry'
import { linkKeyOf } from '../../shared/identity'

export interface LiveEntry {
  readonly terminalId: string
  readonly localixSessionId: string
  readonly provider: string
  readonly launchCommand?: string
  /**
   * Where the agent was launched from, as DECLARED on the launch line, not inferred. Undefined
   * for a launch that did not declare it (a hand-typed `claude`, the tab-strip launcher), and
   * correlate.ts treats that as "do not constrain by cwd" rather than as an empty cwd.
   */
  readonly cwd?: string
  readonly launchedAt: number
  /**
   * Resolved native session id, once the delegation's transcript has been correlated on disk.
   * Undefined until then — a live agent is visible in the roster BEFORE its transcript exists.
   */
  nativeSessionId?: string
  screen?: string
  lastScreenAt: number
  /**
   * When the screen last CHANGED, which is not when it was last looked at.
   *
   * `lastScreenAt` says when we observed; this says when the agent last did anything visible. The
   * difference is the one signal that separates "idle because it finished" from "idle because it is
   * stuck", and Claude Code needs it most: its manifest yields no positive `working` state, so a busy
   * agent and a finished one both settle on the idle fallback. Symphony's reconciler measures the same
   * thing — elapsed time since the last agent event, not since the run started (SPEC.md:825).
   */
  lastChangeAt: number
  state: AgentState
  explain: StateExplain
  closed?: boolean
}

/**
 * Key for a live delegation whose native session id is not yet known. It is deliberately in the
 * same `provider:id` namespace as a real key so the roster, the link store and the wait primitives
 * need no special case — when correlation succeeds the entry is re-keyed and the pending key stops
 * being produced.
 */
export function pendingKeyFor(provider: string, terminalId: string): string {
  return linkKeyOf({ provider, nativeSessionId: `pending-terminal-${terminalId}` })
}

export function isPendingKey(key: string): boolean {
  return key.includes('pending-terminal-')
}

type Listener = (entry: LiveEntry) => void

/** How many closed terminals keep answering `done` for their key. */
export const MAX_CLOSED_KEPT = 64

export class LiveStore {
  private readonly manifests: ManifestRegistry
  private readonly byTerminal = new Map<string, LiveEntry>()
  private readonly listeners = new Set<Listener>()

  constructor(manifests: ManifestRegistry) {
    this.manifests = manifests
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(entry: LiveEntry): void {
    for (const listener of this.listeners) {
      try {
        listener(entry)
      } catch {
        // A listener must never be able to break state tracking.
      }
    }
  }

  keyOf(entry: LiveEntry): string {
    return entry.nativeSessionId
      ? linkKeyOf({ provider: entry.provider, nativeSessionId: entry.nativeSessionId })
      : pendingKeyFor(entry.provider, entry.terminalId)
  }

  get(terminalId: string): LiveEntry | undefined {
    return this.byTerminal.get(terminalId)
  }

  /**
   * The entry a key names. A pending key keeps naming its delegation after correlation adopts the
   * native session: a caller that started waiting before the transcript existed holds that key, and
   * losing the entry would read as `not-live` — which settles the wait while the agent starts up.
   */
  byKey(key: string): LiveEntry | undefined {
    for (const entry of this.byTerminal.values()) {
      if (this.keyOf(entry) === key || pendingKeyFor(entry.provider, entry.terminalId) === key)
        return entry
    }
    return undefined
  }

  list(localixSessionId?: string): readonly LiveEntry[] {
    const all = [...this.byTerminal.values()].filter((e) => !e.closed)
    return localixSessionId ? all.filter((e) => e.localixSessionId === localixSessionId) : all
  }

  open(input: {
    terminalId: string
    localixSessionId: string
    provider: string
    launchCommand?: string
    cwd?: string
  }): LiveEntry {
    const now = Date.now()
    const entry: LiveEntry = {
      terminalId: input.terminalId,
      localixSessionId: input.localixSessionId,
      provider: input.provider,
      launchCommand: input.launchCommand,
      cwd: input.cwd,
      launchedAt: now,
      lastScreenAt: now,
      lastChangeAt: now,
      state: 'unknown',
      explain: {
        state: 'unknown',
        authority: 'none',
        summary: 'The agent was just launched; no screen has been classified yet.',
        observedAt: now,
      },
    }
    this.byTerminal.set(input.terminalId, entry)
    this.emit(entry)
    return entry
  }

  /** Fold a newly observed screen into the entry and re-resolve its state. */
  observeScreen(terminalId: string, screen: string): LiveEntry | undefined {
    const entry = this.byTerminal.get(terminalId)
    if (!entry) return undefined
    const manifestId = adapterFor(entry.provider)?.detectionManifestId
    const now = Date.now()
    // Compared before it is replaced: a screen that redrew identically is not a change, and a working
    // agent's screen never redraws identically — a spinner or an elapsed counter moves every tick.
    if (entry.screen !== screen) entry.lastChangeAt = now
    entry.screen = screen
    entry.lastScreenAt = now
    entry.explain = resolveState({
      manifest: this.manifests.get(manifestId),
      screen,
      previous: entry.state,
      observedAt: now,
    })
    entry.state = entry.explain.state
    this.emit(entry)
    return entry
  }

  /**
   * The agent's own transcript, consulted ONLY where the screen manifest gave up.
   *
   * Guarded two ways, because this is evidence about a file and the question is about a terminal:
   * a matched rule wins (the manifest saw something positive), and a closed terminal is already
   * settled. What is left is exactly the degraded case — for Claude Code, every non-blocked
   * screen — where the alternative is `idle` with a stated guess.
   */
  observeTurn(
    terminalId: string,
    state: 'working' | 'idle',
    observedAt: number,
  ): LiveEntry | undefined {
    const entry = this.byTerminal.get(terminalId)
    if (!entry || entry.closed) return undefined
    // The manifest's silence, or this same reading's own answer. Requiring `fallbackReason` alone
    // LATCHED: the first reading replaces it, so the second was refused and a delegation that
    // finished mid-wait was never noticed — the wait ran to its timeout. A matched rule still wins,
    // because that is a different authority and it means the screen said something positive.
    if (!entry.explain.fallbackReason && entry.explain.authority !== 'transcript') return entry
    if (entry.state !== state) entry.lastChangeAt = observedAt
    entry.state = state
    entry.explain = {
      state,
      authority: 'transcript',
      summary:
        state === 'working'
          ? "No screen rule matched, and the agent's own transcript ends mid-turn: a tool call or a result with no answer after it."
          : "No screen rule matched, and the agent's own transcript ends with an answer, so the turn is over.",
      observedAt,
    }
    this.emit(entry)
    return entry
  }

  adopt(terminalId: string, nativeSessionId: string): LiveEntry | undefined {
    const entry = this.byTerminal.get(terminalId)
    if (!entry || entry.nativeSessionId) return entry
    entry.nativeSessionId = nativeSessionId
    this.emit(entry)
    return entry
  }

  close(terminalId: string): void {
    const entry = this.byTerminal.get(terminalId)
    if (!entry) return
    entry.closed = true
    // A closed terminal's agent is finished as far as any caller is concerned; waiters resolve.
    entry.state = 'done'
    entry.explain = {
      state: 'done',
      authority: 'screen-manifest',
      summary: 'The terminal hosting this agent was closed.',
      observedAt: Date.now(),
    }
    this.emit(entry)
    this.pruneClosed()
  }

  /**
   * A closed entry stays so a `wait` issued after the close still reads `done` for its key rather
   * than `not-live` — but only the most recent ones. Every closed terminal used to stay for the
   * life of the process, so a long-running app grew this map with each agent ever launched.
   */
  private pruneClosed(): void {
    const closed = [...this.byTerminal.entries()].filter(([, entry]) => entry.closed)
    for (const [terminalId] of closed.slice(0, Math.max(0, closed.length - MAX_CLOSED_KEPT))) {
      this.byTerminal.delete(terminalId)
    }
  }
}
