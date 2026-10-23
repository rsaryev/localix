import { z } from 'zod'
import { colorSchema } from '../format/schema'
import type { ElementTypeSpec } from '../registry/contract'
import { FLOW, layoutFlow } from './flow-layout'
import {
  FLOW_DIRECTIONS,
  FLOW_HEADS,
  FLOW_LINES,
  FLOW_ROLES,
  FLOW_SHAPES,
  isFlowText,
  readFlow,
  writeFlow,
  type FlowContent,
} from './flow-text'

/**
 * A NATIVE flowchart: steps, decisions and stores joined by connectors, laid out by itself. Drawn
 * from shapes and lines placed by hand, a twelve-step flow is an afternoon of nudging; written as
 * Mermaid it is twelve lines the agent already knows, and the board draws it to its own standard
 * — right-angled lines, one or two focal steps, captions beside the line.
 *
 * It is written and read as Mermaid (`text`/`fromText`), sized by its layout (`measure`), and a
 * pasted `flowchart` the board can draw whole becomes one (`claimsText`); anything it cannot draw
 * stays a full Mermaid element.
 */
const node = z.object({
  id: z.string().trim().min(1),
  label: z.string().default(''),
  shape: z.enum(FLOW_SHAPES).default('rect'),
  role: z.enum(FLOW_ROLES).optional(),
  group: z.string().optional(),
})
const edge = z.object({
  from: z.string().trim().min(1),
  to: z.string().trim().min(1),
  label: z.string().default(''),
  line: z.enum(FLOW_LINES).default('solid'),
  head: z.enum(FLOW_HEADS).default('arrow'),
})
const group = z.object({ id: z.string().trim().min(1), label: z.string().default('') })

export const FLOW_SPACINGS = ['narrow', 'regular', 'wide'] as const

const flowProps = z
  .object({
    title: z.string().default(''),
    /** The accent of its focal steps, from the board's palette like a shape's. */
    color: colorSchema.default('blue'),
    direction: z.enum(FLOW_DIRECTIONS).default('TB'),
    spacing: z.enum(FLOW_SPACINGS).default('regular'),
    nodes: z.array(node).default([]),
    edges: z.array(edge).default([]),
    groups: z.array(group).default([]),
  })
  .superRefine((props, context) => {
    const nodes = new Set(props.nodes.map((entry) => entry.id))
    const groups = new Set(props.groups.map((entry) => entry.id))
    props.edges.forEach((entry, index) => {
      for (const end of ['from', 'to'] as const)
        if (!nodes.has(entry[end]))
          context.addIssue({
            code: 'custom',
            path: ['edges', index, end],
            message: `"${entry[end]}" is not a node`,
          })
    })
    props.nodes.forEach((entry, index) => {
      if (entry.group && !groups.has(entry.group))
        context.addIssue({
          code: 'custom',
          path: ['nodes', index, 'group'],
          message: `"${entry.group}" is not a group`,
        })
    })
  })

export type FlowProps = z.infer<typeof flowProps>

/** The element's size for a laid-out chart: the drawing, never narrower than one step. */
export const flowSize = (layout: { width: number; height: number }) => ({
  w: Math.max(FLOW.node.min + FLOW.pad * 2, layout.width),
  h: layout.height,
})

export const flowType: ElementTypeSpec<FlowProps> = {
  type: 'flow',
  version: 1,
  label: 'Flowchart',
  description:
    'A native flowchart that lays itself out: steps, decisions, stores, subgraphs. Easiest: pass `text` as Mermaid — "flowchart LR", then "A[Plan] --> B(Build)", "B -->|ok| C{Ready?}", "C -.->|no| D[(DB)]", "subgraph api [API] … end". Shapes: [rect] (rounded) ([stadium]) [[subroutine]] [(database)] ((circle)) {decision} {{hexagon}} [/io/]. Mark one or two key steps focal with "A:::focal" (also :::store, :::external, :::optional). Line breaks in a label: <br/>; the lines after the first are drawn as technical sublabels. props.direction TB|LR|BT|RL, props.spacing narrow|regular|wide, props.color tints focal steps.',
  props: flowProps as unknown as ElementTypeSpec<FlowProps>['props'],
  size: { w: 480, h: 320 },
  minSize: { w: 200, h: 120 },
  text: (props) => writeFlow(props as FlowContent),
  summary: (props) =>
    [props.title || 'Flowchart', props.nodes.map((node) => node.label.split('\n')[0]).join(', ')]
      .filter(Boolean)
      .join(': '),
  fromText: (text) => readFlow(text) as ReturnType<NonNullable<ElementTypeSpec['fromText']>>,
  measure: (props) => flowSize(layoutFlow(props as FlowContent, props.spacing)),
  claimsText: (text) => isFlowText(text) && typeof readFlow(text) !== 'string',
  exactText: true,
}
