/**
 * The readings that fold what the host and the agent's own files say NOW back into the live store:
 * a delegation's current screen (or its end) and the state its transcript gives where the screen
 * said nothing. The service wires them; waits and the roster call them.
 */

import { stat } from 'node:fs/promises'
import type { TerminalRead } from '@localixai/mini-app-sdk/backend'
import type { AdapterEnv, ProviderAdapter, SourceRef } from '../adapters/types'
import { linkKeyOf } from './../../shared/identity'
import type { SessionSummary } from '../../shared/contracts'
import type { LiveEntry, LiveStore } from './store'

interface LiveReadingsDeps {
  readonly live: LiveStore
  readonly env: AdapterEnv
  /** The log each live delegation is tailed from, found once — see `turnSource`. */
  readonly turnSources: Map<string, { adapter: ProviderAdapter; ref: SourceRef }>
  /** The reader this load has, if any; it is read at each call because it can arrive later. */
  readonly terminalRead: () => TerminalRead | undefined
  readonly findSource: (key: string) => Promise<{
    adapter: ProviderAdapter
    ref: SourceRef
    summary: SessionSummary
  } | null>
}

export function createLiveReadings({
  live,
  env,
  turnSources,
  terminalRead,
  findSource,
}: LiveReadingsDeps) {
  /**
   * The delegation's CURRENT screen, read on demand.
   *
   * The live store is an observation log — it holds whatever the model last looked at. This takes a
   * reading instead, which is the difference between "blocked as of four minutes ago" and "blocked".
   * Returns null when the host gave this load no reader, or when the terminal is not this session's.
   */
  async function readScreen(key: string, sessionId: string | null): Promise<string | null> {
    const entry = live.byKey(key)
    const read = terminalRead()
    if (!entry || !read) return null
    const screen = await read.screen({ sessionId, terminalId: entry.terminalId })
    if (!screen) return null
    // A fresh reading is also an observation: folding it back in means the roster and any waiter
    // see it too, rather than it being known only to whoever asked.
    live.observeScreen(entry.terminalId, screen.text)
    return screen.text
  }

  /**
   * One delegation's screen, or its end. Only the model's own `bash close` used to close an entry,
   * so an agent that exited by itself, or whose pane the user closed, stayed live in the roster and
   * held every wait on it to its timeout. A retained final screen is the host saying it exited.
   */
  async function refreshEntry(sessionId: string | null, terminalId: string): Promise<void> {
    const read = terminalRead()
    if (!read) return
    const screen = await read.screen({ sessionId, terminalId })
    if (screen) {
      live.observeScreen(terminalId, screen.text)
      return
    }
    const final = await read.finalScreen({ sessionId, terminalId })
    if (!final) return
    live.observeScreen(terminalId, final.text)
    live.close(terminalId)
  }

  /**
   * Where a delegation's log lives, enumerated ONCE. `findSource` lists the provider's whole
   * history to find one file, and a wait asked it on every tick for every waited key — ~2,000 stats
   * every 2 s per key to re-find a path that never changes for the life of a session.
   */
  async function turnSource(key: string) {
    const known = turnSources.get(key)
    if (known) return known
    const found = await findSource(key)
    if (found) turnSources.set(key, found)
    return found
  }

  /**
   * One delegation's log, folded back into the live store like a screen reading is.
   *
   * A wait evaluates its condition BEFORE its first poll — the right rule, since a condition that
   * already holds must not block — so a wait that only read transcripts on its ticks would still
   * settle instantly on the degraded `idle` this exists to replace.
   */
  async function readTurn(entry: LiveEntry): Promise<void> {
    const speaksHere = entry.explain.fallbackReason || entry.explain.authority === 'transcript'
    if (entry.closed || !speaksHere || !entry.nativeSessionId) return
    const now = Date.now()
    const key = linkKeyOf({ provider: entry.provider, nativeSessionId: entry.nativeSessionId })
    try {
      const found = await turnSource(key)
      // The ADAPTER decides how its own storage answers — an appending log's last records, a row
      // that says the session ended, or nothing at all. A provider that cannot answer keeps the
      // manifest's degraded state with its stated reason, which is the honest outcome.
      if (!found?.adapter.readTurnState) return
      // The ref is kept for the life of the delegation, so its modification time is not: a stale
      // one would age every `working` reading past its evidence window within 90 s of the first.
      const { mtimeMs } = await stat(found.ref.sourcePath)
      const ref = { ...found.ref, updatedAtHint: mtimeMs }
      const state = await found.adapter.readTurnState(ref, env, now)
      if (state) live.observeTurn(entry.terminalId, state, now)
    } catch {
      // A transcript that cannot be read is simply no evidence; the degraded state stands. Forget
      // where it was, so a log that moved is looked for again rather than missed for good.
      turnSources.delete(key)
    }
  }

  /** The waited keys' logs, for the keys that have a live entry at all. */
  async function readTurnsFor(keys: readonly string[]): Promise<void> {
    const entries = keys
      .map((key) => live.byKey(key))
      .filter((entry): entry is LiveEntry => entry !== undefined)
    await Promise.all(entries.map((entry) => readTurn(entry)))
  }

  /** Re-read every live delegation of this session, when the host gave this load a reader. */
  async function refreshLiveStates(sessionId: string | null): Promise<void> {
    if (!terminalRead()) return
    const entries = live.list(sessionId ?? undefined)
    await Promise.all(
      entries.map((entry) =>
        refreshEntry(sessionId, entry.terminalId)
          // A pane that vanished between listing and reading is not an error worth failing a
          // roster over.
          .catch(() => undefined),
      ),
    )
    // Where the screen said nothing, ask the agent's own log. Only for entries the manifest
    // degraded (`fallbackReason`) and that have been correlated to a transcript — for Claude Code
    // that is every non-blocked screen, which is why a wait could settle on a working delegation.
    // The read is the LAST 64 KB of an append-only file, so it costs the same whether the session
    // is a minute or a month old.
    await Promise.all(entries.map((entry) => readTurn(entry)))
  }

  return { readScreen, refreshEntry, refreshLiveStates, readTurn, readTurnsFor }
}
