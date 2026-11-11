import { makeSubstituter } from '../ext/manifest-substitute'
import { pluginDataDir } from './mcp'
import type { LocalixManifest } from './contracts'
import type { PluginConfigValues } from './config'
import type { DiscoveredPlugin } from './discovery'
import type { LoadedPlugins } from './loader-contract'
import { pluginOutputStyles } from './output-styles'

/**
 * Build a per-plugin substituter closure for the prompt/skill path.
 * Thin wrapper over the shared `makeSubstituter` — supplies the secret predicate
 * so that keys declared `secret: true` in the manifest are NOT substituted into
 * agent prompts, prompt sections, or skill content.
 */
export function makePluginSubstituter(
  pluginDir: string,
  /** The plugin's identifier (`plugin-data-id.ts`): its `${CLAUDE_PLUGIN_DATA}` key. */
  pluginId: string,
  config: PluginConfigValues,
  manifest: LocalixManifest,
  projectDir: string,
  home: string,
): (text: string) => string {
  return makeSubstituter({
    pluginRoot: pluginDir,
    dataDir: pluginDataDir(pluginId, home),
    projectDir,
    config,
    isSecret: (key) => Boolean(manifest.config?.[key]?.secret),
  })
}

/** Append already-discovered declarations in the loader's existing order. */
export function appendPluginRuntimeDeclarations({
  plugin,
  subst,
  result,
}: {
  plugin: DiscoveredPlugin
  subst: (text: string) => string
  result: LoadedPlugins
}): void {
  // ---- Output styles (Claude Code) ---------------------------------------
  // A style's instructions are prompt text, so they take the plugin's path and config variables
  // like an agent's prompt does. A plugin's default `agent` is the kit session's (`selectAgent`).
  result.outputStyles.push(...pluginOutputStyles(plugin, subst))
}
