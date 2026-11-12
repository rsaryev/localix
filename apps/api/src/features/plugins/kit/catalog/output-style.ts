import {
  BUILTIN_OUTPUT_STYLES,
  DEFAULT_OUTPUT_STYLE_ID,
  findOutputStyle,
  listOutputStyles,
  readOutputStyle,
  resolveOutputStyle,
  type OutputStyle,
} from '@rsaryev/llx-plugin/format'

export { DEFAULT_OUTPUT_STYLE_ID }

/**
 * An output style as a chat runs it: the kit's `OutputStyle` without where it was read from, so a
 * built-in style (which has no file) is one too. `id` is what `/output-style` and the `outputStyle`
 * setting call it, as the kit names it (`<plugin>:<name>` for a plugin's). The instructions are
 * trimmed.
 */
export type StyleBody = Pick<
  OutputStyle,
  'id' | 'name' | 'description' | 'keepCodingInstructions' | 'forceForPlugin' | 'instructions'
>

/** The parts of a kit style a chat runs on. */
export const styleBody = (style: OutputStyle): StyleBody => ({
  id: style.id,
  name: style.name,
  ...(style.description === undefined ? {} : { description: style.description }),
  keepCodingInstructions: style.keepCodingInstructions,
  forceForPlugin: style.forceForPlugin,
  instructions: style.instructions.trim(),
})

/**
 * A user's or project's style file as the kit reads it: a frontmatter that does not parse still
 * loads the style under its file name.
 */
export const outputStyleFile = (path: string, text: string): StyleBody =>
  styleBody(readOutputStyle(path, text).style)

/** The description the kit gives built-in style `id` (the docs' own words). */
export function builtinStyleDescription(id: string): string | undefined {
  return BUILTIN_OUTPUT_STYLES.find((style) => style.id === id)?.description
}

/**
 * What `/output-style <query>` names, as the kit matches its argument (`findOutputStyle`, case
 * ignored): a style's id, `default`, or undefined when it names nothing.
 */
export const commandStyleId = (styles: readonly StyleBody[], query: string): string | undefined =>
  findOutputStyle(kitStyles(styles), query)?.id

/**
 * The id of the style in force, as the kit decides it (output-styles.md, "Change your output
 * style"): a `force-for-plugin` style over everything, else the `/output-style` choice (case
 * ignored), else the `outputStyle` setting (exact), else `default`. `styles` are the custom ones,
 * each under the id `/output-style` lists it by; the built-ins are the kit's.
 */
export const activeStyleId = (
  styles: readonly StyleBody[],
  choice: { readonly command?: string; readonly setting?: string },
): string => resolveOutputStyle({ ...choice, styles: kitStyles(styles) }).id

const kitStyles = (styles: readonly StyleBody[]): OutputStyle[] =>
  styles.map((style) => ({ ...style, path: style.id }))

/**
 * The indexes of the custom `styles` `/output-style` offers, as the kit lists them
 * (`listOutputStyles`): of several that share an id the first wins, and one that reuses a built-in
 * id (or `default`) is never offered, so a custom style never shadows a built-in one.
 */
export function offeredStyleIndexes(styles: readonly StyleBody[]): number[] {
  const builtin = new Set(BUILTIN_OUTPUT_STYLES.map(({ id }) => id))
  const listed = new Set(
    listOutputStyles(kitStyles(styles), resolveOutputStyle({ styles: [] }))
      .map(({ id }) => id)
      .filter((id) => !builtin.has(id)),
  )
  return styles.flatMap(({ id }, index) => (listed.delete(id) ? [index] : []))
}
