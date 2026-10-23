import { memo, useRef } from 'react'
import {
  EdgeLabelRenderer,
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
  useInternalNode,
  type Edge,
  type EdgeProps,
  type Position,
} from '@xyflow/react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { EdgeCaption } from './EdgeCaption'
import { edgeCap, type EdgeCap } from './edge-caps'
import { floatingEnds, type HandleSide } from './edge-geometry'

/**
 * Every board's edge — the default edge type of `Canvas`, so an edge without a `type` gets it.
 *
 * The flow library's default edge was invisible in the app: its stroke and arrow colours were CSS
 * variables in SVG presentation ATTRIBUTES, where `var()` does not resolve, so the marker came out
 * black and the line not at all while the label kept a white box. Here the colour is a text colour
 * set with the host's token classes, the SVG paints with `currentColor`, the arrowhead is part of
 * the edge (`edge-geometry.ts` says why), and the label is an HTML pill in the host's type.
 *
 * An edge says what it MEANS — its emphasis, tone and weight — and this file owns how that looks,
 * so two boards never disagree about what a dimmed or a warning line is.
 */
export type CanvasEdgeEmphasis = 'focus' | 'idle' | 'dimmed'
export type CanvasEdgeTone = 'neutral' | 'info' | 'warning'

export interface CanvasEdgeData extends Record<string, unknown> {
  emphasis?: CanvasEdgeEmphasis
  /** The colour at rest; a focused edge is always the focus colour. */
  tone?: CanvasEdgeTone
  /** Stroke width; `edgeWeight(count)` turns a relation count into one. */
  weight?: number
  /** When the head is drawn; 'focus' keeps an overview free of arrow clutter. */
  arrow?: 'always' | 'focus' | 'never'
  /** A short pill at the middle, shown while the edge is focused. */
  label?: string
  /** 'step' for right-angled routing between aligned rows (an ER diagram), 'straight' for a ruler. */
  route?: 'bezier' | 'step' | 'straight'
  /** Attach each end to the side facing the other node, following moves (`floatingEnds`). */
  float?: boolean
  /** Sides a floating edge keeps, whatever faces where. */
  fromSide?: HandleSide
  toSide?: HandleSide
  /** A head at the source as well: a two-way relation. */
  tail?: boolean
  /** Explicit caps at each end; when either is set they replace `arrow`/`tail`. */
  startCap?: EdgeCap
  endCap?: EdgeCap
  stroke?: 'solid' | 'dashed' | 'dotted'
  /** Show the label at rest too, as a whiteboard does; a graph shows it only on focus. */
  labelAlways?: boolean
  /**
   * The label is a caption a person wrote: plain text beside the line (`EdgeCaption`), never on
   * it, at `labelAt` (0…1, the middle by default) of the way along.
   */
  caption?: boolean
  labelAt?: number
  /** Let the caption be dragged along its line; called with where it was let go. */
  onLabelMove?: (at: number) => void
  /** A click on the caption selects its edge (it lies off the line, where no click reaches). */
  onLabelSelect?: () => void
  /** The owner's own colour class at rest, for a board whose edges carry a colour. */
  toneClass?: string
}

const DASH = { solid: undefined, dashed: '7 5', dotted: '1.5 4' } as const

export type CanvasEdgeType = Edge<CanvasEdgeData>

const ARROW = 5

const REST: Record<CanvasEdgeTone, string> = {
  neutral: 'text-text-faint opacity-35',
  info: 'text-status-info opacity-50',
  warning: 'text-status-warning opacity-60',
}
const FOCUS = 'text-status-info opacity-90'
const DIMMED = 'text-text-faint opacity-10'

function CanvasEdgeImpl(props: EdgeProps<CanvasEdgeType>) {
  const { selected, data } = props
  const ends = useEnds(props)
  const emphasis = selected ? 'focus' : (data?.emphasis ?? 'idle')
  const weight = data?.weight ?? 1.25
  const capSize = 3.5 + weight * 1.2
  const explicit = data?.startCap !== undefined || data?.endCap !== undefined
  const arrow = data?.arrow ?? 'always'
  const drawHead = arrow === 'always' || (arrow === 'focus' && emphasis === 'focus')
  const endKind = explicit ? (data?.endCap ?? 'none') : drawHead ? 'triangle' : 'none'
  const startKind = explicit
    ? (data?.startCap ?? 'none')
    : drawHead && data?.tail
      ? 'triangle'
      : 'none'
  const head = edgeCap(endKind, ends.target, ends.target.side, explicit ? capSize : ARROW)
  const tail = edgeCap(startKind, ends.source, ends.source.side, explicit ? capSize : ARROW)
  const end = head?.lineEnd ?? ends.target
  const start = tail?.lineEnd ?? ends.source
  const route = {
    sourceX: start.x,
    sourceY: start.y,
    sourcePosition: ends.source.side as Position,
    targetX: end.x,
    targetY: end.y,
    targetPosition: ends.target.side as Position,
  }
  const [path, labelX, labelY] =
    data?.route === 'step'
      ? getSmoothStepPath({ ...route, borderRadius: 8 })
      : data?.route === 'straight'
        ? getStraightPath(route)
        : getBezierPath(route)
  const line = useRef<SVGPathElement>(null)
  const tone =
    emphasis === 'focus'
      ? FOCUS
      : emphasis === 'dimmed'
        ? DIMMED
        : (data?.toneClass ?? REST[data?.tone ?? 'neutral'])
  return (
    <>
      {/* The line is a hairline; this invisible band is what a pointer can actually hit. */}
      <path
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={14}
        className="react-flow__edge-interaction"
      />
      <g className={cn('transition-opacity duration-(--dur-fast)', tone)}>
        <path
          ref={line}
          d={path}
          fill="none"
          stroke="currentColor"
          strokeWidth={weight}
          strokeLinecap="round"
          strokeDasharray={DASH[data?.stroke ?? 'solid']}
        />
        {[head, tail].map(
          (cap, index) =>
            cap && (
              <path
                key={index}
                d={cap.path}
                fill={cap.filled ? 'currentColor' : 'none'}
                stroke="currentColor"
                strokeWidth={cap.filled ? 1 : weight}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ),
        )}
      </g>
      {(emphasis === 'focus' || data?.labelAlways) &&
        data?.label &&
        (data.caption ? (
          <EdgeCaption
            path={line}
            d={path}
            label={data.label}
            at={data.labelAt}
            fallback={{ x: labelX, y: labelY }}
            emphasis={emphasis}
            onMove={data.onLabelMove}
            onSelect={data.onLabelSelect}
          />
        ) : (
          <EdgeLabelRenderer>
            <div
              // For a board that hides small print when zoomed out: which element is a label, and
              // whether its edge is the one being looked at (a focused label stays).
              data-canvas-edge-label=""
              data-emphasis={emphasis}
              style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
              // `bg-card`, the lift a node on the board uses: the pill must hide the line under
              // it, and a ground token read as a black chip on the dark theme.
              className="pointer-events-none absolute rounded-full border border-status-info/40 bg-card px-1.5 font-mono text-3xs leading-4 text-status-info tabular-nums"
            >
              {data.label}
            </div>
          </EdgeLabelRenderer>
        ))}
    </>
  )
}

/**
 * Where the two ends are: the handles the library routed to, or — for a floating edge whose
 * nodes are both measured — the facing sides of the nodes themselves.
 */
function useEnds(props: EdgeProps<CanvasEdgeType>) {
  const source = useInternalNode(props.source)
  const target = useInternalNode(props.target)
  const handles = {
    source: { x: props.sourceX, y: props.sourceY, side: props.sourcePosition as HandleSide },
    target: { x: props.targetX, y: props.targetY, side: props.targetPosition as HandleSide },
  }
  if (!props.data?.float || !source || !target) return handles
  const rect = (node: NonNullable<typeof source>) => ({
    ...node.internals.positionAbsolute,
    width: node.measured.width ?? node.width ?? 0,
    height: node.measured.height ?? node.height ?? 0,
  })
  return floatingEnds(rect(source), rect(target), {
    source: props.data.fromSide,
    target: props.data.toSide,
  })
}

export const CanvasEdge = memo(CanvasEdgeImpl)
