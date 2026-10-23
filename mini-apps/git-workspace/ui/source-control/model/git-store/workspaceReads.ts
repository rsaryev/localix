/**
 * The store's READ side: the polled workspace snapshot, and switching which repo
 * it describes. Writes live in `mutations.ts`; this module never writes git.
 */
import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'
import type { SourceControlApi } from './mutations'
import { EMPTY_SESSION, pickActiveRepo, type SessionGitState } from './sessionState'
import { keepFocusedStatus, keepRepos, sameJson } from './snapshotIdentity'

interface ReadTarget {
  bySession: Record<string, SessionGitState>
  refresh: (sessionId: string) => Promise<void>
}

type Set<S> = (fn: (s: S) => S | Partial<S>) => void

export interface WorkspaceReads {
  /** Re-fetch repos + the active repo's status/branches. Safe to call concurrently — overlapping calls de-dupe. */
  refresh: (sessionId: string) => Promise<void>
  /**
   * Re-fetch after any already-running poll. Correctness-sensitive consumers
   * (the commit completion gate) use this so a poll started before the field was
   * focused cannot count as its fresh context read.
   */
  refreshFresh: (sessionId: string) => Promise<void>
  /** Focus a repo (multi-root) and re-read its status/branches. No-op when already active. */
  setActiveRepo: (sessionId: string, repoRoot: string) => Promise<void>
}

export function createWorkspaceReads<S extends ReadTarget>(
  api: SourceControlApi,
  set: Set<S>,
  get: () => S,
): WorkspaceReads {
  /**
   * The workspace read currently in flight per session, and WHICH repo focus it
   * speaks for.
   *
   * De-duping on the session alone (the Promise, not just a flag) meant a focus
   * change had to WAIT OUT the previous repo's poll: joining it would have
   * returned the old repo's snapshot, which the write guard then discards,
   * leaving the newly selected repo unread. Keyed on the focus too, a switch
   * issues its own read at once and the two are told apart when they land —
   * clicking another repository stopped costing a poll interval.
   */
  const inFlight = new Map<string, { focus: string | null; promise: Promise<void> }>()

  const writeSlice = (s: S, sessionId: string, next: SessionGitState): Partial<S> =>
    ({ bySession: { ...s.bySession, [sessionId]: next } }) as Partial<S>

  async function read(sessionId: string, prev: SessionGitState | undefined): Promise<void> {
    if (!prev) set((s) => writeSlice(s, sessionId, { ...EMPTY_SESSION, loading: true }))
    // The focus this read speaks for. Everything it returns is written back only
    // while the session is STILL focused here — a repo switch that lands
    // mid-flight makes this snapshot describe the wrong tree, and `setActiveRepo`
    // issues the authoritative read for the new one.
    const selectionOwner = prev?.activeRepo ?? null
    try {
      const snapshot = await api.getWorkspace(sessionId, selectionOwner ?? undefined)
      // A transient re-scan failure must not throw away a repository the user
      // already selected: keep the cached inventory when discovery came back
      // empty but we know better. On the FIRST load there is no trustworthy
      // snapshot, so an empty list is simply the truth.
      const cached = get().bySession[sessionId]?.repos ?? prev?.repos ?? []
      const repos =
        snapshot.repos.length === 0 &&
        snapshot.status.isRepo &&
        cached.some((repo) => repo.root === snapshot.status.root)
          ? cached
          : snapshot.repos
      const activeRepo = pickActiveRepo(repos, snapshot.activeRepo ?? selectionOwner)
      // Identity-preserving write: most ticks return the same git state, so keep
      // every unchanged field ref (downstream memos keyed on `status` still bail)
      // and skip the set() entirely when nothing changed — zero re-renders.
      set((s) => {
        const cur = s.bySession[sessionId]
        if ((cur?.activeRepo ?? null) !== selectionOwner) return s
        const keptRepos = keepRepos(cur?.repos ?? [], repos)
        const next: SessionGitState = {
          status: keepFocusedStatus(cur?.status ?? null, snapshot.status, keptRepos),
          branches: sameJson(cur?.branches, snapshot.branches)
            ? (cur?.branches ?? null)
            : snapshot.branches,
          stashes: sameJson(cur?.stashes, snapshot.stashes)
            ? (cur?.stashes ?? [])
            : snapshot.stashes,
          repos: keptRepos,
          activeRepo,
          loading: false,
          error: null,
        }
        const unchanged =
          cur !== undefined &&
          next.status === cur.status &&
          next.branches === cur.branches &&
          next.stashes === cur.stashes &&
          next.repos === cur.repos &&
          cur.activeRepo === activeRepo &&
          !cur.loading &&
          cur.error === null
        return unchanged ? s : writeSlice(s, sessionId, next)
      })
    } catch (err) {
      const message = errorMessage(err, 'Could not read source control.')
      set((s) => {
        const current = s.bySession[sessionId]
        if ((current?.activeRepo ?? null) !== selectionOwner) return s
        return writeSlice(s, sessionId, {
          ...(current ?? EMPTY_SESSION),
          loading: false,
          error: message,
        })
      })
    }
  }

  return {
    refresh(sessionId) {
      if (!sessionId) return Promise.resolve()
      const prev = get().bySession[sessionId]
      const focus = prev?.activeRepo ?? null
      const existing = inFlight.get(sessionId)
      // Join an in-flight read only when it describes the SAME focus. A read for
      // the repo we just left cannot answer for the one we just picked.
      if (existing?.focus === focus) return existing.promise
      const entry: { focus: string | null; promise: Promise<void> } = {
        focus,
        promise: read(sessionId, prev).finally(() => {
          // Only the entry this read owns clears itself; a newer focus has
          // already replaced it and must keep its own slot.
          if (inFlight.get(sessionId) === entry) inFlight.delete(sessionId)
        }),
      }
      inFlight.set(sessionId, entry)
      return entry.promise
    },

    async refreshFresh(sessionId) {
      if (!sessionId) return
      // Awaiting the tracked promise also awaits its `finally`, so the following
      // refresh cannot accidentally join the older read again.
      await inFlight.get(sessionId)?.promise.catch(() => undefined)
      await get().refresh(sessionId)
    },

    async setActiveRepo(sessionId, repoRoot) {
      if (get().bySession[sessionId]?.activeRepo === repoRoot) return
      set((s) => {
        const current = s.bySession[sessionId] ?? EMPTY_SESSION
        const selected = current.repos.find((repo) => repo.root === repoRoot)
        return writeSlice(s, sessionId, {
          ...current,
          activeRepo: repoRoot,
          // Switch the visible file set atomically with the focus. Branches and
          // stashes have no list-level snapshot, so clear them until the scoped
          // detail refresh lands rather than showing the previous repo.
          status: selected?.status ?? current.status,
          branches: null,
          stashes: [],
          error: null,
        })
      })
      // The authoritative read for the NEW focus, issued immediately: it is keyed
      // on that focus, so it neither joins nor waits for the previous repo's
      // poll, and whichever lands second is matched against the focus it owned
      // before it is allowed to write.
      await get().refresh(sessionId)
    },
  }
}
