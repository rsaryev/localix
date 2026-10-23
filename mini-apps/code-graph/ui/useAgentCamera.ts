import { useCallback, useEffect, useRef } from 'react'
import { useCanvasCamera, type Node } from '@localixai/kit/canvas'
import { useWorkItemSessionId } from '@localixai/mini-app-sdk/ui/work-item-session'
import { useVisiblePolling, useWorkItemVisible } from '@localixai/mini-app-sdk/ui/visibility'
import { miniAppApiFetch } from '@localixai/mini-app-sdk/ui/transport'
import type { AgentView } from '../shared/view'
import { ROUTE_PATH } from '../shared/resource'
import { useGraphStream } from './graphStream'
import { cameraBackstopMs } from './model/cadence'

/** A move older than this is not applied: the person has had time to look elsewhere. */
const MOVE_TTL_MS = 15_000

/**
 * As in Project Space, the visible tab applies the agent's camera moves and reports what it
 * actually shows. Reporting hidden tabs would let the agent mistake a background map for the
 * person's view.
 *
 * It reports when there is something to say — a move applied, a tool asking through the stream
 * (`requestGraphReport`) — plus a slow backstop only while the stream is down. It used to apply
 * and report on a one-second timer, which POSTed a camera report every second for as long as a
 * map stayed open.
 */
export function useAgentCamera({
  active,
  agent,
  nodes,
  scope,
  trail,
  selected,
}: {
  active: boolean
  agent?: AgentView
  nodes: readonly Node[]
  scope: string
  trail: readonly string[]
  selected: string | null
}) {
  const sessionId = useWorkItemSessionId()
  const camera = useCanvasCamera()
  const workItemVisible = useWorkItemVisible()
  const applied = useRef(0)
  const missing = useRef<string[]>([])
  const view = useRef({ nodes, scope, trail, selected })
  useEffect(() => {
    view.current = { nodes, scope, trail, selected }
  })
  const shown = active && workItemVisible
  const showing = useCallback(
    () => shown && (typeof document === 'undefined' || !document.hidden),
    [shown],
  )

  const report = useCallback(async () => {
    if (!sessionId || !camera.size()) return
    const { nodes, scope, trail, selected } = view.current
    const viewport = camera.get()
    const size = camera.size()!
    const left = -viewport.x / viewport.zoom
    const top = -viewport.y / viewport.zoom
    const byId = new Map(nodes.map((node) => [node.id, node]))
    const visible = nodes
      .filter((node) => {
        let { x, y } = node.position
        let parent = node.parentId ? byId.get(node.parentId) : undefined
        while (parent) {
          x += parent.position.x
          y += parent.position.y
          parent = parent.parentId ? byId.get(parent.parentId) : undefined
        }
        return (
          x + (node.width ?? 0) > left &&
          x < left + size.width / viewport.zoom &&
          y + (node.height ?? 0) > top &&
          y < top + size.height / viewport.zoom
        )
      })
      .slice(0, 200)
      .map((node) => node.id)
    await miniAppApiFetch(`${ROUTE_PATH}/camera/report?${new URLSearchParams({ sessionId })}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify({
        revision: applied.current,
        viewport,
        size,
        scope,
        trail,
        selected,
        visible,
        missing: missing.current,
      }),
    }).catch(() => undefined)
  }, [sessionId, camera])

  // A request arrived, or the layout it was waiting for did: apply it once, then confirm it with
  // a report the tool is waiting for (by revision). Navigation lands one snapshot before its new
  // layout, so a move for another level waits for that level instead of framing the old one.
  const trailKey = trail.join('\0')
  useEffect(() => {
    // `shown`, not `showing()`: a hidden window stops animation frames, so a move applied there
    // reports once the window is back, which is when the person can see it.
    if (!sessionId || !agent || agent.revision <= applied.current || !shown) return
    const fresh = Date.now() - (agent.requestedAt ?? 0) < MOVE_TTL_MS
    if (fresh && agent.scope && agent.scope !== scope) return
    if (fresh && agent.trail && agent.trail.join('\0') !== trailKey) return
    if (!camera.size()) return
    applied.current = agent.revision
    missing.current = []
    const move = fresh ? agent.camera : undefined
    // Not cancelled when the effect re-runs: the revision is already marked applied, so this
    // report is the only confirmation the waiting tool will get.
    void (async () => {
      if (move && move.kind !== 'inspect') {
        if (move.kind === 'fit') camera.fit({ duration: 0 })
        else if (move.kind === 'focus') {
          const available = new Set(nodes.map((node) => node.id))
          missing.current = move.nodes.filter((id) => !available.has(id))
          const found = move.nodes.filter((id) => available.has(id))
          if (found.length)
            camera.fit({ nodes: found, maxZoom: found.length === 1 ? 1.25 : 1, duration: 0 })
        } else if (move.kind === 'area') camera.focus(move, { duration: 0 })
        else if (move.kind === 'pan') {
          const viewport = camera.get()
          const size = camera.size()!
          camera.set(
            {
              ...viewport,
              x: viewport.x - move.x * size.width,
              y: viewport.y - move.y * size.height,
            },
            { duration: 0 },
          )
        } else if (move.kind === 'zoom') {
          const viewport = camera.get()
          const size = camera.size()!
          const ratio = move.zoom / viewport.zoom
          camera.set(
            {
              zoom: move.zoom,
              x: size.width / 2 - (size.width / 2 - viewport.x) * ratio,
              y: size.height / 2 - (size.height / 2 - viewport.y) * ratio,
            },
            { duration: 0 },
          )
        }
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        )
      }
      await report()
    })()
  }, [sessionId, agent, scope, trailKey, nodes, camera, shown, report])

  // A tool asked what the tab shows right now.
  const streamLive = useGraphStream(sessionId, active, {
    report: () => {
      if (showing()) void report()
    },
  })

  useVisiblePolling({
    enabled: active && Boolean(sessionId),
    intervalMs: cameraBackstopMs(streamLive),
    immediate: true,
    onTick: report,
  })
}
