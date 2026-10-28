import { useCallback, useEffect, useRef, useState } from 'react'
import { useWorkItemVisible } from '@localixai/mini-app-sdk/ui/visibility'
import { acknowledgeInline, toast } from '@localixai/mini-app-sdk/ui'
import { miniAppErrorDetail } from '@localixai/mini-app-sdk/ui/transport'
import type { SpaceView } from '../shared/api'
import { applyOps } from '../shared/ops/apply'
import type { OpResult, SpaceOp } from '../shared/ops/contract'
import { spaceTypes } from '../shared/types'
import { spaceApi } from './api'
import { SpaceEpoch } from './spaceEpoch'
import { LOCAL_REVISION, settle } from './settle'
import { savedSpaceView, subscribeSpaceUpdates, watchSpaceUpdates } from './spaceUpdates'

/**
 * The board as the view holds it, and the one way the view changes it.
 *
 * A change is shown AT ONCE — the same `applyOps` the server runs is applied to the local copy —
 * and then replaced by the server's answer, which is the file as written. While a change is in
 * flight, a poll's answer is older than what the person sees and is dropped: taking it would make
 * a dragged note jump back for a moment. The shared mirror receives saved changes immediately
 * and follows remote changes through the socket; a slower reconciliation catches hand edits.
 */
/**
 * What changed on the board that the person did not do — the agent's work, or a hand edit of
 * the file — as a read brought it: the elements added or changed, and when. The person's own
 * changes come back as answers to their requests, so a read's difference
 * is someone else's by construction; that is what the camera follows (`camera/useFollow.ts`).
 */
export interface RemoteChange {
  ids: string[]
  at: number
}

export interface SpaceState {
  view: SpaceView | null
  remote: RemoteChange | null
  error: string | null
  apply: (ops: readonly SpaceOp[]) => Promise<OpResult[]>
  undo: () => void
  redo: () => void
  reload: () => Promise<void>
}

export function useSpace(sessionId: string | null): SpaceState {
  const visible = useWorkItemVisible()
  const [view, setView] = useState<SpaceView | null>(() =>
    sessionId ? savedSpaceView(sessionId) : null,
  )
  const [remote, setRemote] = useState<RemoteChange | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(0)
  const current = useRef<SpaceView | null>(null)
  const [epoch] = useState(() => {
    const first = new SpaceEpoch()
    first.begin(sessionId)
    return first
  })
  const accept = useCallback((answer: SpaceView) => {
    const next = settle(current.current, answer)
    current.current = next
    setView(next)
  }, [])

  useEffect(() => {
    epoch.begin(sessionId)
    inFlight.current = 0
    current.current = sessionId ? savedSpaceView(sessionId) : null
    setView(current.current)
    setRemote(null)
    setError(null)
    if (!sessionId) return
    const unsubscribe = subscribeSpaceUpdates(sessionId, (answer, origin) => {
      if (inFlight.current !== 0) return
      const before = current.current
      accept(answer)
      setError(null)
      if (origin === 'read' && before) {
        const ids = Object.keys(current.current!.space.elements).filter(
          (id) => current.current!.space.elements[id] !== before.space.elements[id],
        )
        if (ids.length) setRemote({ ids, at: Date.now() })
      }
    })
    return () => {
      unsubscribe()
      epoch.end()
    }
  }, [sessionId, accept, epoch])

  const reload = useCallback(() => {
    if (!sessionId) return Promise.resolve()
    const sequence = epoch.nextRead()
    // The mirror publishes an accepted read once to every surface. Applying it again here
    // would bypass its stale-read guard and turn one read into two competing state owners.
    return spaceApi.space(sessionId).then(
      () => {
        if (epoch.latest(sessionId, sequence)) setError(null)
      },
      (failure: unknown) => {
        if (!epoch.latest(sessionId, sequence)) return
        acknowledgeInline(failure)
        setError(miniAppErrorDetail(failure) ?? 'The board could not be read.')
      },
    )
  }, [sessionId, epoch])

  useEffect(() => {
    if (!sessionId || !visible) return
    const release = watchSpaceUpdates(sessionId, () => {})
    void reload()
    return release
  }, [sessionId, visible, reload])

  const apply = useCallback(
    async (ops: readonly SpaceOp[]) => {
      const before = current.current
      if (!sessionId || !before) return []
      const startedIn = epoch.mark()
      const local = applyOps(before.space, ops, { registry: spaceTypes })
      // A local guess, not a file the server wrote: it carries no revision (`settle`).
      current.current = { ...before, space: local.space, revision: LOCAL_REVISION }
      setView(current.current)
      inFlight.current++
      try {
        const answer = await spaceApi.apply(sessionId, ops)
        if (!epoch.holds(sessionId, startedIn)) return answer.results
        inFlight.current--
        if (inFlight.current === 0) accept(savedSpaceView(sessionId) ?? answer)
        const refused = answer.results.filter((result) => !result.ok)
        if (refused.length)
          toast.error(refused.map((result) => ('error' in result ? result.error : '')).join('\n'))
        return answer.results
      } catch (failure) {
        if (!epoch.holds(sessionId, startedIn)) return []
        inFlight.current--
        toast.error(miniAppErrorDetail(failure) ?? 'The change was not saved.')
        await reload()
        return []
      }
    },
    [sessionId, reload, accept, epoch],
  )

  const step = useCallback(
    async (side: 'undo' | 'redo') => {
      if (!sessionId) return
      const startedIn = epoch.mark()
      try {
        const answer = await spaceApi[side](sessionId)
        if (!epoch.holds(sessionId, startedIn)) return
        if (inFlight.current === 0) accept(answer)
        if (answer.conflicts.length)
          toast(
            `${answer.conflicts.length} element${answer.conflicts.length === 1 ? ' was' : 's were'} changed since, and kept as they are now`,
          )
      } catch (failure) {
        if (!epoch.holds(sessionId, startedIn)) return
        toast.error(miniAppErrorDetail(failure) ?? `Could not ${side}.`)
      }
    },
    [sessionId, accept, epoch],
  )

  return {
    view,
    remote,
    error,
    apply,
    undo: () => void step('undo'),
    redo: () => void step('redo'),
    reload,
  }
}
