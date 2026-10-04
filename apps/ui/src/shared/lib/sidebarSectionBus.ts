/**
 * One-way "open a workspace sidebar section" channel. Sibling slices (e.g. the
 * `.sql` file panel in the widgets layer) can ask the page shell to reveal a named
 * left-sidebar section — Files, Search, Database — without importing the page or the
 * router: the page subscribes once and routes the id through its section navigator.
 *
 * Mirrors {@link explorerBus} / {@link inspectorBus}: coordination through `shared`
 * keeps the dependency arrow one-directional (widgets/features → shared ← pages).
 */

type SectionListener = (sectionId: string | null) => void

const listeners = new Set<SectionListener>()

/** Ask the page shell to open the given sidebar section. */
export function openSidebarSection(sectionId: string | null): void {
  listeners.forEach((listener) => listener(sectionId))
}

/** Subscribe to section-open requests; returns an unsubscribe for teardown/HMR. */
export function subscribeSidebarSection(listener: SectionListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
