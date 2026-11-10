import { makeSubstituter } from '../ext/manifest-substitute'
import { dataDirOfPlugin } from './plugin-data-id'
import { pluginDataDir } from './mcp'
import type { PluginManifest } from './contracts'
import type { PluginConfigValues } from './config'
import type { DiscoveredPlugin } from './discovery'
import { buildLoadedAgent, type LoadedPlugins } from './loader-contract'
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
  manifest: PluginManifest,
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
  opts,
}: {
  plugin: DiscoveredPlugin
  subst: (text: string) => string
  result: LoadedPlugins
  opts: { homeDir: string }
}): void {
  // ---- Background monitors (manifest `monitors` / monitors/monitors.json) -
  // Typed + de-duplicated in discovery; collected here (enabled plugins only — the
  // enable state is the trust gate) with the roots the monitor host substitutes
  // into each command. Spawned by the monitor host, never per turn.
  for (const monitor of plugin.entrypoints.monitors) {
    result.monitors.push({
      pluginName: plugin.manifest.name,
      pluginRoot: plugin.dir,
      dataDir: dataDirOfPlugin(plugin, opts.homeDir),
      monitor,
    })
  }

  // ---- Output styles and default settings (Claude Code) -----------------
  // A style's instructions are prompt text, so they take the plugin's path and config variables
  // like an agent's prompt does. `settings.agent` names one of the plugin's own agents; one that
  // names none is reported in the plugin's validation instead (`validate.ts`).
  const components = plugin.entrypoints.components
  result.outputStyles.push(...pluginOutputStyles(plugin, subst))
  const mainAgent = components?.settings.agent
  const agent = mainAgent
    ? plugin.agents.find(
        (entry) =>
          entry.name === mainAgent || `${plugin.manifest.name}:${entry.name}` === mainAgent,
      )
    : undefined
  if (agent) result.mainAgent = buildLoadedAgent(plugin.manifest.name, agent, subst)
}
