import { z } from 'zod'
import { plainText } from '../content/rich-text'
import { colorSchema } from '../format/schema'
import type { ElementTypeSpec } from '../registry/contract'
import {
  ALIGNS,
  alignSchema,
  FONTS,
  fontSchema,
  INLINE_MARKS_HELP,
  inkShape,
  TEXT_STYLE_HELP,
  textStyleShape,
} from './text-style'

/**
 * The types a person DRAWS with: they hold their own content, and none of them points outside the
 * board. Each is one spec — props, size, text — and its look lives in `ui/elements`.
 */
/** `auto` sets the largest size the note's text fits at, as a sticky note does on paper. */
export const NOTE_SIZES = ['auto', 'sm', 'md', 'lg', 'xl'] as const

const noteProps = z.object({
  text: z.string().default(''),
  color: colorSchema.default('yellow'),
  size: z.enum(NOTE_SIZES).default('auto'),
  ...textStyleShape({ align: 'start', valign: 'top' }),
})

export const noteType: ElementTypeSpec<z.infer<typeof noteProps>> = {
  type: 'note',
  version: 2,
  label: 'Sticky note',
  description: `A coloured sticky note. props: text, color, size auto|sm|md|lg|xl (auto fits the text to the note), ${TEXT_STYLE_HELP}. ${INLINE_MARKS_HELP}; lines may be - bullets, 1. numbers or - [ ] tasks.`,
  props: noteProps,
  migrations: [(props) => ({ ...props, size: props.size ?? 'md' })],
  size: { w: 200, h: 200 },
  minSize: { w: 80, h: 60 },
  textProp: 'text',
  text: (props) => props.text,
  summary: (props) => plainText(props.text),
}

const textProps = z.object({
  text: z.string().default(''),
  size: z.enum(['sm', 'md', 'lg', 'xl']).default('md'),
  // A text element is as tall as what it renders, so it has no vertical alignment.
  font: fontSchema.default('sans'),
  align: alignSchema.default('start'),
  ...inkShape,
})

export const textType: ElementTypeSpec<z.infer<typeof textProps>> = {
  type: 'text',
  version: 1,
  label: 'Text',
  description: `Free text on the board, Markdown allowed; size sm|md|lg|xl for headings; font ${FONTS.join('|')}, align ${ALIGNS.join('|')}, ink (a text colour).`,
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
  ...textStyleShape({ align: 'center', valign: 'middle' }),
  ...inkShape,
})

export const shapeType: ElementTypeSpec<z.infer<typeof shapeProps>> = {
  type: 'shape',
  version: 1,
  label: 'Shape',
  description: `A diagram shape with a label: kind ${SHAPE_KINDS.join('|')} (cylinder = database, diamond = decision), text, color, fill none|tint|solid, stroke solid|dashed|dotted, size s|m|l|xl, ${TEXT_STYLE_HELP}, ink (a text colour). ${INLINE_MARKS_HELP}. Connect shapes to draw a flow.`,
  props: shapeProps,
  size: { w: 160, h: 96 },
  minSize: { w: 40, h: 32 },
  textProp: 'text',
  text: (props) => props.text,
  summary: (props) => plainText(props.text),
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
