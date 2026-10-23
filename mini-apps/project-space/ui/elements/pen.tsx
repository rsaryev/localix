import { Equal, Eraser, Highlighter, PenLine } from 'lucide-react'
import { HIGHLIGHTER_SCALE, penPath, PEN_WIDTH, type PenProps } from '../../shared/types/pen'
import { defineView, type ElementControl, type ElementViewProps } from './contract'
import { colorControl } from './controls'

/**
 * A freehand stroke. A highlighter's is wide and translucent with square ends, so it reads as a
 * mark laid over words rather than a line drawn beside them.
 */
export function PenView({ props, width, height }: ElementViewProps<PenProps>) {
  const point = props.points[0]!
  const highlight = props.kind === 'highlighter'
  const stroke = PEN_WIDTH[props.size] * (highlight ? HIGHLIGHTER_SCALE : 1)
  return (
    <svg
      role="img"
      aria-label="Freehand drawing"
      width={width}
      height={height}
      viewBox={`0 0 ${props.canvas.w} ${props.canvas.h}`}
      preserveAspectRatio="none"
      className={`h-full w-full overflow-visible space-tone-${props.color}`}
      opacity={highlight ? 0.38 : undefined}
    >
      {props.points.length === 1 ? (
        <circle cx={point.x} cy={point.y} r={stroke / 2} fill="var(--space-tone)" />
      ) : (
        <path
          d={penPath(props.points)}
          fill="none"
          stroke="var(--space-tone)"
          strokeWidth={stroke}
          strokeLinecap={highlight ? 'butt' : 'round'}
          strokeLinejoin="round"
        />
      )}
    </svg>
  )
}

const penKind = (label: string): Extract<ElementControl, { kind: 'choice' }> => ({
  kind: 'choice',
  prop: 'kind',
  label,
  options: [
    { value: 'pen', label: 'Pen', Icon: PenLine },
    { value: 'highlighter', label: 'Highlighter', Icon: Highlighter },
  ],
})

export const penViews = [
  defineView({
    type: 'pen',
    View: PenView,
    Icon: PenLine,
    chrome: 'bare',
    controls: [
      colorControl,
      penKind('Stroke'),
      {
        kind: 'choice',
        prop: 'size',
        label: 'Stroke width',
        Icon: Equal,
        options: [
          { value: 's', label: 'Thin' },
          { value: 'm', label: 'Medium' },
          { value: 'l', label: 'Thick' },
          { value: 'xl', label: 'Extra thick' },
        ],
      },
    ],
    insert: {
      order: 3.5,
      key: 'p',
      primary: true,
      gesture: 'draw',
      description: 'Draw freehand with your mouse, pen or touch',
      // The eraser is a way of using the pen: it takes strokes away and is never a stroke itself.
      variants: {
        ...penKind('Pen'),
        options: [...penKind('Pen').options, { value: 'eraser', label: 'Eraser', Icon: Eraser }],
      },
    },
  }),
]
