/**
 * The name a person reads for a plugin.
 *
 * `displayName` is optional in the manifest, and eleven call sites across the host and the API
 * each wrote `displayName || name` — so a plugin that omitted the field showed
 * its raw id: a settings list reading `database`, `office`, `webhook-notifier` between properly
 * named neighbours. A bare `||` cannot fix that, because `name` is a kebab id by contract
 * ({@link PLUGIN_NAME_RE}); the fallback has to TRANSLATE it.
 *
 * It lives here because every surface reads the same manifest, and one more copy of this rule is
 * how the surfaces disagreed in the first place.
 */

/** Words a plugin id may contain that are not capitalized as ordinary words. */
const ACRONYMS = new Map([
  ['api', 'API'],
  ['ai', 'AI'],
  ['cli', 'CLI'],
  ['db', 'DB'],
  ['devops', 'DevOps'],
  ['http', 'HTTP'],
  ['id', 'ID'],
  ['ide', 'IDE'],
  ['io', 'IO'],
  ['mcp', 'MCP'],
  ['sdk', 'SDK'],
  ['sql', 'SQL'],
  ['ssh', 'SSH'],
  ['tui', 'TUI'],
  ['ui', 'UI'],
  ['url', 'URL'],
])

/** `webhook-notifier` → `Webhook Notifier`, `api` → `API`. */
export function humanizePluginId(id: string): string {
  return id
    .split(/[-_]+/u)
    .filter((word) => word.length > 0)
    .map((word) => {
      const known = ACRONYMS.get(word.toLowerCase())
      if (known) return known
      return word.charAt(0).toUpperCase() + word.slice(1)
    })
    .join(' ')
}

/**
 * What to show for a plugin: its own `displayName`, or its id made readable. Never the raw id —
 * a kebab identifier in a list of names looks like the app failed to load something.
 */
export function pluginLabel(plugin: { name: string; displayName?: string | null }): string {
  const declared = plugin.displayName?.trim()
  return declared || humanizePluginId(plugin.name)
}
