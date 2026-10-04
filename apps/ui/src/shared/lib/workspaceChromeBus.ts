/**
 * One-way "collapse the workspace chrome" channel. A sibling slice (e.g. a
 * distraction-free `localix <file>` open) can ask the page shell to hide the
 * surrounding chrome — the left sidebar — so only the editor remains, without
 * importing the page or reaching into its local state.
 *
 * Mirrors {@link sidebarSectionBus} / {@link inspectorBus}: coordination through
 * `shared` keeps the dependency arrow one-directional (widgets/features → shared ←
 * pages). The page subscribes once and applies it to its own layout state.
 */

type ChromeListener = () => void

const listeners = new Set<ChromeListener>()

/** Ask the page shell to collapse the workspace chrome (close the sidebar). */
export function collapseWorkspaceChrome(): void {
  listeners.forEach((listener) => listener())
}

/** Subscribe to collapse requests; returns an unsubscribe for teardown/HMR. */
export function subscribeWorkspaceChrome(listener: ChromeListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
