import { pluginDataDir } from '../ext/user-config-substitute'
import type { DiscoveredPlugin } from './discovery-types'

/**
 * A plugin's identifier, as Claude Code keys `enabledPlugins` and `${CLAUDE_PLUGIN_DATA}`:
 * `name@marketplace` for a plugin installed from one (a cached copy, Claude Code's own install, a
 * local-folder marketplace's plugin loading in place), `name@builtin` for a built-in, and the bare
 * name for a plugin added from a folder or a git URL.
 */
export function pluginIdOf(
  plugin: Pick<
    DiscoveredPlugin,
    'manifest' | 'cachedInstall' | 'claudeCodeInstall' | 'inPlaceInstall'
  >,
): string {
  return (
    plugin.cachedInstall?.id ??
    plugin.claudeCodeInstall ??
    plugin.inPlaceInstall ??
    plugin.manifest.name
  )
}

/** `${CLAUDE_PLUGIN_DATA}` for a plugin identifier (`ext/user-config-substitute.ts`). */
export const pluginDataDirOf = pluginDataDir

/** `${CLAUDE_PLUGIN_DATA}` of a discovered plugin. */
export const dataDirOfPlugin = (plugin: Parameters<typeof pluginIdOf>[0], home: string): string =>
  pluginDataDir(pluginIdOf(plugin), home)
