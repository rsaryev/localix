/**
 * One-way channel to drive the singleton Settings panel to a specific tab (and an
 * optional `data-settings-anchor` section) from anywhere — e.g. a global-search hit.
 * Mirrors {@link ./sidebarSectionBus}.
 *
 * It LATCHES the last target so an "open Settings, THEN navigate" sequence isn't lost
 * when the panel subscribes a tick after it mounts (activation opens the panel, then
 * fires this). The panel consumes the latch once applied, so a later plain reopen of
 * Settings doesn't re-navigate to a stale target.
 */
export interface SettingsNavTarget {
  /** A settings string tab id ('secrets' | 'plugins' | 'models' | 'general' | …). */
  tab: string
  /** Optional `data-settings-anchor` to scroll to + flash once the tab renders. */
  anchor?: string
  /** Optional nested entry id encoded after the section anchor. */
  entryId?: string
  /** Exact capability scope: '' is No project, otherwise a project id. */
  scope?: string
}

type Listener = (target: SettingsNavTarget) => void
const listeners = new Set<Listener>()
let latched: SettingsNavTarget | null = null

/** Request the Settings panel switch to `tab` (and optionally reveal `anchor`). */
export function navigateSettings(
  tab: string,
  anchor?: string,
  scope?: string,
  entryId?: string,
): void {
  const target = { tab, anchor, entryId, scope }
  latched = target
  // A listener may consume the latch while this notification is in progress.
  // Deliver the immutable event we started with, not the mutable latch: otherwise
  // every later listener in the same fan-out receives `null`.
  listeners.forEach((listener) => listener(target))
}

/** Subscribe; immediately receives the latched target (if any) so an already-fired
 *  navigate isn't missed when the panel mounts afterward. */
export function subscribeSettingsNav(listener: Listener): () => void {
  listeners.add(listener)
  if (latched) listener(latched)
  return () => listeners.delete(listener)
}

/** Clear the latch after the panel applied it (a later plain reopen stays neutral). */
export function consumeSettingsNav(): void {
  latched = null
}
