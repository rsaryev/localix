/**
 * Deliver only the newest value, one call at a time, and never the same value twice in a row.
 *
 * A pane drag measures the page every frame. Sending each measurement as its own native call lets
 * them queue behind a busy main thread, so the page replays sizes the pane has already left;
 * holding at most one pending value bounds the lag to a single step. The skip of repeats keeps the
 * observers that fire without a change (a resize event, a focus flip) off the bridge entirely.
 */
export function latestOnly<T>(
  send: (value: T) => Promise<unknown>,
  onError: (reason: unknown) => void,
): (value: T) => void {
  let pending: { value: T } | null = null
  let busy = false
  let lastSent: string | null = null

  async function drain(): Promise<void> {
    busy = true
    while (pending) {
      const { value } = pending
      pending = null
      const key = JSON.stringify(value)
      if (key === lastSent) continue
      lastSent = key
      try {
        await send(value)
      } catch (reason) {
        // Resend the next value even if it equals this one: this one never landed.
        lastSent = null
        onError(reason)
      }
    }
    busy = false
  }

  return (value) => {
    pending = { value }
    if (!busy) void drain()
  }
}
