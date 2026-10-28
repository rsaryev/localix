import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { toast } from '@localixai/mini-app-sdk/ui'
import { MiniAppApiError } from '@localixai/mini-app-sdk/ui'
import { sourceControlApi } from '../../api'
import { useWorkItemVisible } from '@localixai/mini-app-sdk/ui/visibility'
import { useHeadStamp, useSourceControlStore } from './store'
import { gitFailed } from './gitFailure'
import { useReadWhenStale } from './useReadWhenStale'

/**
 * The Source Control panel's remote-sync + recovery operations, extracted from
 * `SourceControlTab` so the component stays a layout orchestrator.
 *
 * Owns:
 * - **HEAD context** — the HEAD commit message (amend prefill + Amend gate), the
 *   recent-message recall list (composer ↑/↓). Both re-read by themselves when the
 *   HEAD stamp moves, so no op has to remember to ask for it.
 * - **Remote sync** — push / pull / fetch, each with its own busy flag.
 * - **Recovery** — stash-all and a working-tree nuke, each busy-guarded.
 * - **In-progress rebase / bisect steps** — `rebaseStep` / `bisectStep` run a
 *   store op with a shared busy flag, with rebase-conflict guidance.
 *
 * Reporting: a failure is `gitFailed(<our sentence>, err)`; a success posts nothing, because
 * every op here changes something the panel itself renders (the Push/Pull counts, the Changes
 * list, the Stashes list, the rebase and bisect banners). A row for it would be a duplicate.
 * HEAD is re-read by the stamp-keyed read, never inside an op's try, so nothing else can be
 * reported under the op's name.
 *
 * The nuke *dialog* state (open + "remove untracked" checkbox) stays in the
 * component; this hook exposes the effectful `nuke(removeUntracked)`.
 */
export function useGitPanelOps(sessionId: string | null, repoRoot?: string) {
  const workItemVisible = useWorkItemVisible()
  // Actions only — read the stable action set once instead of subscribing to the
  // whole store (which re-rendered on every git poll). Zustand action identities
  // are stable, so this is safe to read per render.
  const store = useSourceControlStore.getState()

  // HEAD commit message — prefills an amend + gates the Amend toggle (null on an unborn branch).
  const [headMessage, setHeadMessage] = useState<string | null>(null)
  // Recent commit messages (newest first) for the composer's ↑/↓ recall.
  const [recentMessages, setRecentMessages] = useState<string[]>([])
  const [loadedScope, setLoadedScope] = useState('')
  const scopeKey = `${sessionId ?? ''}\u0000${repoRoot ?? ''}`

  const [pushing, setPushing] = useState(false)
  const [pulling, setPulling] = useState(false)
  const [fetching, setFetching] = useState(false)
  const [stashing, setStashing] = useState(false)
  const [nuking, setNuking] = useState(false)
  const [rebaseBusy, setRebaseBusy] = useState(false)
  const [bisectBusy, setBisectBusy] = useState(false)
  // A late response from the previous workspace must never overwrite this
  // workspace's amend prefill / commit-message history.
  const headRequest = useRef(0)
  const currentScope = useRef(scopeKey)
  // Published when the render commits, so a discarded render never moves what late answers compare to.
  useLayoutEffect(() => {
    currentScope.current = scopeKey
  }, [scopeKey])

  /** Re-read HEAD's message + the recall list; resolves whether the answer was applied. */
  const refreshHead = useCallback(async (): Promise<boolean> => {
    // An operation callback from a repository that is no longer focused may
    // outlive its render. It must not invalidate the current repo's HEAD read.
    if (currentScope.current !== scopeKey) return false
    const request = ++headRequest.current
    if (!sessionId) {
      setHeadMessage(null)
      setRecentMessages([])
      setLoadedScope(scopeKey)
      return true
    }
    try {
      const [head, recent] = await Promise.all([
        sourceControlApi.getHeadCommitMessage(sessionId, repoRoot),
        sourceControlApi.getRecentCommitMessages(sessionId, undefined, repoRoot).catch(() => []),
      ])
      if (request !== headRequest.current || currentScope.current !== scopeKey) return false
      setHeadMessage(head)
      setRecentMessages(recent)
    } catch {
      if (request !== headRequest.current || currentScope.current !== scopeKey) return false
      setHeadMessage(null)
      setRecentMessages([])
    }
    setLoadedScope(scopeKey)
    return true
  }, [repoRoot, scopeKey, sessionId])

  // HEAD's message backs the amend prefill + recall list. It is re-read when the scope or HEAD
  // moves — a commit, amend, rebase or bisect step bumps the store's `logVersion`, which is in the
  // stamp — and NOT on a mere re-show of the tab, which used to cost two git reads every time.
  const stamp = useHeadStamp(sessionId)
  const readHead = useCallback(
    (done: () => void) => {
      void refreshHead().then((applied) => applied && done())
      const requests = headRequest
      return () => {
        requests.current++
      }
    },
    [refreshHead],
  )
  useReadWhenStale(workItemVisible, `${scopeKey}\u0000${stamp}`, readHead)

  /**
   * Push the current branch. A rejected non-fast-forward is the one push failure
   * with an obvious next step — you amended or rebased, and the remote still has
   * the old commits — so it offers the retry instead of ending in a red toast.
   * The retry is `--force-with-lease` (see the backend), never a bare `--force`:
   * it republishes YOUR rewritten history and still refuses to bury someone
   * else's, which is the difference the offer is only safe to make because of.
   *
   * The offer is a row action, so it expires with the row's callbacks (60 s): a "Force push"
   * found in the Event Center an hour later cannot fire against a branch that has moved since.
   * It is not behind a confirm dialog on purpose — the dialog would belong to this panel, and a
   * row clicked after the panel closed would open nothing; the warning row is the confirmation.
   *
   * No success row: the header's "Push N" button disappears, which is the answer.
   */
  const runPush = async (force: boolean) => {
    if (!sessionId) return
    setPushing(true)
    try {
      await store.push(sessionId, force)
    } catch (err) {
      if (!force && err instanceof MiniAppApiError && err.code === 'git_push_rejected') {
        toast.warning('The remote rejected this push', {
          description:
            'Its branch has commits yours does not. Pull to integrate them, or force-push if you rewrote this history yourself.',
          action: { label: 'Force push', onClick: () => void runPush(true) },
        })
        return
      }
      gitFailed(force ? 'Could not force-push' : 'Could not push', err)
    } finally {
      setPushing(false)
    }
  }

  const push = () => runPush(false)

  // No success row: the header's "Pull N" button disappears and the log gains the commits.
  const pull = async () => {
    if (!sessionId) return
    setPulling(true)
    try {
      await store.pull(sessionId)
    } catch (err) {
      gitFailed('Could not pull', err)
    } finally {
      setPulling(false)
    }
  }

  const fetch = async () => {
    if (!sessionId) return
    setFetching(true)
    try {
      await store.fetch(sessionId)
    } catch (err) {
      gitFailed('Could not fetch', err)
    } finally {
      setFetching(false)
    }
  }

  // No success row: the Changes list empties and the stash appears under Stashes.
  const stashAll = async () => {
    if (!sessionId) return
    setStashing(true)
    try {
      await store.createStash(sessionId, { includeUntracked: true })
    } catch (err) {
      gitFailed('Could not stash the changes', err)
    } finally {
      setStashing(false)
    }
  }

  // No success row: the Changes list empties, which is what was asked for.
  const nuke = async (removeUntracked: boolean) => {
    if (!sessionId) return
    setNuking(true)
    try {
      await store.nuke(sessionId, removeUntracked)
    } catch (err) {
      gitFailed('Could not discard the changes', err)
    } finally {
      setNuking(false)
    }
  }

  /**
   * Continue/abort/skip an in-progress rebase. No success row: the rebase banner advances a step
   * or disappears. A conflict is where a rebase is SUPPOSED to stop, so it is guidance, not an
   * error.
   */
  const rebaseStep = async (fn: () => Promise<void>, failure: string) => {
    if (!sessionId) return
    setRebaseBusy(true)
    try {
      await fn()
    } catch (err) {
      if (err instanceof MiniAppApiError && err.code === 'git_rebase_conflict') {
        toast.warning('Stopped on another conflict', {
          description: 'Resolve and stage the conflicts, then Continue again — or Abort.',
        })
      } else {
        gitFailed(failure, err)
      }
    } finally {
      setRebaseBusy(false)
    }
  }

  /**
   * Run a bisect good/bad/skip/reset op with a busy guard. No success row: the bisect banner
   * names the next commit to test, or the first bad one.
   */
  const bisectStep = async (fn: () => Promise<void>, failure: string) => {
    if (!sessionId) return
    setBisectBusy(true)
    try {
      await fn()
    } catch (err) {
      gitFailed(failure, err)
    } finally {
      setBisectBusy(false)
    }
  }

  return {
    // HEAD context (composer prefill + recall)
    // Never expose the prior repository's amend target/history during the
    // render between a focus change and its scoped request completing.
    headMessage: loadedScope === scopeKey ? headMessage : null,
    recentMessages: loadedScope === scopeKey ? recentMessages : [],
    // Remote sync
    push,
    pull,
    fetch,
    pushing,
    pulling,
    fetching,
    // Recovery
    stashAll,
    stashing,
    nuke,
    nuking,
    // Rebase / bisect steps
    rebaseStep,
    bisectStep,
    rebaseBusy,
    bisectBusy,
  }
}
