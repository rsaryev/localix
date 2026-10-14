import type { PluginCatalog } from './catalog'
import type { PluginCommandSpec } from './contracts'

/**
 * Plugin slash-commands — a pure helper over the catalog, sibling of
 * `listViewsFromCatalog`. Extracted from the service so the
 * capability snapshot can flatten commands off the SAME catalog build it already made
 * for plugins/views, instead of re-running discovery once per contribution kind.
 */

/**
 * Flatten the slash-commands declared by every ENABLED plugin in scope into
 * namespaced specs the composer can render. The `prompt` template stays server-side
 * (rendered during dispatch); only arg metadata is exposed.
 */
export function listCommandsFromCatalog(
  catalog: PluginCatalog,
  projectId: string,
): PluginCommandSpec[] {
  const commands: PluginCommandSpec[] = []
  for (const { plugin } of catalog.enabled) {
    if (!projectId && plugin.scope === 'project') continue
    for (const cmd of plugin.commands) {
      // Collapse the redundant `<plugin>:<plugin>` to a bare `<plugin>` (e.g.
      // feature-dev's `commands/feature-dev.md` → `/feature-dev`, not
      // `/feature-dev:feature-dev`). Dispatch accepts both forms.
      const fullName =
        cmd.name === plugin.manifest.name
          ? plugin.manifest.name
          : `${plugin.manifest.name}:${cmd.name}`
      commands.push({
        pluginName: plugin.manifest.name,
        name: cmd.name,
        fullName,
        description: cmd.description,
        // Collapse `optionsScript` → a `dynamic` flag; the script PATH never
        // reaches the client — the composer only needs to know it must fetch
        // this arg's options on demand (via /command-args/options).
        args: cmd.args.map((a) => ({
          name: a.name,
          type: a.type,
          description: a.description,
          ...(a.placeholder ? { placeholder: a.placeholder } : {}),
          required: a.required,
          ...(a.options ? { options: a.options } : {}),
          ...(a.optionsScript ? { dynamic: true } : {}),
          ...(a.when ? { when: a.when } : {}),
        })),
        ...(cmd.argumentHint ? { argumentHint: cmd.argumentHint } : {}),
      })
    }
  }
  return commands
}
