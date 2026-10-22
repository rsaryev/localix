import type { z } from 'zod'

/**
 * What an element TYPE is: the one contract a new kind of thing on the board implements.
 *
 * The core — parsing, operations, the agent's view, the content pipeline — asks these questions
 * and never switches on a type name, so a new type is a new module registered in
 * `shared/types/index.ts` (and its view in `ui/elements/index.ts`), not an edit of the core. The
 * shape is cut to what this board uses:
 *
 * - `props` validates the CURRENT version and fills defaults, so every reader sees a whole value;
 * - `migrations[i]` upgrades props written at version `i + 1` to `i + 2`, so an old file loads as
 *   the current shape and a version is never skipped;
 * - `text` is what search, copy-as-text and the agent read — one answer per type;
 * - `claims` is the external content the type takes (a `.png`, a folder, a URL), so a drop, a
 *   paste and an agent's "put this file on the board" all choose the type the same way.
 *
 * Everything that draws lives in the UI half (`ui/elements`); nothing here imports React, so the
 * backend and the agent's tools understand every type without the view.
 */
export interface ElementTypeSpec<P extends Record<string, unknown> = Record<string, unknown>> {
  type: string
  version: number
  /** The name a person and the agent read: "Sticky note". */
  label: string
  /** One line for the agent: what the type is for and what its props mean. */
  description: string
  props: z.ZodObject<z.ZodRawShape, z.core.$strip> & z.ZodType<P>
  migrations?: readonly Migration[]
  size: { w: number; h: number }
  minSize?: { w: number; h: number }
  /** A container holds other elements (a frame); moving it moves them. */
  container?: boolean
  /** The prop an agent's `text` sugar writes, when the type has one main text. */
  textProp?: keyof P & string
  text(props: P): string
  /**
   * What a PERSON reads as the element's name in a list — a layers row, a search result — when
   * `text` is written for a reader of the file: a note's text without its `**` marks, a
   * flowchart's title and steps rather than its Mermaid. Absent, `text` is the name.
   */
  summary?(props: P): string
  /**
   * A type whose whole content has a TEXT form (a sequence diagram written as Mermaid): `text`
   * writes the element in that form and this reads it back, so the agent writes the diagram as
   * the text it knows, a person edits it as text, and a pasted Mermaid block becomes one. Returns
   * an error sentence for text it cannot read.
   */
  fromText?(text: string): Record<string, unknown> | string
  /**
   * A type whose size follows its content (a diagram's rows): the size an element of these props
   * needs. Creating or changing one resizes it; a person's resize is kept until the content changes.
   */
  measure?(props: P): { w: number; h: number }
  /** A pasted text this type takes as its own (a Mermaid `sequenceDiagram` block). */
  claimsText?(text: string): boolean
  /**
   * `fromText` refuses whatever it cannot keep, so a whole fenced Mermaid block may become this
   * type instead of the full Mermaid element: nothing in it can be lost on the way in.
   */
  exactText?: boolean
  claims?: ContentClaims
}

export type Migration = (props: Record<string, unknown>) => Record<string, unknown>

/**
 * The external content a type takes. A path is claimed by extension (lower-case, no dot) or, for
 * a folder, by `folder`; `rank` breaks a tie between two types claiming the same extension.
 */
export interface ContentClaims {
  extensions?: readonly string[]
  folder?: boolean
  url?: boolean
  rank?: number
  /** The props an element of this type starts with for a claimed path or URL. */
  fromPath?(path: string): Record<string, unknown>
  fromUrl?(url: string): Record<string, unknown>
}
