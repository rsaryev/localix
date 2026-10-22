import { z } from 'zod'

/**
 * The board file, as it is written to `<project>/.localix/project-space/space.json`.
 *
 * The file is the board: a person, the agent's own file tools and git all read the same bytes, so
 * its shape is small and flat. An element is an ENVELOPE the core owns — where it is, how big, where
 * it stacks — around `props` that only its type understands. The core never reads `props`; that is what lets a new element type be one module instead
 * of a change here.
 *
 * What a frame holds is not stored: an element is in a frame when all four of its corners are
 * inside it (Kinopio's boxes, Advanced Canvas' groups). A stored parent goes stale the moment a
 * hand edit or an agent moves one of the two, and the board then shows a note "in" a frame it sits
 * nowhere near; geometry cannot disagree with itself.
 *
 * Every object is loose: a key this version does not know (a field a newer Project Space added, a
 * note a person wrote by hand) is carried through a read and a write unchanged: a board edited by a newer build and saved by an older one must not
 * lose anything.
 */
export const SPACE_FORMAT = 'localix.project-space'
export const SPACE_VERSION = 1

export const SIDES = ['top', 'right', 'bottom', 'left'] as const
export const sideSchema = z.enum(SIDES)
export type Side = z.infer<typeof sideSchema>

/** Named colours, resolved to the host's theme by the view; a hex would ignore dark mode. */
export const COLORS = [
  'gray',
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
] as const
export const colorSchema = z.enum(COLORS)
export type SpaceColor = z.infer<typeof colorSchema>

/**
 * Connector vocabulary. The caps are the kit edge's own set (`EDGE_CAPS` in the host canvas),
 * restated here as data because the board file must not depend on the host UI to be read.
 */
export const EDGE_ROUTES = ['curved', 'straight', 'elbow'] as const
export const EDGE_CAPS = ['none', 'arrow', 'triangle', 'circle', 'diamond', 'bar'] as const
export const EDGE_STROKES = ['solid', 'dashed', 'dotted'] as const
export const EDGE_WEIGHTS = ['thin', 'regular', 'bold'] as const

const finite = z.number().refine(Number.isFinite, 'must be a finite number')
const size = finite.refine((value) => value > 0, 'must be greater than 0')

export const elementSchema = z.looseObject({
  type: z.string().min(1),
  x: finite,
  y: finite,
  w: size,
  h: size,
  /** Stacking order: a fractional index, so a reorder rewrites one element and not the list. */
  z: z.string().min(1).optional(),
  /** A locked element neither moves nor takes the pointer: a background stays a background. */
  locked: z.boolean().optional(),
  /** 0.05–1; absent is opaque. On the envelope, so any element can recede. */
  opacity: z.number().min(0.05).max(1).optional(),
  /**
   * The groups the element belongs to, innermost first. A group is only
   * the id its members share — no record of its own that a hand edit could leave pointing at
   * elements that are gone — so a group of one is simply no group, and nesting is the list.
   */
  groups: z.array(z.string().min(1)).optional(),
  props: z.record(z.string(), z.unknown()).optional(),
})

export const edgeSchema = z.looseObject({
  from: z.string().min(1),
  to: z.string().min(1),
  /** Pinned attachment sides; absent means the nearest side, chosen as elements move. */
  fromSide: sideSchema.optional(),
  toSide: sideSchema.optional(),
  label: z.string().optional(),
  /** How it runs: a curve (the default), a straight ruler line, or right-angled elbows. */
  route: z.enum(EDGE_ROUTES).optional(),
  /** The caps at each end: none at the start and a filled triangle at the end by default. */
  start: z.enum(EDGE_CAPS).optional(),
  end: z.enum(EDGE_CAPS).optional(),
  stroke: z.enum(EDGE_STROKES).optional(),
  /** The stroke's weight; absent is regular. */
  weight: z.enum(EDGE_WEIGHTS).optional(),
  color: colorSchema.optional(),
  /** Where the label sits along the line, 0 (start) to 1 (end); absent is the middle. */
  labelAt: z.number().min(0).max(1).optional(),
})

export const spaceFileSchema = z.looseObject({
  format: z.literal(SPACE_FORMAT),
  version: z.number().int().positive(),
  /** The props version each element type was written with — the key to its migrations. */
  types: z.record(z.string(), z.number().int().positive()).optional(),
  elements: z.record(z.string(), z.unknown()).optional(),
  edges: z.record(z.string(), z.unknown()).optional(),
})

export type ElementRecord = z.infer<typeof elementSchema>
export type EdgeRecord = z.infer<typeof edgeSchema>
