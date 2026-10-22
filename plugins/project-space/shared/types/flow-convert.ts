import type { SpaceDocument, SpaceElement } from '../format/document'
import { newId, takenIn } from '../format/ids'
import type { SpaceColor } from '../format/schema'
import type { SpaceOp } from '../ops/contract'
import type { SHAPE_KINDS } from './drawing'
import { layoutFlow, nameLines } from './flow-layout'
import type { FlowShape } from './flow-text'
import type { FlowProps } from './flow'

/**
 * A flowchart taken apart into the board's own pieces, where it drew them: a shape per step, a
 * connector per line, a frame per subgraph — so a person can move one step by hand, link a step to
 * the file it stands for, or restyle one line. What a step said stays: its name in bold, its
 * sublabels as code, a focal step in the chart's colour. The pieces are grouped, so the diagram
 * still moves as one until it is taken apart.
 *
 * Connectors that reached the flowchart itself go with it; there is no one step to move them to.
 */
const KIND: Record<FlowShape, (typeof SHAPE_KINDS)[number]> = {
  rect: 'rectangle',
  rounded: 'rounded',
  stadium: 'rounded',
  subroutine: 'rectangle',
  cylinder: 'cylinder',
  circle: 'ellipse',
  diamond: 'diamond',
  hexagon: 'hexagon',
  parallelogram: 'parallelogram',
}

export function flowToShapesOps(
  space: SpaceDocument,
  id: string,
  element: SpaceElement,
  props: FlowProps,
  random: () => number = Math.random,
): SpaceOp[] {
  const layout = layoutFlow(props, props.spacing)
  const taken = takenIn(space)
  const made = new Set<string>()
  const fresh = () => {
    const next = newId((candidate) => taken(candidate) || made.has(candidate), random)
    made.add(next)
    return next
  }
  const at = (x: number, y: number) => ({
    x: Math.round(element.x + x),
    y: Math.round(element.y + y),
  })
  const color = props.color as SpaceColor

  const frames: SpaceOp[] = layout.groups.map((group) => ({
    op: 'create',
    id: fresh(),
    type: 'frame',
    ...at(group.x, group.y),
    w: Math.round(group.w),
    h: Math.round(group.h),
    props: { title: group.label },
  }))
  const shapeOf = new Map<string, string>()
  const shapes: SpaceOp[] = props.nodes.flatMap((node) => {
    const laid = layout.nodes.get(node.id)
    if (!laid) return []
    const shape = fresh()
    shapeOf.set(node.id, shape)
    const names = nameLines(node)
    const text = [
      `**${laid.lines.slice(0, names).join(' ')}**`,
      ...laid.lines.slice(names).map((line) => `\`${line}\``),
    ].join('\n')
    return [
      {
        op: 'create',
        id: shape,
        type: 'shape',
        ...at(laid.x, laid.y),
        w: Math.round(laid.w),
        h: Math.round(laid.h),
        props: {
          kind: KIND[node.shape],
          text,
          size: 's',
          color: node.role === 'focal' ? color : 'gray',
          fill: node.role === 'store' ? 'solid' : 'tint',
          stroke: node.role === 'optional' ? 'dashed' : 'solid',
        },
      },
    ]
  })
  // The sides each line took in the chart are pinned: a decision's branch keeps its corner and a
  // loop keeps running around the outside, instead of every line taking the nearest side.
  // The board keeps one connector from a step to another, so lines with the same ends — `yes` and
  // `no` both to one step — become one connector carrying both labels rather than losing one.
  const pairs = new Map<string, { laid: (typeof layout.edges)[number]; labels: string[] }>()
  for (const laid of layout.edges) {
    const key = `${laid.edge.from}>${laid.edge.to}`
    const pair = pairs.get(key)
    if (pair) {
      if (laid.edge.label) pair.labels.push(laid.edge.label)
    } else pairs.set(key, { laid, labels: laid.edge.label ? [laid.edge.label] : [] })
  }
  const connectors: SpaceOp[] = [...pairs.values()].flatMap(({ laid: { edge, sides }, labels }) => {
    const from = shapeOf.get(edge.from)
    const to = shapeOf.get(edge.to)
    if (!from || !to || from === to) return []
    const label = labels.join(' / ')
    return [
      {
        op: 'connect',
        id: fresh(),
        from,
        to,
        fromSide: sides[0],
        toSide: sides[1],
        route: 'elbow',
        ...(label ? { label } : {}),
        ...(edge.line === 'dotted' ? { stroke: 'dashed' } : {}),
        ...(edge.line === 'thick' ? { weight: 'bold', color } : {}),
        ...(edge.head === 'none' ? { end: 'none' } : {}),
        ...(edge.head === 'both' ? { start: 'triangle' } : {}),
      } as SpaceOp,
    ]
  })
  const pieces = [...shapeOf.values()]
  return [
    { op: 'delete', id },
    ...frames,
    ...shapes,
    ...connectors,
    ...(pieces.length >= 2 ? [{ op: 'group' as const, ids: pieces }] : []),
  ]
}
