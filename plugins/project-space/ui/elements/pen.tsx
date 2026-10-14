import { PenLine } from 'lucide-react'
import { penPath, PEN_WIDTH, type PenProps } from '../../shared/types/pen'
import { defineView, type ElementViewProps } from './contract'
import { colorControl } from './controls'

export function PenView({ props, width, height }: ElementViewProps<PenProps>) {
  const point = props.points[0]!
  return (
    <svg
      role="img"
      aria-label="Freehand drawing"
      width={width}
      height={height}
      viewBox={`0 0 ${props.canvas.w} ${props.canvas.h}`}
      preserveAspectRatio="none"
      className={`h-full w-full overflow-visible space-tone-${props.color}`}
    >
      {props.points.length === 1 ? (
        <circle cx={point.x} cy={point.y} r={PEN_WIDTH[props.size] / 2} fill="var(--space-tone)" />
      ) : (
        <path
          d={penPath(props.points)}
          fill="none"
          stroke="var(--space-tone)"
          strokeWidth={PEN_WIDTH[props.size]}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  )
}

export const penViews = [
  defineView({
    type: 'pen',
    View: PenView,
    Icon: PenLine,
    chrome: 'bare',
    controls: [
      colorControl,
      {
        kind: 'choice',
        prop: 'size',
        label: 'Stroke width',
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
    },
  }),
]
