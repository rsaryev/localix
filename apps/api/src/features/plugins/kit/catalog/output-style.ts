import {
  BUILTIN_OUTPUT_STYLES,
  readOutputStyle,
  resolveOutputStyle,
  type OutputStyle,
} from '@rsaryev/llx-plugin/format'

export { DEFAULT_OUTPUT_STYLE_ID } from '@rsaryev/llx-plugin/format'

/**
 * An output style as a chat runs it: the kit's `OutputStyle` without where it was read from, so a
 * built-in style (which has no file) is one too. The instructions are trimmed.
 */
export type StyleBody = Pick<
  OutputStyle,
  'name' | 'description' | 'keepCodingInstructions' | 'forceForPlugin' | 'instructions'
>

/** The parts of a kit style a chat runs on. */
export const styleBody = (style: OutputStyle): StyleBody => ({
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
 * The id of the style in force, as the kit decides it (output-styles.md, "Change your output
 * style"): a `force-for-plugin` style over everything, else the `/output-style` choice (case
 * ignored), else the `outputStyle` setting (exact), else `default`. `styles` are the custom ones,
 * each under the id `/output-style` lists it by; the built-ins are the kit's.
 */
export const activeStyleId = (
  styles: readonly { readonly id: string; readonly style: StyleBody }[],
  choice: { readonly command?: string; readonly setting?: string },
): string =>
  resolveOutputStyle({
    ...choice,
    styles: styles.map(({ id, style }) => ({ ...style, id, path: id })),
  }).id
