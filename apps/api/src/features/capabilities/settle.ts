/**
 * "The wiring this mutation started has finished."
 *
 * Enabling a mini app does two things at different speeds: it commits the enable state
 * (immediate) and it re-wires every live host — channels, backend routes, monitors
 * (debounced, asynchronous). The revision is bumped BEFORE that re-wire, on purpose,
 * so no snapshot can be stamped with a pre-mutation number.
 *
 * That leaves one gap for a caller that wants to ANSWER with a snapshot: reading it
 * the instant the state is committed can describe a mini app whose backend is still
 * coming up. The stream poke already waits for the settle; this module lets a request
 * wait for the same signal, so `POST /rpc/capabilities/toggle` can hand back a
 * document that is true of the running system, not merely of the database.
 *
 * Deliberately timeout-bounded by the caller: a host that never settles must slow a
 * response down, never hang it.
 */

let waiters: Array<() => void> = []

/** Bound by the composition root to the backend host's settle hook. */
export function announceCapabilitiesSettled(): void {
  const pending = waiters
  waiters = []
  for (const resolve of pending) resolve()
}

/**
 * Resolve on the next settle, or after `timeoutMs`, whichever comes first. Resolves —
 * never rejects: a slow reconcile degrades the freshness of one answer, and a caller
 * that treated it as a failure would turn a working toggle into a visible error.
 */
export function whenCapabilitiesSettle(timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve) => {
    let done = false
    const settle = () => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(settle, timeoutMs)
    // Node/Bun: do not hold the process open for a settle that may never come.
    timer.unref?.()
    waiters.push(settle)
  })
}
