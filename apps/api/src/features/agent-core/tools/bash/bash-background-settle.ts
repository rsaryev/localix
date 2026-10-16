/**
 * The early-output settle window of a background spawn, driven by its own output.
 *
 * It used to be an 80ms `setInterval` that asked "how long since the last chunk?" for the whole
 * window — ~37 wakeups for a job that printed one line, every one of them a no-op. The quiet
 * condition only changes when a chunk arrives, so the timer is now RESTARTED per chunk and
 * fires exactly when the window could close; before any output only the hard cap is armed.
 *
 * The rule itself is unchanged: return at `maxMs`; or once `minMs` has passed, the job has
 * printed something, and it has been quiet for `quietMs`; or the moment the job exits.
 */
export interface SettleWindow {
  minMs: number
  maxMs: number
  quietMs: number
}

export interface SettleSource {
  /** Resolves when the job exits. */
  exited: Promise<unknown>
  /** Register for output chunks; returns an unsubscribe. */
  onChunk(listener: () => void): () => void
  /** Whether the job has printed anything yet (output that predates the window counts). */
  hasOutput(): boolean
  /** Epoch ms of the latest chunk, or 0 when none. */
  lastChunkAt(): number
}

export function awaitBackgroundSettle(
  source: SettleSource,
  window: SettleWindow,
  startMs: number,
): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false
    let quietTimer: ReturnType<typeof setTimeout> | undefined
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(capTimer)
      clearTimeout(quietTimer)
      offChunk()
      resolve()
    }
    // The earliest the quiet rule can hold: after the minimum, and quietMs past the last chunk.
    const armQuiet = () => {
      if (settled || !source.hasOutput()) return
      clearTimeout(quietTimer)
      const now = Date.now()
      const at = Math.max(
        startMs + window.minMs,
        (source.lastChunkAt() || startMs) + window.quietMs,
      )
      quietTimer = setTimeout(finish, Math.max(0, at - now))
    }
    const capTimer = setTimeout(finish, Math.max(0, startMs + window.maxMs - Date.now()))
    const offChunk = source.onChunk(armQuiet)
    void source.exited.then(finish, finish)
    armQuiet()
  })
}
