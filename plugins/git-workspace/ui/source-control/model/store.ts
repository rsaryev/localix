/**
 * The shared source-control store: one cached slice per chat session, the
 * polled read that fills it, and every write — each applied from its own answer.
 *
 * Composed from `git-store/`, one question per module: what a slice IS
 * (`sessionState`), when a poll changed nothing (`snapshotIdentity`), how the
 * read and the repo focus work (`workspaceReads`), which writes exist and which
 * of them move refs (`mutations`), and how a write's answer lands
 * (`applyMutation`). Consumers subscribe through the narrow hooks at the bottom
 * of this file rather than the whole slice.
 */
import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { sourceControlApi as defaultSourceControlApi } from '../../api'
import { applyMutation } from './git-store/applyMutation'
import { headStamp } from './git-store/headStamp'
import {
  MUTATIONS,
  type MutationMethods,
  type MutationSpec,
  type SourceControlApi,
} from './git-store/mutations'
import { EMPTY_SESSION, type SessionGitState } from './git-store/sessionState'
import { createWorkspaceReads, type WorkspaceReads } from './git-store/workspaceReads'

export type { SessionGitState } from './git-store/sessionState'
export { sourceControlFileStamp } from './git-store/fileStamp'

export interface SourceControlStore extends WorkspaceReads, MutationMethods {
  bySession: Record<string, SessionGitState>
  /**
   * Monotonic counter bumped by every write that moves HEAD or a ref the graph
   * decorates (`MUTATIONS[*].bumpsLog`). The commit-log graph fetches its OWN
   * log, so it watches this to know when to re-read after an op fired from
   * OUTSIDE it (the header, the commit box, the branch switcher).
   */
  logVersion: number
}

/** Injectable factory keeps refresh/race semantics testable without a live API. */
export function createSourceControlStore(api: SourceControlApi = defaultSourceControlApi) {
  return create<SourceControlStore>((set, get) => {
    /** The repo header/commit/log ops target for a session (the focused repo). */
    const activeOf = (sessionId: string): string | undefined =>
      get().bySession[sessionId]?.activeRepo ?? undefined

    const writes = Object.fromEntries(
      Object.entries(MUTATIONS).map(([name, spec]) => {
        const { run, bumpsLog } = spec as MutationSpec<unknown[]>
        const method = async (sessionId: string, ...args: unknown[]) => {
          const result = await run(api, { sessionId, repo: activeOf(sessionId) }, ...args)
          applyMutation(set, sessionId, result, bumpsLog)
        }
        return [name, method]
      }),
    ) as MutationMethods

    return {
      bySession: {},
      logVersion: 0,
      ...createWorkspaceReads(api, set, get),
      ...writes,
    }
  })
}

export const useSourceControlStore = createSourceControlStore()

/**
 * Full cached slice for a session. Re-renders on ANY field change (a stash
 * write, a loading flip), so only a view that renders most of the slice should
 * use it — everything else subscribes through {@link useSessionGitField}.
 */
export function useSessionGit(sessionId: string | null): SessionGitState {
  return useSourceControlStore((s) =>
    sessionId ? (s.bySession[sessionId] ?? EMPTY_SESSION) : EMPTY_SESSION,
  )
}

/** One field of a session's slice; re-renders only when THAT field's reference changes. */
export function useSessionGitField<K extends keyof SessionGitState>(
  sessionId: string | null | undefined,
  key: K,
): SessionGitState[K] {
  return useSourceControlStore(
    (s) => (sessionId ? (s.bySession[sessionId] ?? EMPTY_SESSION) : EMPTY_SESSION)[key],
  )
}

/** The focused repo's HEAD stamp (see `headStamp`) — a primitive, so it re-renders only on change. */
export function useHeadStamp(sessionId: string | null | undefined): string {
  return useSourceControlStore((s) =>
    headStamp(sessionId ? (s.bySession[sessionId]?.status ?? null) : null, s.logVersion),
  )
}

/**
 * The discovered repo roots, compared by value.
 *
 * An editor only needs to know WHICH repos exist to resolve a file's owner. Read
 * through the whole slice, every open editor re-rendered on every poll that
 * changed any file's status; roots change only when discovery does.
 */
export function useSessionRepoRoots(sessionId: string | null | undefined): string[] {
  return useSourceControlStore(
    useShallow((s) => (sessionId ? (s.bySession[sessionId]?.repos ?? []) : []).map((r) => r.root)),
  )
}
