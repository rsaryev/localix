import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { FLOW, nameLines, type LaidEdge, type LaidNode } from '../../shared/types/flow-layout'
import type { FlowNode } from '../../shared/types/flow-text'
import { shapePath } from './shape-path'

/**
 * A flowchart's two marks: a step (its outline for its shape, its name and sublabels) and a line
 * (its route, its heads, its caption beside it). Painted with the `space-flow-*` classes.
 */
const rounded = (w: number, h: number, r: number) =>
  `M ${r} 0 H ${w - r} A ${r} ${r} 0 0 1 ${w} ${r} V ${h - r} A ${r} ${r} 0 0 1 ${w - r} ${h} H ${r} A ${r} ${r} 0 0 1 0 ${h - r} V ${r} A ${r} ${r} 0 0 1 ${r} 0 Z`

function outline(node: FlowNode, w: number, h: number): string {
  switch (node.shape) {
    case 'rounded':
      return rounded(w, h, 12)
    case 'stadium':
      return rounded(w, h, h / 2)
    case 'circle':
      return `M ${w / 2} 0 A ${w / 2} ${h / 2} 0 1 1 ${w / 2} ${h} A ${w / 2} ${h / 2} 0 1 1 ${w / 2} 0 Z`
    case 'diamond':
    case 'hexagon':
    case 'parallelogram':
    case 'cylinder':
      return shapePath(node.shape, w, h, 0.5)
    case 'rect':
    case 'subroutine':
      return rounded(w, h, 6)
  }
}

export function Node({ node, laid }: { node: FlowNode; laid: LaidNode }) {
  const names = nameLines(node)
  const height = names * FLOW.node.name + (laid.lines.length - names) * FLOW.node.sub
  const lift = node.shape === 'cylinder' ? 6 : 0
  const top = laid.h / 2 - height / 2 + lift
  return (
    <g transform={`translate(${laid.x} ${laid.y})`}>
      <path
        d={outline(node, laid.w, laid.h)}
        className={cn('space-flow-node', node.role && `space-flow-${node.role}`)}
      />
      {node.shape === 'subroutine' && (
        <path d={`M 8 0 V ${laid.h} M ${laid.w - 8} 0 V ${laid.h}`} className="space-flow-rule" />
      )}
      {laid.lines.map((line, index) => {
        const sub = index >= names
        const y =
          top +
          (sub
            ? names * FLOW.node.name + (index - names + 0.5) * FLOW.node.sub
            : (index + 0.5) * FLOW.node.name)
        return (
          <text
            key={index}
            x={laid.w / 2}
            y={y}
            textAnchor="middle"
            dominantBaseline="central"
            className={sub ? 'space-flow-sub' : 'space-flow-name'}
          >
            {line}
          </text>
        )
      })}
    </g>
  )
}

export function Edge({ laid, focal }: { laid: LaidEdge; focal: boolean }) {
  const { edge } = laid
  const line = cn(
    'space-flow-edge',
    edge.line === 'dotted' && 'space-flow-dotted',
    (edge.line === 'thick' || focal) && 'space-flow-strong',
  )
  return (
    <g>
      <path d={laid.path} className={line} />
      {laid.heads.map(({ tip, toward }, index) => {
        const back = { x: tip.x - toward.x * FLOW.arrow, y: tip.y - toward.y * FLOW.arrow }
        const side = { x: -toward.y * 3.6, y: toward.x * 3.6 }
        return (
          <path
            key={index}
            d={`M ${tip.x} ${tip.y} L ${back.x + side.x} ${back.y + side.y} L ${back.x - side.x} ${back.y - side.y} Z`}
            className={cn(
              'space-flow-head',
              (edge.line === 'thick' || focal) && 'space-flow-strong',
            )}
          />
        )
      })}
      {laid.label && (
        <text
          x={laid.label.across ? laid.label.x : laid.label.x + 8}
          y={laid.label.across ? laid.label.y - 9 : laid.label.y}
          textAnchor={laid.label.across ? 'middle' : 'start'}
          dominantBaseline={laid.label.across ? 'auto' : 'central'}
          className="space-flow-label"
        >
          {edge.label}
        </text>
      )}
    </g>
  )
}
