import { Workflow } from 'lucide-react'
import { toast } from '@localixai/mini-app-sdk/ui'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import type { SpaceColor } from '../../shared/format/schema'
import { layoutSequence, SEQUENCE } from '../../shared/types/sequence-layout'
import {
  readSequence,
  writeSequence,
  type SequenceContent,
  type SequenceMessage,
  type SequenceParticipant,
} from '../../shared/types/sequence-text'
import { CardTitle } from './CardTitle'
import { CodeArea } from './CodeArea'
import { defineView, type ElementViewProps } from './contract'
import { colorControl } from './controls'
import { highlightSequence } from './highlight'
import { shapePath } from './shape-path'

/**
 * A sequence diagram as a card of the board: the card, title row and type of a snippet, heads
 * drawn with the board's own shape outlines and palette (a database is the same cylinder a flow
 * uses), dashed lifelines, and one row per message — numbered, so "step 3" can be said in chat.
 * Where everything goes is `layoutSequence`, the function that also sized the element, so the
 * drawing fills the card exactly. Editing is the Mermaid text, coloured as it is typed.
 *
 * Every paint is a `space-seq-*` class over the board's tokens (`space.css`), never a utility
 * over the host's: an SVG whose fill a missing rule leaves unset paints BLACK, and the first
 * version of this view drew a black box with its lines gone for exactly that reason.
 */
type SequenceProps = SequenceContent & { color: SpaceColor }

const { head: HEAD } = SEQUENCE

function Head({
  participant,
  x,
  top,
  width,
}: {
  participant: SequenceParticipant
  x: number
  top: number
  width: number
}) {
  const label = participant.label ?? participant.id
  const actor = participant.kind === 'actor'
  const outline =
    participant.kind === 'database'
      ? shapePath('cylinder', width, HEAD.h + 8)
      : actor
        ? pill(width, HEAD.h)
        : shapePath('rounded', width, HEAD.h)
  const lift = participant.kind === 'database' ? 4 : 0
  return (
    <g transform={`translate(${x - width / 2} ${top - lift})`}>
      <path d={outline} className="space-shape space-shape-tint" strokeWidth={1.25} />
      {actor && <ActorGlyph x={16} y={HEAD.h / 2 + lift} />}
      <text
        x={width / 2 + (actor ? 7 : 0)}
        y={HEAD.h / 2 + lift + (participant.kind === 'database' ? 4 : 0)}
        dominantBaseline="central"
        textAnchor="middle"
        className="space-seq-name"
      >
        {label}
      </text>
    </g>
  )
}

const pill = (w: number, h: number) =>
  `M ${h / 2} 1 H ${w - h / 2} A ${h / 2 - 1} ${h / 2 - 1} 0 0 1 ${w - h / 2} ${h - 1} H ${h / 2} A ${h / 2 - 1} ${h / 2 - 1} 0 0 1 ${h / 2} 1 Z`

/** A person, drawn in the head's tone: a head and shoulders. */
function ActorGlyph({ x, y }: { x: number; y: number }) {
  return (
    <g className="space-seq-glyph">
      <circle cx={x} cy={y - 4} r={3} />
      <path d={`M ${x - 5.5} ${y + 6.5} a 5.5 5 0 0 1 11 0`} />
    </g>
  )
}

function Message({
  message,
  index,
  from,
  to,
  y,
}: {
  message: SequenceMessage
  index: number
  from: number
  to: number
  y: number
}) {
  const line = cn('space-seq-line', message.kind === 'return' && 'space-seq-return')
  const label = (
    <>
      <tspan className="space-seq-index">{index + 1}</tspan>
      {message.text ? `  ${message.text}` : ''}
    </>
  )
  if (from === to) {
    const loop = SEQUENCE.selfLoop
    return (
      <g>
        <path d={`M ${from} ${y - 9} h ${loop} v 18 h ${-loop + 6}`} className={line} />
        <Tip x={from} y={y + 9} direction={-1} filled={message.kind === 'sync'} />
        <text x={from + loop + 8} y={y} dominantBaseline="central" className="space-seq-label">
          {label}
        </text>
      </g>
    )
  }
  const direction = Math.sign(to - from)
  const tip = to - direction * 1.5
  return (
    <g>
      <line x1={from} y1={y} x2={tip - direction * 7} y2={y} className={line} />
      <Tip x={tip} y={y} direction={direction} filled={message.kind === 'sync'} />
      <text x={(from + to) / 2} y={y - 8} textAnchor="middle" className="space-seq-label">
        {label}
      </text>
    </g>
  )
}

/** A call's head is filled; an async message's and a return's are open, as Mermaid draws them. */
function Tip({
  x,
  y,
  direction,
  filled,
}: {
  x: number
  y: number
  direction: number
  filled: boolean
}) {
  const back = x - direction * 9
  return filled ? (
    <path d={`M ${back} ${y - 4.5} L ${x} ${y} L ${back} ${y + 4.5} Z`} className="space-seq-tip" />
  ) : (
    <path d={`M ${back} ${y - 5} L ${x} ${y} L ${back} ${y + 5}`} className="space-seq-line" />
  )
}

function SequenceView({ props, editing, commit, stopEditing }: ElementViewProps<SequenceProps>) {
  const title = props.title || 'Sequence'
  const badge = `${props.messages.length} step${props.messages.length === 1 ? '' : 's'}`
  if (editing)
    return (
      <div className="flex h-full w-full flex-col">
        <CardTitle Icon={Workflow} title={title} badge="mermaid" />
        <div className="nowheel min-h-0 flex-1 overflow-auto">
          <CodeArea
            value={writeSequence(props)}
            highlight={highlightSequence}
            onCommit={(text) => {
              const read = readSequence(text)
              if (typeof read === 'string') toast.error(`Sequence diagram: ${read}`)
              else commit(read)
            }}
            onDone={stopEditing}
            className="p-3"
            label="Edit the diagram as Mermaid"
          />
        </div>
      </div>
    )
  const layout = layoutSequence(props)
  return (
    <div className={cn('relative h-full w-full', `space-tone-${props.color}`)}>
      <CardTitle Icon={Workflow} title={title} badge={badge} />
      <svg
        width={layout.width}
        height={layout.height}
        className="absolute left-0 top-0 overflow-visible"
        role="img"
        aria-label={`${title}: ${props.participants.length} participants, ${badge}`}
      >
        {props.participants.map((participant) => {
          const x = layout.columns.get(participant.id) ?? 0
          return (
            <line
              key={`life-${participant.id}`}
              x1={x}
              y1={layout.top + HEAD.h}
              x2={x}
              y2={layout.foot}
              className="space-seq-lifeline"
            />
          )
        })}
        {props.messages.map((message, index) => (
          <Message
            key={index}
            message={message}
            index={index}
            from={layout.columns.get(message.from) ?? 0}
            to={layout.columns.get(message.to) ?? 0}
            y={layout.rowY(index)}
          />
        ))}
        {props.participants.flatMap((participant) =>
          [layout.top, layout.foot].map((top) => (
            <Head
              key={`${participant.id}-${top}`}
              participant={participant}
              x={layout.columns.get(participant.id) ?? 0}
              top={top}
              width={layout.headWidth}
            />
          )),
        )}
      </svg>
    </div>
  )
}

export const sequenceViews = [
  defineView({
    type: 'sequence',
    View: SequenceView,
    Icon: Workflow,
    editable: true,
    chrome: 'card',
    controls: [colorControl],
    insert: {
      order: 4,
      description: 'Map interactions between participants',
      // D for diagram: Q is the rail's "keep the tool armed", asked first, so a Q here never armed.
      key: 'd',
      props: {
        participants: [
          { id: 'Client', kind: 'actor' },
          { id: 'Service', kind: 'participant' },
        ],
        messages: [
          { from: 'Client', to: 'Service', text: 'request', kind: 'sync' },
          { from: 'Service', to: 'Client', text: 'response', kind: 'return' },
        ],
      },
    },
  }),
]
