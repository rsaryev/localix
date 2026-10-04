import { useMemo } from 'react'
import {
  Canvas,
  CanvasProvider,
  useCameraPlacement,
  useCanvasCamera,
  type CanvasEdgeType,
  type Node,
} from '@localixai/kit/canvas'
import type { Lens } from '../../shared/lens'
import { LENS_KINDS } from '../../shared/lens'
import { BoxNode } from '../canvas/nodes'
import { BOX_TYPE } from '../model/flow'
import { CodeCardNode } from './CodeCardNode'
import { CARD_TYPE, lensFlow, type LensHandlers } from './lensFlow'
import type { AgentView } from '../../shared/view'
import { useAgentCamera } from '../useAgentCamera'

const nodeTypes = { [CARD_TYPE]: CodeCardNode, [BOX_TYPE]: BoxNode }

/**
 * The call lens on the same board as the map (the same gestures, the same controls), so reading
 * code never feels like a different app. When the trail grows the camera moves to the card just
 * opened; clicking a caller tile makes it the first card, clicking a callee tile follows it.
 */
type LensCanvasProps = {
  lens: Lens
  scope: string
  active?: boolean
  agent?: AgentView
} & LensHandlers
export function LensCanvas(props: LensCanvasProps) {
  return (
    <CanvasProvider>
      <Board {...props} />
    </CanvasProvider>
  )
}

function Board({
  lens,
  scope,
  active = true,
  agent,
  onFollow,
  onPrepend,
  onOpenFile,
  onReveal,
}: LensCanvasProps) {
  const camera = useCanvasCamera()
  const { nodes, edges, focus } = useMemo(
    () => lensFlow(lens, { onFollow, onPrepend, onOpenFile, onReveal }),
    [lens, onFollow, onPrepend, onOpenFile, onReveal],
  )
  const lastIndex = lens.trail.length - 1
  const firstId = lens.trail[0]?.node.id
  useAgentCamera({
    active,
    agent,
    nodes,
    scope,
    trail: lens.trail.map((card) => card.node.id),
    selected: null,
  })

  // Settle on the card just opened, once per trail; a poll with the same trail leaves the camera
  // where the person put it.
  useCameraPlacement(lens.trail.map((card) => card.node.id).join('|'), () => {
    if (focus) camera.focus(focus, { padding: 0.18 })
  })

  return (
    <Canvas<Node, CanvasEdgeType>
      label="Call lens. Click a caller to start the trail from it, a callee to follow it"
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      zIndexMode="manual"
      onNodeClick={(_event, node) => {
        if (node.type !== BOX_TYPE) return
        const kind = lens.callers
          .concat(lens.trail.at(-1)?.callees ?? [])
          .find((n) => n.id === node.id)?.kind
        if (!kind || !LENS_KINDS.has(kind)) return
        // A caller tile sits left of the first card; everything else is a callee of the last.
        if (lens.callers.some((caller) => caller.id === node.id) && node.id !== firstId)
          onPrepend(node.id)
        else onFollow(lastIndex, node.id)
      }}
    />
  )
}
