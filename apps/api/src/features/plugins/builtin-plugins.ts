import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { InvalidRequestError } from '../../lib/domain-errors'
import { envString } from '../../lib/env'
import type { DiscoveredPlugin } from './discovery-types'
import { scanDirs } from './discovery-directory-scan'

/**
 * BUILT-IN PLUGINS: Claude Code plugins that ship inside Localix, like Claude Code's `@builtin`
 * origin. Their source is the repository's `plugins/<name>/`; a build stages them beside the server
 * bundle (`resources/builtin-plugins/`) and the dev launcher stages them for the dev API, naming the
 * folder with `LOCALIX_BUILTIN_PLUGINS_DIR`. A source checkout run without either has none.
 *
 * A built-in plugin is listed as `<name>@builtin`, is on unless its manifest says
 * `defaultEnabled: false`, can be switched off (a capability rule, like any plugin), and is neither
 * uninstalled nor updated on its own: it updates with Localix. Discovery reads it first, so it holds
 * its name over every installed copy; a copy of the same name elsewhere is reported on it, not
 * loaded (`builtinShadowNotes`).
 */
export const BUILTIN_ORIGIN = 'builtin'

const STAGED_DIR = 'builtin-plugins'

/** Where the built-in plugins are, or null when this run ships none. */
export function builtinPluginsRoot(): string | null {
  const override = envString('LOCALIX_BUILTIN_PLUGINS_DIR')
  if (override) return override
  // Packaged: this module is bundled into `resources/server.js`, beside `resources/builtin-plugins`.
  const staged = join(dirname(fileURLToPath(import.meta.url)), STAGED_DIR)
  return existsSync(staged) ? staged : null
}

/** The built-in plugins, as global plugins projected into `projectId`. */
export async function discoverBuiltinPlugins(projectId: string): Promise<DiscoveredPlugin[]> {
  const root = builtinPluginsRoot()
  if (!root) return []
  const found = await scanDirs(root, [''], 'global', projectId)
  return found.map((plugin) => ({ ...plugin, builtin: true }))
}

/** Where a copy that lost its name to a built-in plugin came from, in words. */
function originOf(plugin: DiscoveredPlugin): string {
  if (plugin.claudeCodeInstall) return `installed in Claude Code as ${plugin.claudeCodeInstall}`
  if (plugin.cachedInstall) return `installed from ${plugin.cachedInstall.id}`
  if (plugin.inPlaceInstall) return `installed from ${plugin.inPlaceInstall}`
  return plugin.scope === 'project' ? "in the project's plugins" : 'in your plugins folder'
}

/**
 * The built-in plugins, each carrying a note for every other copy of its name that does not load
 * because the built-in one holds the name (Claude Code's "Not loaded — the name is already taken").
 */
export function builtinShadowNotes(
  builtins: DiscoveredPlugin[],
  others: DiscoveredPlugin[][],
): DiscoveredPlugin[] {
  return builtins.map((builtin) => {
    const shadowed = others.flat().filter((other) => other.manifest.name === builtin.manifest.name)
    if (shadowed.length === 0) return builtin
    return {
      ...builtin,
      shadowNotes: shadowed.map(
        (other) =>
          `Another copy of "${other.manifest.name}" (${originOf(other)}, at ${other.dir}) is not loaded: the name is taken by the built-in plugin. Uninstall that copy to clear this note.`,
      ),
    }
  })
}

/**
 * Refuse what a built-in plugin does not do on its own: it is uninstalled and updated only with
 * Localix itself. Switching it off is the person's way to stop it.
 */
export function assertNotBuiltin(
  plugin: Pick<DiscoveredPlugin, 'builtin' | 'manifest'> | null | undefined,
  action: 'uninstall' | 'update',
): void {
  if (!plugin?.builtin) return
  const name = plugin.manifest.name
  throw new InvalidRequestError(
    'plugin_builtin',
    action === 'update'
      ? `"${name}" is built into Localix and updates with Localix.`
      : `"${name}" is built into Localix and cannot be uninstalled. Turn it off instead.`,
  )
}

/** Refuse installing a plugin under a name a built-in plugin holds. */
export async function assertNameNotBuiltin(name: string): Promise<void> {
  const builtins = await discoverBuiltinPlugins('')
  if (!builtins.some((plugin) => plugin.manifest.name === name)) return
  throw new InvalidRequestError(
    'plugin_builtin',
    `"${name}" is built into Localix, so another copy of it is not installed. It updates with Localix.`,
  )
}
