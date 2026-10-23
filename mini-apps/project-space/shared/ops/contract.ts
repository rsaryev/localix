import { z as miniAppZod } from 'zod'
import { COLORS, EDGE_CAPS, EDGE_ROUTES, EDGE_STROKES, EDGE_WEIGHTS, SIDES } from '../format/schema'
import { GAP } from './geometry'

/**
 * The ONE language every change to the board is spoken in: a person's drag, a paste, the
 * agent's tool, an undo. Each operation is small and names its target by id, so a batch is
 * applied pointwise — the operation that is wrong is reported and the rest land — and the agent
 * repairs one line instead of resending a board.
 *
 * Coordinates are optional on `create`: `in` puts the element into a frame and `near` beside an
 * element, and placement finds the free spot. `text` writes the type's main text, whatever its
 * prop is called, so the agent need not learn each type's field names to label something.
 *
 * Built by a factory over a zod namespace because the agent tool must declare its input with the
 * HOST's zod (`ctx.z`, which turns it into the model's JSON schema) and the routes validate with
 * the mini app's own: one definition, two instances, never two copies that drift.
 */
type Zod = typeof miniAppZod

export const STACKING = ['front', 'forward', 'backward', 'back'] as const
export const ALIGN_EDGES = ['left', 'center', 'right', 'top', 'middle', 'bottom'] as const
export const AXES = ['horizontal', 'vertical'] as const
export const LAYOUTS = ['row', 'column', 'grid'] as const

export function buildOpSchemas(z: Zod) {
  const id = z.string().trim().min(1)
  const geometry = {
    x: z.number().optional().describe('Left edge in board pixels.'),
    y: z.number().optional().describe('Top edge in board pixels; y grows downwards.'),
    w: z.number().positive().optional(),
    h: z.number().positive().optional(),
  }
  const props = z
    .record(z.string(), z.unknown())
    .describe('Type-specific fields, as the element types list them.')
  const opacity = z
    .number()
    .min(0.05)
    .max(1)
    .optional()
    .describe('0.05–1; 1 is opaque. A faded element recedes, as a background does.')
  const edgeStyle = {
    label: z.string().optional(),
    route: z.enum(EDGE_ROUTES).optional().describe('curved (default), straight or elbow.'),
    start: z.enum(EDGE_CAPS).optional().describe('Cap at the start; none by default.'),
    end: z.enum(EDGE_CAPS).optional().describe('Cap at the end; triangle by default.'),
    stroke: z.enum(EDGE_STROKES).optional(),
    weight: z.enum(EDGE_WEIGHTS).optional().describe('thin, regular (default) or bold.'),
    color: z.enum(COLORS).optional(),
    labelAt: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe('Where the label sits along the line, 0 to 1; 0.5 (the middle) by default.'),
  }

  const create = z.object({
    op: z.literal('create'),
    type: z.string().trim().min(1),
    id: id.optional().describe('An id of your choosing, so later operations can name it.'),
    ...geometry,
    in: id.optional().describe('A frame to place it inside; with no x/y a free spot is found.'),
    near: id.optional().describe('An element to place it beside, when x/y are not given.'),
    text: z
      .string()
      .optional()
      .describe('The main text: a note’s text, a shape’s label, a frame’s title.'),
    props: props.optional(),
    locked: z.boolean().optional(),
    opacity,
  })
  const update = z.object({
    op: z.literal('update'),
    id,
    type: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        'Turn it into another kind (note, shape, text, flow…) where it stands: its id, place, stacking, groups and connectors stay; props then start from the new kind’s defaults.',
      ),
    ...geometry,
    text: z.string().optional(),
    props: props
      .optional()
      .describe('Merged over the current props; a key set to null returns to its default.'),
    locked: z.boolean().optional(),
    opacity,
  })
  const remove = z.object({
    op: z.literal('delete'),
    id: id.describe('An element (its connectors go with it) or a connector.'),
  })
  const connect = z.object({
    op: z.literal('connect'),
    id: id.optional(),
    from: id,
    to: id,
    fromSide: z.enum(SIDES).optional().describe('Pin a side; omit to attach to the nearest one.'),
    toSide: z.enum(SIDES).optional(),
    ...edgeStyle,
  })
  const edge = z.object({
    op: z.literal('edge'),
    id,
    fromSide: z.enum(SIDES).nullable().optional().describe('null unpins the side.'),
    toSide: z.enum(SIDES).nullable().optional(),
    ...edgeStyle,
  })
  // Every multi-element operation takes element ids or group ids; a group id stands for its members.
  const ids = z.array(id).min(1).describe('Element ids, or group ids for all their members.')
  const order = z.object({
    op: z.literal('order'),
    ids,
    to: z
      .enum(STACKING)
      .describe(
        'front/back: above or below everything; forward/backward: one step past the next element that overlaps them.',
      ),
  })
  const group = z.object({
    op: z.literal('group'),
    ids: ids.min(2),
    id: id.optional().describe('The new group’s id; one is made when omitted.'),
  })
  const ungroup = z.object({ op: z.literal('ungroup'), id: id.describe('A group id.') })
  const align = z.object({
    op: z.literal('align'),
    ids: ids.min(2),
    edge: z.enum(ALIGN_EDGES).describe('Line them up on this edge of the box around them.'),
  })
  const distribute = z.object({
    op: z.literal('distribute'),
    ids: ids.min(3),
    axis: z.enum(AXES).describe('Equal gaps between them, the outer two staying where they are.'),
  })
  const arrange = z.object({
    op: z.literal('arrange'),
    ids: ids.optional().describe('What to lay out, in this order; omit with `in` for a frame’s.'),
    in: id
      .optional()
      .describe('A frame: lay out what it holds, in reading order, and fit the frame around it.'),
    layout: z.enum(LAYOUTS),
    gap: z.number().min(0).max(400).optional().describe(`Space between them; ${GAP} by default.`),
    columns: z.number().int().min(1).max(50).optional().describe('For a grid.'),
  })

  const op = z.discriminatedUnion('op', [
    create,
    update,
    remove,
    connect,
    edge,
    order,
    group,
    ungroup,
    align,
    distribute,
    arrange,
  ])
  return { create, update, arrange, op, ops: z.array(op).min(1).max(200) }
}

const schemas = buildOpSchemas(miniAppZod)

export const spaceOpsSchema = schemas.ops
export type SpaceOp = miniAppZod.infer<typeof schemas.op>
export type CreateOp = miniAppZod.infer<typeof schemas.create>
export type UpdateOp = miniAppZod.infer<typeof schemas.update>
export type ArrangeOp = miniAppZod.infer<typeof schemas.arrange>
export type Stacking = (typeof STACKING)[number]
export type AlignEdge = (typeof ALIGN_EDGES)[number]
export type Axis = (typeof AXES)[number]
export type Layout = (typeof LAYOUTS)[number]

/** What one operation did: the id it touched, or why it was refused (and nothing changed). */
export type OpResult = { ok: true; id: string; note?: string } | { ok: false; error: string }
