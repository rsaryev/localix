import { useEffect, useEffectEvent, useMemo } from 'react'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  FoldHorizontal,
  Network,
  Shapes,
} from 'lucide-react'
import { toast } from '@localixai/mini-app-sdk/ui'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import type { SpaceColor } from '../../shared/format/schema'
import { layoutFlow, type FlowSpacing } from '../../shared/types/flow-layout'
import { flowSize } from '../../shared/types/flow'
import { flowToShapesOps } from '../../shared/types/flow-convert'
import { readFlow, writeFlow, type FlowContent } from '../../shared/types/flow-text'
import { CardTitle } from './CardTitle'
import { CodeArea } from './CodeArea'
import { Edge, Node } from './flow-parts'
import { FlowSteps } from './FlowSteps'
import { defineView, type ElementControl, type ElementViewProps } from './contract'
import { colorControl } from './controls'
import { codeHighlighter } from './highlight'

/**
 * A flowchart drawn to the board's standard: neutral steps with one or two focal ones in the
 * element's colour, lines at right angles with rounded corners, a caption beside its line on the
 * card's own ground. Where everything goes is `layoutFlow`, the function that also sized the
 * element, so the drawing fills the card exactly. Editing is the Mermaid text.
 *
 * Every paint is a `space-flow-*` class over the board's tokens (`space-text.css`): an SVG whose fill a
 * missing rule leaves unset paints black.
 */
type FlowProps = FlowContent & { title: string; color: SpaceColor; spacing: FlowSpacing }

const highlight = codeHighlighter('mermaid')

/**
 * The element follows its drawing: a board saved before a layout improvement holds the size the
 * old layout needed, and the drawing ran over its card. Written back once, when they differ.
 */
function useFollowLayout(
  size: { w: number; h: number } | null,
  { width, height, resize }: Pick<ElementViewProps, 'width' | 'height' | 'resize'>,
) {
  const write = useEffectEvent(resize)
  const w = size?.w
  const h = size?.h
  useEffect(() => {
    if (w === undefined || h === undefined) return
    if (Math.abs(w - width) > 2 || Math.abs(h - height) > 2) write({ w, h })
  }, [w, h, width, height])
}

function FlowView({
  props,
  editing,
  selected,
  commit,
  stopEditing,
  width,
  height,
  resize,
}: ElementViewProps<FlowProps>) {
  // One layout per change of the chart: dagre is the costly part, and a selection or a hover
  // re-renders the view without changing what it draws.
  const layout = useMemo(() => layoutFlow(props, props.spacing), [props])
  useFollowLayout(editing ? null : flowSize(layout), { width, height, resize })
  const title = props.title || 'Flowchart'
  const badge = `${props.nodes.length} step${props.nodes.length === 1 ? '' : 's'}`
  if (editing)
    return (
      <div className="flex h-full w-full flex-col">
        <CardTitle Icon={Network} title={title} badge="mermaid" />
        <div className="nowheel min-h-0 flex-1 overflow-auto">
          <CodeArea
            value={writeFlow(props)}
            highlight={highlight}
            onCommit={(text) => {
              const read = readFlow(text)
              if (typeof read === 'string') toast.error(`Flowchart: ${read}`)
              else commit(read)
            }}
            onDone={stopEditing}
            className="p-3"
            label="Edit the flowchart as Mermaid"
          />
        </div>
      </div>
    )
  const focal = new Set(props.nodes.filter((node) => node.role === 'focal').map((node) => node.id))
  return (
    <div className={cn('relative h-full w-full', `space-tone-${props.color}`)}>
      <CardTitle Icon={Network} title={title} badge={badge} />
      <svg
        width={layout.width}
        height={layout.height}
        className="pointer-events-none absolute left-0 top-0 overflow-visible"
        role="img"
        aria-label={`${title}: ${badge}, ${props.edges.length} connections`}
      >
        {layout.groups.map((group) => (
          <g key={group.id}>
            <rect
              x={group.x}
              y={group.y}
              width={group.w}
              height={group.h}
              rx={10}
              className="space-flow-group"
            />
            <text x={group.x + 12} y={group.y + 15} className="space-flow-group-title">
              {group.label}
            </text>
          </g>
        ))}
        {/* Lines before boxes, so a line ends at a box's edge and never crosses its words. */}
        {layout.edges.map((laid, index) => (
          <Edge
            key={index}
            laid={laid}
            focal={focal.has(laid.edge.from) && focal.has(laid.edge.to)}
          />
        ))}
        {props.nodes.map((node) => {
          const laid = layout.nodes.get(node.id)
          return laid ? <Node key={node.id} node={node} laid={laid} /> : null
        })}
      </svg>
      {props.nodes.length === 0 && (
        <p className="absolute inset-x-0 bottom-6 text-center text-xs text-text-faint">
          Double-click to write the flowchart
        </p>
      )}
      <FlowSteps
        nodes={props.nodes}
        layout={layout}
        selected={selected}
        rename={(id, label) =>
          commit({ nodes: props.nodes.map((node) => (node.id === id ? { ...node, label } : node)) })
        }
      />
    </div>
  )
}

const directionControl: ElementControl = {
  kind: 'choice',
  prop: 'direction',
  label: 'Direction',
  options: [
    { value: 'TB', label: 'Top to bottom', Icon: ArrowDown },
    { value: 'LR', label: 'Left to right', Icon: ArrowRight },
    { value: 'BT', label: 'Bottom to top', Icon: ArrowUp },
    { value: 'RL', label: 'Right to left', Icon: ArrowLeft },
  ],
}

const spacingControl: ElementControl = {
  kind: 'choice',
  prop: 'spacing',
  label: 'Spacing',
  Icon: FoldHorizontal,
  options: [
    { value: 'narrow', label: 'Narrow' },
    { value: 'regular', label: 'Regular' },
    { value: 'wide', label: 'Wide' },
  ],
}

export const flowViews = [
  defineView({
    type: 'flow',
    View: FlowView,
    Icon: Network,
    editable: true,
    chrome: 'card',
    controls: [colorControl, directionControl, spacingControl],
    actions: [
      {
        label: 'Convert to shapes',
        Icon: Shapes,
        ops: ({ id, element, props, space }) => flowToShapesOps(space, id, element, props),
      },
    ],
    insert: {
      order: 5,
      key: 'w',
      description: 'A flowchart that lays itself out, written as Mermaid',
      props: {
        direction: 'LR',
        nodes: [
          { id: 'start', label: 'Request', shape: 'stadium' },
          { id: 'check', label: 'Valid?', shape: 'diamond' },
          { id: 'work', label: 'Handle it', shape: 'rect', role: 'focal' },
          { id: 'reject', label: 'Reject', shape: 'rounded' },
        ],
        edges: [
          { from: 'start', to: 'check', label: '', line: 'solid', head: 'arrow' },
          { from: 'check', to: 'work', label: 'yes', line: 'solid', head: 'arrow' },
          { from: 'check', to: 'reject', label: 'no', line: 'dotted', head: 'arrow' },
        ],
      },
    },
  }),
]
