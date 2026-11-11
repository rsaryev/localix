import type { PluginCatalog } from './catalog'
import type { PluginCommandSpec } from './contracts'

/**
 * Plugin slash-commands — a pure helper over the catalog, sibling of
 * `listViewsFromCatalog`. Extracted from the service so the
 * capability snapshot can flatten commands off the SAME catalog build it already made
 * for plugins/views, instead of re-running discovery once per contribution kind.
 */

/**
 * Flatten the slash-commands of every ENABLED plugin in scope into the specs the composer
 * renders, each `/<plugin>:<name>` as Claude Code names it. The text stays server-side.
 */
export function listCommandsFromCatalog(
  catalog: PluginCatalog,
  projectId: string,
): PluginCommandSpec[] {
  const commands: PluginCommandSpec[] = []
  for (const { plugin } of catalog.enabled) {
    if (!projectId && plugin.scope === 'project') continue
    for (const cmd of plugin.commands)
      commands.push({
        pluginName: plugin.manifest.name,
        name: cmd.name,
        fullName: `${plugin.manifest.name}:${cmd.name}`,
        description: cmd.description,
        args: [],
        ...(cmd.argumentHint ? { argumentHint: cmd.argumentHint } : {}),
      })
  }
  return commands
}

/**
 * The commands loaded mods registered, for the enabled plugins of the scope. A mod's command is
 * typed bare (`/tally`), as in Claude Code; it takes its argument string whole.
 */
export function modCommandSpecs(
  catalog: PluginCatalog,
  commands: ReadonlyArray<{
    plugin: string
    name: string
    description: string
    argumentHint?: string
  }>,
): PluginCommandSpec[] {
  const enabled = new Set(catalog.enabled.map((entry) => entry.plugin.manifest.name))
  return commands
    .filter((command) => enabled.has(command.plugin))
    .map((command) => ({
      pluginName: command.plugin,
      name: command.name,
      fullName: command.name,
      description: command.description,
      args: [],
      ...(command.argumentHint ? { argumentHint: command.argumentHint } : {}),
    }))
}
