import { useState } from 'react'
import { ArrowLeftRight, Trash2 } from 'lucide-react'
import { NodeToolbar, Position } from '@localixai/kit/canvas'
import { IconButton } from '@localixai/kit/icon-button'
import { Input } from '@localixai/kit/input'
import type { SpaceEdge } from '../../shared/format/document'
import { EDGE_CAPS } from '../../shared/format/schema'
import type { SpaceOp } from '../../shared/ops/contract'
import type { ElementControl } from '../elements/contract'
import { reverseEdgeOps } from './commands'
import { BarDivider, BarSurface, ChoicePicker, ColorPicker } from './pickers'

/**
 * The bar for one selected connector, over the elements it joins: its label, route, caps, line and
 * colour, cut to what the board file stores.
 */
const choice = (
  prop: string,
  label: string,
  values: readonly string[],
): Extract<ElementControl, { kind: 'choice' }> => ({
  kind: 'choice',
  prop,
  label,
  options: values.map((value) => ({ value, label: value[0]!.toUpperCase() + value.slice(1) })),
})
const ROUTE = choice('route', 'Route', ['curved', 'straight', 'elbow'])
const START = choice('start', 'Start', EDGE_CAPS)
const END = choice('end', 'End', EDGE_CAPS)
const STROKE = choice('stroke', 'Line', ['solid', 'dashed', 'dotted'])

export function EdgeBar({
  id,
  edge,
  commit,
}: {
  id: string
  edge: SpaceEdge
  commit: (ops: readonly SpaceOp[]) => void
}) {
  const [label, setLabel] = useState(edge.label ?? '')
  const write = (changes: Omit<Extract<SpaceOp, { op: 'edge' }>, 'op' | 'id'>) =>
    commit([{ op: 'edge', id, ...changes }])
  const saveLabel = () => {
    if (label !== (edge.label ?? '')) write({ label })
  }
  return (
    // Over the connector's two ends, pinned to them as the camera moves — where the selection
    // bar sits for an element. Docked at the top of the view, it was half a screen from the line
    // it styled on a wide board.
    <NodeToolbar nodeId={[edge.from, edge.to]} isVisible position={Position.Top} offset={14}>
      <BarSurface label="Connector actions">
        <Input
          aria-label="Connector label"
          placeholder="Label"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          onBlur={saveLabel}
          onKeyDown={(event) => {
            if (event.key === 'Enter') saveLabel()
            event.stopPropagation()
          }}
          size="md"
          className="w-40 text-2xs"
        />
        <BarDivider />
        <ChoicePicker
          control={ROUTE}
          value={edge.route ?? 'curved'}
          onPick={(route) => write({ route: route as never })}
        />
        <ChoicePicker
          control={START}
          value={edge.start ?? 'none'}
          onPick={(start) => write({ start: start as never })}
        />
        <ChoicePicker
          control={END}
          value={edge.end ?? 'triangle'}
          onPick={(end) => write({ end: end as never })}
        />
        <ChoicePicker
          control={STROKE}
          value={edge.stroke ?? 'solid'}
          onPick={(stroke) => write({ stroke: stroke as never })}
        />
        <ColorPicker
          label="Colour"
          value={edge.color ?? 'gray'}
          onPick={(color) => write({ color: color as never })}
        />
        <BarDivider />
        <IconButton
          size="sm"
          aria-label="Reverse"
          tooltip="Reverse the direction"
          onClick={() => commit(reverseEdgeOps(id, edge))}
        >
          <ArrowLeftRight className="size-3.5" />
        </IconButton>
        <IconButton
          size="sm"
          aria-label="Delete connector"
          tooltip="Delete"
          onClick={() => commit([{ op: 'delete', id }])}
        >
          <Trash2 className="size-3.5" />
        </IconButton>
      </BarSurface>
    </NodeToolbar>
  )
}
