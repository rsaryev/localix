import { useState } from 'react'
import {
  ArrowLeftRight,
  CornerDownRight,
  Equal,
  LineStyle,
  Minus,
  MoveLeft,
  MoveRight,
  Spline,
  SquarePlus,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import { NodeToolbar, Position } from '@localixai/kit/canvas'
import { IconButton } from '@localixai/kit/icon-button'
import { Input } from '@localixai/kit/input'
import type { SpaceDocument, SpaceEdge } from '../../shared/format/document'
import { EDGE_CAPS, EDGE_ROUTES, EDGE_STROKES, EDGE_WEIGHTS } from '../../shared/format/schema'
import type { SpaceOp } from '../../shared/ops/contract'
import type { ElementControl } from '../elements/contract'
import { insertOnEdgeOps, reverseEdgeOps } from './commands'
import { rememberLine } from './lastLook'
import { BarDivider, BarSurface, ColorPicker, StyleMenu } from './pickers'

/**
 * The bar for one selected connector, over the elements it joins: its label, then how the line
 * runs — route, ends, style and weight behind one Line menu — its colour, and what can be done to
 * it. Cut to what the board file stores.
 */
const named = (value: string) => value[0]!.toUpperCase() + value.slice(1)
const choice = (
  prop: string,
  label: string,
  values: readonly string[],
  icons: Partial<Record<string, LucideIcon>> = {},
): Extract<ElementControl, { kind: 'choice' }> => ({
  kind: 'choice',
  prop,
  label,
  options: values.map((value) => ({ value, label: named(value), Icon: icons[value] })),
})
const LINE_CONTROLS: readonly ElementControl[] = [
  choice('route', 'Route', EDGE_ROUTES, {
    curved: Spline,
    straight: Minus,
    elbow: CornerDownRight,
  }),
  { ...choice('start', 'Start', EDGE_CAPS), Icon: MoveLeft },
  { ...choice('end', 'End', EDGE_CAPS), Icon: MoveRight },
  { ...choice('stroke', 'Style', EDGE_STROKES), Icon: LineStyle },
  { ...choice('weight', 'Weight', EDGE_WEIGHTS), Icon: Equal },
]
/** What an absent field draws as, so the menu shows the current pick, never "Mixed". */
const DRAWN: Record<string, string> = {
  route: 'curved',
  start: 'none',
  end: 'triangle',
  stroke: 'solid',
  weight: 'regular',
}

export function EdgeBar({
  space,
  id,
  edge,
  commit,
}: {
  space: SpaceDocument
  id: string
  edge: SpaceEdge
  commit: (ops: readonly SpaceOp[]) => void
}) {
  const [label, setLabel] = useState(edge.label ?? '')
  const write = (changes: Omit<Extract<SpaceOp, { op: 'edge' }>, 'op' | 'id'>) => {
    // The next connector drawn takes this look, as a whiteboard remembers the last line style.
    rememberLine(changes)
    commit([{ op: 'edge', id, ...changes }])
  }
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
        <StyleMenu
          label="Line"
          Icon={LineStyle}
          controls={LINE_CONTROLS}
          valueOf={(prop) => {
            const value = edge[prop as keyof SpaceEdge]
            return typeof value === 'string' ? value : DRAWN[prop]
          }}
          onPick={(prop, value) => write({ [prop]: value } as never)}
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
          aria-label="Insert a shape"
          tooltip="Insert a shape into the line"
          onClick={() => {
            const insert = insertOnEdgeOps(space, id)
            if (insert) commit(insert.ops)
          }}
        >
          <SquarePlus className="size-3.5" />
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
