import type { DiscoveredPlugin } from './discovery'
import type { LoadedPlugins } from './loader-contract'
import { pluginOutputStyles } from './output-styles'

/** Append already-discovered declarations in the loader's existing order. */
export function appendPluginRuntimeDeclarations({
  plugin,
  result,
}: {
  plugin: DiscoveredPlugin
  result: LoadedPlugins
}): void {
  // ---- Output styles (Claude Code) ---------------------------------------
  // A style's instructions go as written (`pluginOutputStyles`). A plugin's default `agent` is the
  // kit session's (`selectAgent`).
  result.outputStyles.push(...pluginOutputStyles(plugin))
}
