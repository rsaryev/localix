import { z } from 'zod'
import { LANGUAGES } from './model'
import { crumbSchema, nodeSummarySchema } from './node-schema'

/**
 * The call lens: a symbol's code on the board, what calls it, and a TRAIL of the names you
 * followed from it — each one a card with its own code.
 *
 * The shape is Code Bubbles' working set: following a name opens its definition beside the last
 * card instead of replacing it, so the path of an explanation stays on screen. Only names the
 * graph resolved are links, at the exact token the source spells them — calls, and every other
 * use of a project declaration (a type, a constant, `ns.helper`), the way go-to-definition works.
 */
export const MAX_TRAIL = 6

export const codeLinkSchema = z.object({
  /** `call` runs the target; `ref` names it (a type, a constant, an imported value). */
  kind: z.enum(['call', 'ref']),
  /** 1-based line; columns are CHARACTER offsets in the tab-expanded line the card shows. */
  line: z.number(),
  column: z.number(),
  endColumn: z.number(),
  target: nodeSummarySchema,
})

export const codeCardSchema = z.object({
  node: nodeSummarySchema,
  /** File, then each enclosing symbol, then the symbol itself: the card's own breadcrumb. */
  outline: z.array(crumbSchema),
  language: z.enum(LANGUAGES).optional(),
  /** The line number of `lines[0]`. */
  startLine: z.number(),
  lines: z.array(z.string()),
  /** The symbol is longer than the card shows; the rest is one "open in editor" away. */
  truncated: z.boolean(),
  /** The file changed since it was indexed: links may point at shifted lines until it refreshes. */
  stale: z.boolean(),
  links: z.array(codeLinkSchema),
  /** Every distinct function this one calls, in the order it first calls them. */
  callees: z.array(nodeSummarySchema),
})

export const lensSchema = z.object({
  trail: z.array(codeCardSchema),
  /** What calls the first symbol of the trail. */
  callers: z.array(nodeSummarySchema),
})

export type CodeLink = z.infer<typeof codeLinkSchema>
export type CodeCard = z.infer<typeof codeCardSchema>
export type Lens = z.infer<typeof lensSchema>

/** Every declaration with source worth a card: what a link or a click on the map can open. */
export const LENS_KINDS: ReadonlySet<string> = new Set([
  'function',
  'method',
  'class',
  'interface',
  'type',
  'enum',
  'variable',
])
