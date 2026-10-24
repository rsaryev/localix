/**
 * An output style (`output-styles/<name>.md`): instructions that set the role, tone and format of
 * every reply in a session. The frontmatter is optional and a misspelled field is ignored, as in
 * Claude Code; the file name is the name unless `name` sets one. A plugin's style is offered as
 * `<plugin>:<name>`.
 */
export interface OutputStyle {
  name: string
  description: string
  /** Keep the host's built-in software engineering instructions beside the style. */
  keepCodingInstructions: boolean
  /** Plugin styles only: applies whenever the plugin is enabled, over the person's choice. */
  forceForPlugin: boolean
  /** The instructions: the file's body. */
  prompt: string
}

/** A frontmatter flag as Claude Code reads it: `true`, `yes`, `on` or `1`, in any case. */
const truthy = (value: unknown): boolean =>
  value === true ||
  value === 1 ||
  (typeof value === 'string' && ['true', 'yes', 'on', '1'].includes(value.trim().toLowerCase()))

/** Build a style from a file's stem, its parsed frontmatter fields and its body. */
export function outputStyleOf(
  fileStem: string,
  fields: Readonly<Record<string, unknown>>,
  body: string,
): OutputStyle {
  const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
  return {
    name: text(fields.name) || fileStem,
    description: text(fields.description),
    keepCodingInstructions: truthy(fields['keep-coding-instructions']),
    forceForPlugin: truthy(fields['force-for-plugin']),
    prompt: body.trim(),
  }
}

/** The style that means "no style": Claude Code lists it as `default`. */
export const DEFAULT_OUTPUT_STYLE = 'default'
