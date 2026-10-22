import { z } from 'zod'
import { colorSchema } from '../format/schema'

/**
 * How an element's text is SET, apart from what it says: the face, where it sits in its box and,
 * for a type that offers one, its colour. One vocabulary for every type that carries text, so a
 * pick over a note and a shape writes the same props and the agent learns them once.
 *
 * Every field is additive with a default: a board written before they existed reads as it always
 * drew, and a build that does not know a field carries it through untouched.
 *
 * The faces are ROLES, not font names — `hand` is "written by hand", resolved by the view to what
 * the platform has — so a board drawn on one machine reads the same on another and no font file
 * travels with the board.
 */
export const FONTS = ['sans', 'serif', 'mono', 'hand'] as const
export const ALIGNS = ['start', 'center', 'end'] as const
export const VALIGNS = ['top', 'middle', 'bottom'] as const

export type TextFont = (typeof FONTS)[number]
export type TextAlign = (typeof ALIGNS)[number]
export type TextValign = (typeof VALIGNS)[number]

export const fontSchema = z.enum(FONTS)
export const alignSchema = z.enum(ALIGNS)
export const valignSchema = z.enum(VALIGNS)

/** The props a type spreads into its schema, with the defaults that type reads best at. */
export function textStyleShape(defaults: { align: TextAlign; valign: TextValign }) {
  return {
    font: fontSchema.default('sans'),
    align: alignSchema.default(defaults.align),
    valign: valignSchema.default(defaults.valign),
  }
}

/** A text colour apart from the element's own tone; absent is the theme's ink. */
export const inkShape = { ink: colorSchema.optional() }

/** The one line the agent reads for these props, in every type's description. */
export const TEXT_STYLE_HELP = `font ${FONTS.join('|')}, align ${ALIGNS.join('|')}, valign ${VALIGNS.join('|')}`

/** Inline marks the board draws inside notes and shape labels (see `shared/content/rich-text`). */
export const INLINE_MARKS_HELP =
  'Text may use **bold**, *italic*, ++underline++, ~~strike~~, ==highlight== and `code`'
