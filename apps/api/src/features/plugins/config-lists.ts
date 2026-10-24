/**
 * A `multiple` option's list (plugins/manifest-reference, `userConfig`): Localix stores it as a
 * JSON array of strings, the shape Claude Code's `pluginConfigs` keeps, and substitutes it into
 * `${user_config.KEY}` and `CLAUDE_PLUGIN_OPTION_<KEY>` as its items joined with commas.
 */

/** The items of a stored list, or undefined when `value` is no JSON array of strings. */
export function listItems(value: unknown): string[] | undefined {
  if (Array.isArray(value))
    return value.every((item) => typeof item === 'string') ? value : undefined
  if (typeof value !== 'string') return undefined
  if (value === '') return []
  try {
    return listItems(JSON.parse(value) as unknown)
  } catch {
    return undefined
  }
}

/** A list as one value for substitution: its items joined with commas. */
export const joinedList = (items: readonly string[]): string => items.join(',')
