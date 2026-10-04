/**
 * One-way signal to open the Event Center bell popover from anywhere —
 * e.g. a surface's "Details" button. The bell's open state is
 * local to {@link NotificationCenter}; it subscribes here and opens on signal.
 * Mirrors the minimal pub/sub of {@link ./settingsNavBus} (sans latch — the bell
 * lives in the always-mounted titlebar, so there's no subscribe-after-fire race).
 */
type Listener = (entryId?: string) => void
const listeners = new Set<Listener>()

/**
 * Request the Event Center popover open, optionally on one entry.
 *
 * The id matters because a surface now reports a problem in one line and defers the detail here: a
 * "Details" button that opened an unfiltered list would make the person hunt for the row they just
 * clicked through to.
 */
export function openNotificationCenter(entryId?: string): void {
  listeners.forEach((listener) => listener(entryId))
}

/** Subscribe to open requests; returns an unsubscribe. */
export function subscribeNotificationCenter(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
