import {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useMiniAppWorkspaceChanges } from '@localixai/mini-app-sdk/ui/runtime-hooks'
import { miniAppApiFetch } from '@localixai/mini-app-sdk/ui/transport'
import { useWorkItemSessionId } from '@localixai/mini-app-sdk/ui/work-item-session'
import { touchesProject } from '../shared/changes'
import { MAX_TRAIL } from '../shared/lens'
import { EDGE_KINDS, type EdgeKind } from '../shared/model'
import { ROUTE_PATH } from '../shared/resource'
import { graphSnapshotSchema } from '../shared/view'
import {
  currentLocation,
  initialHistory,
  moveHistory,
  visit,
  type GraphLocation,
} from './model/history'
import { snapshotPollMs } from './model/cadence'
import { usePolledSnapshot } from './usePolledSnapshot'
import { useAgentRequests } from './useAgentRequests'
import { useGraphStream } from './graphStream'

/** Changes folded into one re-index, from the first: a save-and-format, an agent's burst of edits. */
const CHANGE_WINDOW_MS = 1500

/**
 * Everything the view is looking at, and the one snapshot that answers it.
 *
 * Where the person is (scope, selection, search) lives here, in the view; what the project IS
 * lives in the backend and arrives with each read — on a stream frame, or a poll while the stream
 * is down (`model/cadence.ts`). The agent's `show` is the one place the backend moves the view:
 * it carries a revision, applied once, after which the person is free to wander.
 */
export function useGraph(active: boolean) {
  const sessionId = useWorkItemSessionId()
  const [history, setHistory] = useState(initialHistory)
  const { scope, selected, trail } = currentLocation(history)
  const [query, setQuery] = useState('')
  const [external, setExternal] = useState(false)
  const [kinds, setKinds] = useState<ReadonlySet<EdgeKind>>(() => new Set(EDGE_KINDS))
  const [highlighted, setHighlighted] = useState<ReadonlySet<string>>(() => new Set())
  /** Functions open in the call lens, in the order they were followed; empty = the map. */
  const [appliedAgentRevision, setAppliedAgentRevision] = useState(0)
  const deferredQuery = useDeferredValue(query.trim())
  const [indexing, setIndexing] = useState(true)

  const navigate = useCallback((change: (current: GraphLocation) => GraphLocation) => {
    setHistory((current) => visit(current, change(currentLocation(current))))
  }, [])
  const back = useCallback(() => setHistory((current) => moveHistory(current, -1)), [])
  const forward = useCallback(() => setHistory((current) => moveHistory(current, 1)), [])

  // Files changed under the chat: tell the index, which refreshes in the background and announces
  // the result as a `revision` frame. A change heard while the tab is not active is remembered and
  // told when it is, so a hidden map neither re-indexes on every save nor comes back stale.
  const root = useRef<string | null>(null)
  const missed = useRef(false)
  const notifyChanged = useCallback(() => {
    if (!sessionId) return
    void miniAppApiFetch(`${ROUTE_PATH}/changed?${new URLSearchParams({ sessionId })}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(5000),
    }).catch(() => undefined)
  }, [sessionId])
  const live = useMiniAppWorkspaceChanges(
    sessionId,
    ({ paths }) => {
      if (root.current && !touchesProject(root.current, paths)) return
      if (active) notifyChanged()
      else missed.current = true
    },
    { windowMs: CHANGE_WINDOW_MS },
  )
  useEffect(() => {
    if (!active || !missed.current) return
    missed.current = false
    notifyChanged()
  }, [active, notifyChanged])

  const params = useMemo(() => {
    const search = new URLSearchParams()
    if (sessionId) search.set('sessionId', sessionId)
    search.set('scope', scope)
    if (selected) search.set('node', selected)
    if (deferredQuery) search.set('q', deferredQuery)
    if (external) search.set('external', '1')
    if (trail.length > 0) search.set('trail', trail.join(','))
    if (live) search.set('live', '1')
    return `?${search.toString()}`
  }, [sessionId, scope, selected, deferredQuery, external, trail, live])

  // The stream's callbacks are built before the snapshot they refresh exists, so they reach the
  // latest `refresh` and `indexing` through refs, published when each render commits.
  const refreshRef = useRef<() => void>(() => {})
  const indexingRef = useRef(indexing)
  const streamLive = useGraphStream(sessionId, active, {
    revision: () => refreshRef.current(),
    // A build's progress matters to a tab showing it; a background refresh of a ready map stays
    // quiet until its `revision`.
    progress: () => {
      if (indexingRef.current) refreshRef.current()
    },
    reconnect: () => refreshRef.current(),
  })
  const polled = usePolledSnapshot({
    path: `${ROUTE_PATH}/view${params}`,
    schema: graphSnapshotSchema,
    intervalMs: snapshotPollMs({ indexing, streamLive, changesLive: live === true }),
    active: active && sessionId !== null,
    failureMessage: 'The code map could not be loaded.',
  })
  const projectRoot = polled.snapshot?.root ?? null
  useEffect(() => {
    root.current = projectRoot
  }, [projectRoot])
  // A finished refresh, or a socket that came back having missed some: read the snapshot now.
  useLayoutEffect(() => {
    refreshRef.current = polled.refresh
    indexingRef.current = indexing
  })
  const request = useAgentRequests(active, sessionId)
  const snapshot = useMemo(() => {
    if (!polled.snapshot || !request || request.revision <= (polled.snapshot.agent?.revision ?? 0))
      return polled.snapshot
    return { ...polled.snapshot, agent: request }
  }, [polled.snapshot, request])

  // `indexing` picks how often the snapshot is polled, so it cannot be computed before the poll;
  // it follows the snapshot it last saw, one render behind, adjusted while rendering.
  const indexingNow =
    !snapshot || snapshot.status.state === 'indexing' || snapshot.status.state === 'empty'
  if (indexing !== indexingNow) setIndexing(indexingNow)

  // The agent pointed at something: go there once per request.
  const agent = snapshot?.agent
  if (agent && agent.revision > appliedAgentRevision) {
    setAppliedAgentRevision(agent.revision)
    if (agent.scope !== undefined || agent.focus !== undefined || agent.trail !== undefined) {
      navigate((current) => ({
        scope: agent.scope ?? current.scope,
        selected: agent.focus ?? null,
        trail: agent.trail ?? [],
      }))
      setHighlighted(new Set(agent.highlight))
    }
  }

  const open = useCallback(
    (id: string) => {
      navigate(() => ({ scope: id, selected: null, trail: [] }))
    },
    [navigate],
  )

  /**
   * Up to an ancestor level, selecting the box you came out of: after pulling back, the eye lands
   * on where you were instead of searching a level of identical boxes for it.
   */
  const leaveTo = useCallback(
    (id: string, cameFrom: string | null) => {
      navigate(() => ({ scope: id, selected: cameFrom, trail: [] }))
    },
    [navigate],
  )

  /** Open a function in the call lens, standing in its file. */
  const openLens = useCallback(
    (file: string, id: string) => {
      navigate(() => ({ scope: file, selected: null, trail: [id] }))
    },
    [navigate],
  )

  /**
   * Follow a call from the card at `from`: the cards after it are replaced by the callee, as a
   * browser's history is when you navigate from a page you went back to. A function already on
   * the trail is not opened twice — the trail is cut back to it instead.
   */
  const follow = useCallback(
    (from: number, id: string) => {
      navigate((current) => {
        const existing = current.trail.indexOf(id)
        return {
          ...current,
          selected: null,
          trail:
            existing >= 0
              ? current.trail.slice(0, existing + 1)
              : [...current.trail.slice(0, from + 1), id].slice(-MAX_TRAIL),
        }
      })
    },
    [navigate],
  )

  /** A caller of the first card becomes the new first card: the chain grows to the left. */
  const prepend = useCallback(
    (id: string) => {
      navigate((current) => ({
        ...current,
        selected: null,
        trail: [id, ...current.trail.filter((existing) => existing !== id)].slice(0, MAX_TRAIL),
      }))
    },
    [navigate],
  )

  const truncateTrail = useCallback(
    (length: number) => {
      navigate((current) => ({ ...current, selected: null, trail: current.trail.slice(0, length) }))
    },
    [navigate],
  )

  const setSelected = useCallback(
    (id: string | null) => navigate((current) => ({ ...current, selected: id })),
    [navigate],
  )

  const toggleKind = useCallback((kind: EdgeKind) => {
    setKinds((current) => {
      const next = new Set(current)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      return next
    })
  }, [])

  const reindex = useCallback(
    () => void polled.send({}, { path: `${ROUTE_PATH}/reindex${params}` }),
    [polled, params],
  )
  const dismissAgent = useCallback(() => {
    setHighlighted(new Set())
    void polled.send({}, { path: `${ROUTE_PATH}/agent/clear${params}` })
  }, [polled, params])

  return {
    ...polled,
    snapshot,
    sessionId,
    scope,
    selected,
    query,
    external,
    kinds,
    highlighted,
    canBack: history.index > 0,
    canForward: history.index < history.entries.length - 1,
    back,
    forward,
    setSelected,
    setQuery,
    setExternal,
    toggleKind,
    open,
    leaveTo,
    trail,
    openLens,
    follow,
    prepend,
    truncateTrail,
    reindex,
    dismissAgent,
  }
}

export type GraphState = ReturnType<typeof useGraph>
