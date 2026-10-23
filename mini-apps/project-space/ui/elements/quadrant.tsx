import { useRef, useState, type PointerEvent } from 'react'
import { Grid2x2 } from 'lucide-react'
import { toast } from '@localixai/mini-app-sdk/ui'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { readQuadrant, writeQuadrant, type QuadrantProps } from '../../shared/types/quadrant'
import { CardTitle } from './CardTitle'
import { CodeArea } from './CodeArea'
import { defineView, type ElementViewProps } from './contract'
import { colorControl } from './controls'
import { codeHighlighter } from './highlight'

/**
 * A 2×2 matrix drawn as a consultant would: two hairline axes through the middle, their ends
 * named along them, each quarter's name in its corner, items as dots with their names beside
 * them — the focal ones in the element's colour, the rest in ink, so position carries the
 * meaning and colour only the decision. Selected, an item is dragged to where it belongs; its
 * numbers are written when it is let go, one undo step.
 */
const highlight = codeHighlighter('mermaid')
const HEADER = 32
const PAD = 24
/** A caption's character at 12px, for whether it fits to the right of its dot. */
const LABEL_CHAR = 6.8

const ARROW_KEYS: Record<string, { x: number; y: number }> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: 1 },
  ArrowDown: { x: 0, y: -1 },
}

const clamp = (value: number) => Math.min(1, Math.max(0, Math.round(value * 100) / 100))

function QuadrantView({
  props,
  width,
  height,
  selected,
  editing,
  commit,
  stopEditing,
}: ElementViewProps<QuadrantProps>) {
  const svg = useRef<SVGSVGElement>(null)
  const [drag, setDrag] = useState<{ index: number; x: number; y: number } | null>(null)
  const title = props.title || '2×2 matrix'
  if (editing)
    return (
      <div className="flex h-full w-full flex-col">
        <CardTitle Icon={Grid2x2} title={title} badge="mermaid" />
        <div className="nowheel min-h-0 flex-1 overflow-auto">
          <CodeArea
            value={writeQuadrant(props)}
            highlight={highlight}
            onCommit={(text) => {
              const read = readQuadrant(text)
              if (typeof read === 'string') toast.error(`2×2 matrix: ${read}`)
              else commit(read)
            }}
            onDone={stopEditing}
            className="p-3"
            label="Edit the matrix as Mermaid"
          />
        </div>
      </div>
    )
  const plot = { x: PAD, y: HEADER + PAD, w: width - PAD * 2, h: height - HEADER - PAD * 2 }
  const cx = plot.x + plot.w / 2
  const cy = plot.y + plot.h / 2
  const at = (x: number, y: number) => ({ x: plot.x + x * plot.w, y: plot.y + (1 - y) * plot.h })
  const toValue = (event: PointerEvent) => {
    const box = svg.current!.getBoundingClientRect()
    const local = {
      x: ((event.clientX - box.left) / box.width) * width,
      y: ((event.clientY - box.top) / box.height) * height,
    }
    return { x: clamp((local.x - plot.x) / plot.w), y: clamp(1 - (local.y - plot.y) / plot.h) }
  }
  /** One item to a new place: one write, one undo step. */
  const moveItem = (index: number, x: number, y: number) => {
    const item = props.points[index]
    if (!item || (item.x === x && item.y === y)) return
    commit({ points: props.points.map((other, at) => (at === index ? { ...other, x, y } : other)) })
  }
  const [q1, q2, q3, q4] = props.quadrants
  // The quarters holding a focal item: washed in the tone, their names in it — where the eye goes.
  const hot = new Set<number>(
    props.points
      .filter((item) => item.focal)
      .map((item) => (item.y >= 0.5 ? (item.x >= 0.5 ? 1 : 2) : item.x >= 0.5 ? 4 : 3)),
  )
  const quarter = (n: number) => ({
    x: n === 2 || n === 3 ? plot.x : cx,
    y: n === 1 || n === 2 ? plot.y : cy,
  })
  const name = (n: number) => cn('space-quad-name', hot.has(n) && 'space-quad-name-hot')
  return (
    <div className={cn('relative h-full w-full', `space-tone-${props.color}`)}>
      <CardTitle Icon={Grid2x2} title={title} badge={`${props.points.length} items`} />
      <svg
        ref={svg}
        width={width}
        height={height}
        className="absolute left-0 top-0 overflow-visible"
        role="img"
        aria-label={`${title}: ${props.points.map((item) => item.label).join(', ')}`}
      >
        {[...hot].map((n) => (
          <rect
            key={n}
            {...quarter(n)}
            width={plot.w / 2}
            height={plot.h / 2}
            className="space-quad-wash"
          />
        ))}
        <line x1={plot.x} y1={cy} x2={plot.x + plot.w} y2={cy} className="space-quad-axis" />
        <line x1={cx} y1={plot.y} x2={cx} y2={plot.y + plot.h} className="space-quad-axis" />
        <text x={plot.x} y={cy + 16} className="space-quad-end">
          ← {props.xAxis.low}
        </text>
        <text x={plot.x + plot.w} y={cy + 16} textAnchor="end" className="space-quad-end">
          {props.xAxis.high} →
        </text>
        <text x={cx + 8} y={plot.y + 10} className="space-quad-end">
          ↑ {props.yAxis.high}
        </text>
        <text x={cx + 8} y={plot.y + plot.h - 2} className="space-quad-end">
          ↓ {props.yAxis.low}
        </text>
        <text x={plot.x + 12} y={plot.y + 26} className={name(2)}>
          {q2}
        </text>
        <text x={plot.x + plot.w - 12} y={plot.y + 26} textAnchor="end" className={name(1)}>
          {q1}
        </text>
        <text x={plot.x + 12} y={plot.y + plot.h - 14} className={name(3)}>
          {q3}
        </text>
        <text
          x={plot.x + plot.w - 12}
          y={plot.y + plot.h - 14}
          textAnchor="end"
          className={name(4)}
        >
          {q4}
        </text>
        {props.points.map((item, index) => {
          const value = drag?.index === index ? drag : item
          const place = at(value.x, value.y)
          const flip = place.x + 12 + item.label.length * LABEL_CHAR > plot.x + plot.w
          return (
            <g
              key={index}
              // Selected, an item is a control: Tab reaches it, the arrows move it.
              role={selected ? 'button' : undefined}
              tabIndex={selected ? 0 : undefined}
              aria-label={
                selected
                  ? `${item.label}: ${props.xAxis.high || 'x'} ${Math.round(item.x * 100)}%, ${props.yAxis.high || 'y'} ${Math.round(item.y * 100)}%. Arrow keys move it.`
                  : undefined
              }
              onKeyDown={
                selected
                  ? (event) => {
                      const step = event.shiftKey ? 0.1 : 0.02
                      const move = ARROW_KEYS[event.key]
                      if (!move) return
                      event.preventDefault()
                      event.stopPropagation()
                      moveItem(index, clamp(item.x + move.x * step), clamp(item.y + move.y * step))
                    }
                  : undefined
              }
              className={cn(
                selected && 'space-quad-item nodrag cursor-grab',
                drag?.index === index && 'cursor-grabbing',
              )}
              onPointerDown={
                selected
                  ? (event) => {
                      if (event.button !== 0) return
                      event.stopPropagation()
                      event.currentTarget.setPointerCapture(event.pointerId)
                      setDrag({ index, x: item.x, y: item.y })
                    }
                  : undefined
              }
              onPointerMove={
                drag?.index === index ? (event) => setDrag({ index, ...toValue(event) }) : undefined
              }
              onPointerUp={
                drag?.index === index
                  ? (event) => {
                      const { x, y } = toValue(event)
                      setDrag(null)
                      moveItem(index, x, y)
                    }
                  : undefined
              }
            >
              <circle
                cx={place.x}
                cy={place.y}
                r={item.focal ? 6 : 4.5}
                className={item.focal ? 'space-quad-focal' : 'space-quad-dot'}
              />
              {/* Beside the dot, on whichever side the plot has room for it. */}
              <text
                x={flip ? place.x - 12 : place.x + 12}
                y={place.y}
                textAnchor={flip ? 'end' : 'start'}
                dominantBaseline="central"
                className={cn('space-quad-label', item.focal && 'space-quad-label-focal')}
              >
                {item.label}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

export const quadrantViews = [
  defineView({
    type: 'quadrant',
    View: QuadrantView,
    Icon: Grid2x2,
    editable: true,
    chrome: 'card',
    controls: [colorControl],
    insert: {
      order: 5.5,
      description: 'Place items by two judgements, impact against effort',
      props: {
        points: [
          { label: 'Offline mode', x: 0.28, y: 0.82, focal: true },
          { label: 'Dark theme', x: 0.22, y: 0.32 },
          { label: 'New editor', x: 0.8, y: 0.74 },
        ],
      },
    },
  }),
]
