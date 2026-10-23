import { useCallback, useRef, useState } from 'react'
import { acknowledgeInline } from '@localixai/mini-app-sdk/ui'
import type { ForgePullRequest, ForgeStatus } from '../../../backend/source-control/forge/contracts'
import { sourceControlApi } from '../../api'
import { useWorkItemVisible } from '@localixai/mini-app-sdk/ui/visibility'
import { gitFailed, gitReadProblem, gitDetail } from './gitFailure'
import { useHeadStamp } from './store'
import { useReadWhenStale } from './useReadWhenStale'

export interface PullRequestsView {
  status: ForgeStatus | null
  prs: ForgePullRequest[]
  /** First load in flight (before any data has arrived). */
  loading: boolean
  /** A manual refresh is running (keeps the section rendered). */
  refreshing: boolean
  /**
   * The last list read failed (the forge is available but `gh pr list` was not). `prs` then
   * still holds the previous list rather than an empty one that reads as "no pull requests".
   */
  error: string | null
  reload: () => void
}

/**
 * Self-contained loader for the forge (GitHub) Pull Requests section. Kept OUT of
 * the git store's poll on purpose — hitting the `gh` CLI that often is wasteful —
 * so this reads once per (session, repo, branch, HEAD) and on an explicit reload
 * (e.g. after opening the create-PR flow); re-showing the tab with nothing moved
 * reads nothing. Availability is a set of flags, never an error: the section
 * renders a quiet hint for a missing or unauthenticated `gh`. A failed LIST read
 * is different — the forge said it was usable — so it is kept as `error` (and
 * reported when the person asked for the reload) instead of silently emptying.
 */
export function usePullRequests(
  sessionId: string | null,
  repoRoot: string | undefined,
  branch: string | null,
): PullRequestsView {
  const workItemVisible = useWorkItemVisible()
  const stamp = useHeadStamp(sessionId)
  const [status, setStatus] = useState<ForgeStatus | null>(null)
  const [prs, setPrs] = useState<ForgePullRequest[]>([])
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Guards a stale in-flight fetch from overwriting a newer one (session/repo switch).
  const reqId = useRef(0)

  const load = useCallback(
    async (manual: boolean): Promise<boolean> => {
      const id = ++reqId.current
      if (!sessionId) {
        setStatus(null)
        setPrs([])
        setError(null)
        return true
      }
      if (manual) setRefreshing(true)
      else setLoading(true)
      try {
        const st = await sourceControlApi.getForgeStatus(sessionId, repoRoot).catch(() => null)
        if (id !== reqId.current) return false
        setStatus(st)
        // Only list PRs when the forge is actually usable — otherwise skip the call.
        if (!(st?.installed && st.authed && st.hasRemote)) {
          setPrs([])
          setError(null)
          return true
        }
        try {
          const list = await sourceControlApi.listPullRequests(sessionId, repoRoot)
          if (id !== reqId.current) return false
          setPrs(list)
          setError(null)
        } catch (err) {
          if (id !== reqId.current) return false
          acknowledgeInline(err)
          setError(gitReadProblem(gitDetail(err) ?? '', 'Could not list pull requests').message)
          if (manual) gitFailed('Could not list pull requests', err)
        }
        return true
      } finally {
        if (id === reqId.current) {
          setLoading(false)
          setRefreshing(false)
        }
      }
    },
    [sessionId, repoRoot],
  )

  // The branch is in the key so the current-branch PR pin follows a switch; the HEAD stamp so a
  // push (ahead → 0) re-reads the checks.
  const readKey = `${sessionId ?? ''}\u0000${repoRoot ?? ''}\u0000${branch ?? ''}\u0000${stamp}`
  const autoRead = useCallback(
    (done: () => void) => {
      void load(false).then((applied) => applied && done())
      const requests = reqId
      return () => {
        requests.current++
      }
    },
    [load],
  )
  useReadWhenStale(workItemVisible, readKey, autoRead)

  const reload = useCallback(() => void load(true), [load])

  return { status, prs, loading, refreshing, error, reload }
}
