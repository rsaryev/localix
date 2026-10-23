import type { DiscoveredPlugin } from './discovery'

/**
 * May this host load this plugin's components — and if not, why? A manifest error blocks it. The reason is what the
 * plugin's row shows. A Claude Code plugin declares no host API version, so nothing else blocks.
 */
export function pluginLoadBlockReason(plugin: DiscoveredPlugin): string | null {
  return plugin.error ?? null
}
