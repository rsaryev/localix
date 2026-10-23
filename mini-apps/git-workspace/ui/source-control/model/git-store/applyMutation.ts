import type { SourceControlMutation } from '../../../../backend/source-control/contracts'
import { EMPTY_SESSION, type SessionGitState } from './sessionState'

/** The two fields of the store a write's answer touches. */
export interface MutationTarget {
  bySession: Record<string, SessionGitState>
  logVersion: number
}

/**
 * Merge a write's own answer into the cached session slice — the ONLY repaint a
 * write needs.
 *
 * Each op used to apply its status and then `await refreshFresh(...)`: a second
 * wave of reads, queued behind whatever poll happened to be in flight, before the
 * UI could show what the click had done. A branch delete therefore appeared to
 * take as long as the slowest poll tick even though `git branch -d` is
 * instantaneous. The write already knows what it invalidated and now returns it
 * ({@link SourceControlMutation}), so the answer is applied directly:
 *
 *  - `status` is authoritative for the repo the op targeted;
 *  - `branches`/`stashes` are present exactly when that op could have changed
 *    them, and are written only when the targeted repo is the focused one (a
 *    background repo's branch list is not what the panel is showing);
 *  - the matching row of the repo INVENTORY is patched too, so the grouped
 *    multi-root tree agrees with the file panel without waiting for a re-scan;
 *  - `bumpsLog` advances `logVersion` in the SAME write, so the commit graph
 *    (which reads its own log) learns that refs moved in the render that shows
 *    the new status — not one render later.
 *
 * Discovery (which repos exist) is the one thing a write cannot know, and the
 * poller owns it.
 */
export function applyMutation<S extends MutationTarget>(
  set: (fn: (s: S) => Partial<S>) => void,
  sessionId: string,
  result: SourceControlMutation,
  bumpsLog: boolean,
): void {
  const { status, branches, stashes } = result
  set((s) => {
    const current = s.bySession[sessionId] ?? EMPTY_SESSION
    // A scoped mutation can finish after the user focused another repository, and
    // multi-root actions can target a repository that was never focused. Its
    // status is authoritative for THAT repo — record it in the inventory either
    // way, but only let it become the panel's status when it is the focused one.
    const focused = !current.activeRepo || status.root === current.activeRepo
    const repos = status.root
      ? current.repos.map((repo) =>
          repo.root === status.root && repo.status !== status ? { ...repo, status } : repo,
        )
      : current.repos
    const next: SessionGitState = {
      ...current,
      repos,
      ...(focused
        ? {
            status,
            ...(branches ? { branches } : {}),
            ...(stashes ? { stashes } : {}),
            error: null,
          }
        : {}),
    }
    return {
      bySession: { ...s.bySession, [sessionId]: next },
      ...(bumpsLog ? { logVersion: s.logVersion + 1 } : {}),
    } as Partial<S>
  })
}
