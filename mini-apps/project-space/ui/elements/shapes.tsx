import { Frame, Shapes } from 'lucide-react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import type { SpaceColor } from '../../shared/format/schema'
import type { TextAlign, TextFont, TextValign } from '../../shared/types/text-style'
import { defineView, type ElementViewProps } from './contract'
import { colorControl, fillControl, shapeKindControl, sizeControl, strokeControl } from './controls'
import { InlineText } from './InlineText'
import { InlineRichText } from './RichText'
import {
  alignControl,
  fontControl,
  inkControl,
  textStyleClass,
  VALIGN_CLASS,
  valignControl,
} from './text-style'
import { labelInset, shapePath, type ShapeKind } from './shape-path'

/**
 * Diagram shapes and frames. A shape is one SVG outline for its kind (`shape-path.ts`) under a
 * label kept inside the outline; a frame is a titled area whose title chip stays readable at any
 * zoom — it counter-scales, so a zoomed-out board is still a map
 * of named areas.
 */
type ShapeProps = {
  kind: ShapeKind
  text: string
  color: SpaceColor
  fill: 'none' | 'tint' | 'solid'
  stroke: 'solid' | 'dashed' | 'dotted'
  size: 's' | 'm' | 'l' | 'xl'
  font: TextFont
  align: TextAlign
  valign: TextValign
  ink?: SpaceColor
}

const LABEL: Record<ShapeProps['size'], string> = {
  s: 'text-xs',
  m: 'text-sm',
  l: 'text-lg font-medium',
  xl: 'text-2xl font-semibold',
}
const DASH = { solid: undefined, dashed: '8 6', dotted: '2 5' } as const
const STROKE = { s: 1.5, m: 2, l: 2.5, xl: 3 } as const

function ShapeView({
  props,
  width,
  height,
  editing,
  commit,
  stopEditing,
}: ElementViewProps<ShapeProps>) {
  const strokeWidth = STROKE[props.size]
  const inset = labelInset(props.kind)
  const outline = shapePath(props.kind, width, height, strokeWidth / 2 + 0.5)
  return (
    <div
      className={cn(
        'relative h-full w-full',
        `space-tone-${props.color}`,
        `space-shape-${props.fill}`,
      )}
    >
      {props.fill !== 'none' && (
        <div
          aria-hidden
          className="space-shape-material pointer-events-none absolute inset-0"
          style={{ clipPath: `path('${outline}')` }}
        />
      )}
      <svg aria-hidden width={width} height={height} className="absolute inset-0 overflow-visible">
        <path
          d={outline}
          className="space-shape"
          strokeWidth={strokeWidth}
          strokeDasharray={DASH[props.stroke]}
          strokeLinejoin="round"
        />
      </svg>
      <div
        className={cn(
          'absolute flex flex-col overflow-hidden leading-snug text-foreground',
          LABEL[props.size],
          textStyleClass(props),
        )}
        style={{ inset: `${inset.y * 100}% ${inset.x * 100}%` }}
      >
        {editing ? (
          <InlineText
            value={props.text}
            onCommit={(text) => commit({ text })}
            onDone={stopEditing}
            className={cn(LABEL[props.size], textStyleClass(props))}
            formatting
          />
        ) : (
          <div className={cn('w-full break-words', VALIGN_CLASS[props.valign])}>
            <InlineRichText text={props.text} />
          </div>
        )}
      </div>
    </div>
  )
}

type FrameProps = { title: string; color?: SpaceColor }

/**
 * A frame's title stays readable from afar: `space-frame-title` counter-scales it with the
 * camera (up to 3.5×) in CSS. It used to read the zoom as React state, and every frame of the
 * board re-rendered on every frame of a pinch to redraw one small label.
 */
function FrameView({ props, editing, commit, stopEditing }: ElementViewProps<FrameProps>) {
  return (
    <div
      className={cn(
        'relative h-full w-full rounded-xl border space-frame',
        props.color && `space-tone-${props.color}`,
      )}
    >
      <div className="space-frame-title absolute bottom-full left-0 mb-1.5 origin-bottom-left">
        {editing ? (
          <div className="lx-floating-surface w-56 rounded-md border border-control-border bg-popover px-2 py-1">
            <InlineText
              value={props.title}
              onCommit={(title) => commit({ title })}
              onDone={stopEditing}
              className="text-xs font-medium"
            />
          </div>
        ) : (
          <span className="space-frame-chip lx-floating-surface inline-flex h-6 max-w-96 items-center truncate rounded-md border border-control-border bg-popover px-2 text-xs font-medium">
            {props.title || 'Frame'}
          </span>
        )}
      </div>
    </div>
  )
}

export const shapeViews = [
  defineView({
    type: 'shape',
    View: ShapeView,
    Icon: Shapes,
    editable: true,
    chrome: 'bare',
    outlined: true,
    insert: {
      order: 2,
      key: 's',
      primary: true,
      variantProp: 'kind',
      description: 'Draw a shape for a flow or diagram',
    },
    controls: [
      shapeKindControl,
      colorControl,
      fillControl,
      strokeControl,
      fontControl,
      sizeControl(['s', 'm', 'l', 'xl']),
      alignControl,
      valignControl,
      inkControl,
    ],
  }),
  defineView({
    type: 'frame',
    View: FrameView,
    Icon: Frame,
    editable: true,
    chrome: 'bare',
    outlined: true,
    insert: { order: 3, key: 'f', primary: true, description: 'Group an area under a title' },
    controls: [colorControl],
  }),
]
