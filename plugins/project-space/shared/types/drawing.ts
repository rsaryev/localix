import { z } from 'zod'
import { colorSchema } from '../format/schema'
import type { ElementTypeSpec } from '../registry/contract'

/**
 * The types a person DRAWS with: they hold their own content, and none of them points outside the
 * board. Each is one spec — props, size, text — and its look lives in `ui/elements`.
 */
const noteProps = z.object({
  text: z.string().default(''),
  color: colorSchema.default('yellow'),
  size: z.enum(['sm', 'md', 'lg', 'xl']).default('md'),
})

export const noteType: ElementTypeSpec<z.infer<typeof noteProps>> = {
  type: 'note',
  version: 2,
  label: 'Sticky note',
  description:
    'A coloured sticky note with a fixed text size. props: text, color, size sm|md|lg|xl.',
  props: noteProps,
  migrations: [(props) => ({ ...props, size: props.size ?? 'md' })],
  size: { w: 200, h: 200 },
  minSize: { w: 80, h: 60 },
  textProp: 'text',
  text: (props) => props.text,
}

const textProps = z.object({
  text: z.string().default(''),
  size: z.enum(['sm', 'md', 'lg', 'xl']).default('md'),
})

export const textType: ElementTypeSpec<z.infer<typeof textProps>> = {
  type: 'text',
  version: 1,
  label: 'Text',
  description: 'Free text on the board, Markdown allowed; size sm|md|lg|xl for headings.',
  props: textProps,
  size: { w: 280, h: 80 },
  minSize: { w: 60, h: 28 },
  textProp: 'text',
  text: (props) => props.text,
}

/**
 * The flowchart set every diagramming board ships (basic and flowchart shapes), plus the three an engineering board keeps reaching for: a cylinder for a database, a
 * document, a cloud. Adding a kind is adding its outline in `ui/elements/shape-path.ts`.
 */
export const SHAPE_KINDS = [
  'rectangle',
  'rounded',
  'ellipse',
  'diamond',
  'triangle',
  'hexagon',
  'parallelogram',
  'cylinder',
  'document',
  'cloud',
  'star',
] as const

const shapeProps = z.object({
  kind: z.enum(SHAPE_KINDS).default('rounded'),
  text: z.string().default(''),
  color: colorSchema.default('blue'),
  fill: z.enum(['none', 'tint', 'solid']).default('tint'),
  stroke: z.enum(['solid', 'dashed', 'dotted']).default('solid'),
  size: z.enum(['s', 'm', 'l', 'xl']).default('m'),
})

export const shapeType: ElementTypeSpec<z.infer<typeof shapeProps>> = {
  type: 'shape',
  version: 1,
  label: 'Shape',
  description: `A diagram shape with a label: kind ${SHAPE_KINDS.join('|')} (cylinder = database, diamond = decision), text, color, fill none|tint|solid, stroke solid|dashed|dotted, size s|m|l|xl. Connect shapes to draw a flow.`,
  props: shapeProps,
  size: { w: 160, h: 96 },
  minSize: { w: 40, h: 32 },
  textProp: 'text',
  text: (props) => props.text,
}

const frameProps = z.object({
  title: z.string().default('Frame'),
  color: colorSchema.optional(),
})

export const frameType: ElementTypeSpec<z.infer<typeof frameProps>> = {
  type: 'frame',
  version: 1,
  label: 'Frame',
  description:
    'A titled area that holds every element lying wholly inside it (there is no parent field: membership is where things are); moving it moves them. props: title, color.',
  props: frameProps,
  size: { w: 640, h: 420 },
  minSize: { w: 160, h: 120 },
  container: true,
  textProp: 'title',
  text: (props) => props.title,
}

const codeProps = z.object({
  code: z.string().default(''),
  /** A highlighter language id (`ts`, `python`…); empty lets the view guess. */
  language: z.string().default(''),
  title: z.string().default(''),
})

export const codeType: ElementTypeSpec<z.infer<typeof codeProps>> = {
  type: 'code',
  version: 1,
  label: 'Code snippet',
  description:
    'A code snippet kept on the board itself, highlighted. props: code, language, title. To show a file of the project, use a file element instead.',
  props: codeProps,
  size: { w: 380, h: 220 },
  minSize: { w: 160, h: 80 },
  textProp: 'code',
  text: (props) => [props.title, props.code].filter(Boolean).join('\n'),
}
