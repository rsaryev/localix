import type { ModPaneRef } from '@/shared/api/modsApi'

/**
 * Which pane a mod asked to bring forward (`$.ui.open({ focus: true })`): each such open grows the
 * pane's `focusRequest`, and the screen focuses the pane's tab once per request. What was
 * asked before this window first read the panes stays where it is: a restart opens nothing.
 */

const paneKey = (pane: Pick<ModPaneRef, 'instance' | 'id'>) => `${pane.instance}/${pane.id}`

export function createPaneFocus() {
  const seen = new Map<string, number>()
  let primed = false
  let requested: { instance: string; id: string; at: number } | null = null
  const listeners = new Set<() => void>()
  return {
    /** The panes asked forward since the last read, the latest last; none on the first read. */
    take(panes: readonly ModPaneRef[]): ModPaneRef[] {
      const asked = panes.filter(
        (pane) => primed && pane.focusRequest > (seen.get(paneKey(pane)) ?? 0),
      )
      for (const pane of panes) seen.set(paneKey(pane), pane.focusRequest)
      primed = true
      const last = asked.at(-1)
      if (last) {
        requested = { instance: last.instance, id: last.id, at: (requested?.at ?? 0) + 1 }
        for (const listener of listeners) listener()
      }
      return asked
    },
    /** The pane last asked forward, and a count that changes with each ask. */
    requested: () => requested,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
  }
}

/** The window's one record of asked panes. */
export const paneFocus = createPaneFocus()
