import { create } from 'zustand'

/**
 * Single source of truth for which backend PTY terminals are currently ALIVE for
 * the active chat session. Fed by the composer's `useTerminalLiveness` poll (the
 * live-PTY registry — reload-safe, independent of the virtualized transcript),
 * SEEDED instantly by the `terminal.opened` push event (a PTY the agent just
 * spawned is alive before the next poll can know it), and read by:
 *  - the transcript tool cards, to disable their "Open terminal" action and show
 *    "Terminal closed" once a terminal's process has exited (so scrolling back to
 *    an old `bash open` / `terminal` card can never resurrect a dead pane);
 *  - the terminal bus wiring, to auto-adopt + reveal live terminals after a page
 *    reload (background terminals keep running server-side and must reconnect).
 */

/** How long an optimistic (push-seeded) id survives polls that don't confirm it.
 *  A poll snapshot may have been taken BEFORE the PTY spawned, so a fresh id must
 *  not be wiped by one stale `setIds`; one idle poll cycle later the registry has
 *  either confirmed it (it stays via the poll) or the PTY really died. */
const OPTIMISTIC_TTL_MS = 20_000

/** Push-seeded ids not yet confirmed by a poll → the time they were seeded. */
const optimistic = new Map<string, number>()

interface LiveTerminalsStore {
  ids: Set<string>
  /** Replace the live set from a registry poll; no-ops when unchanged so
   *  subscribers don't churn. Recently push-seeded ids (see `noteOpened`) are
   *  kept until confirmed or expired, so a poll snapshot that predates a fresh
   *  PTY can't flash it "closed". */
  setIds: (ids: string[], now?: number) => void
  /** Seed a PTY the agent just spawned (`terminal.opened` push) as alive NOW,
   *  ahead of the next registry poll. */
  noteOpened: (id: string, now?: number) => void
  /** Remove a PTY immediately on the server's `terminal.finished` push instead
   *  of leaving controls enabled until the next registry poll. */
  noteFinished: (id: string) => void
}

export const useLiveTerminalsStore = create<LiveTerminalsStore>((set) => ({
  ids: new Set(),
  setIds: (ids, now = Date.now()) =>
    set((s) => {
      // Poll confirmation supersedes the optimistic seed; expired seeds drop.
      for (const [id, seededAt] of optimistic) {
        if (ids.includes(id) || now - seededAt > OPTIMISTIC_TTL_MS) optimistic.delete(id)
      }
      const next = new Set(ids)
      for (const id of optimistic.keys()) next.add(id)
      if (next.size === s.ids.size && [...next].every((id) => s.ids.has(id))) return s
      return { ids: next }
    }),
  noteOpened: (id, now = Date.now()) =>
    set((s) => {
      optimistic.set(id, now)
      if (s.ids.has(id)) return s
      return { ids: new Set(s.ids).add(id) }
    }),
  noteFinished: (id) =>
    set((s) => {
      optimistic.delete(id)
      if (!s.ids.has(id)) return s
      const next = new Set(s.ids)
      next.delete(id)
      return { ids: next }
    }),
}))

/** Reactive "is this backend terminal still alive?" for a transcript card. */
export function useIsTerminalLive(id: string | undefined): boolean {
  return useLiveTerminalsStore((s) => (id ? s.ids.has(id) : false))
}
