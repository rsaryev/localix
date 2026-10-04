import type { PluginManifest } from './contracts'

// The value shape is OWNED by `@localixai/plugin-sdk` (part of PluginContext);
// re-exported so the historical import surface stays unchanged.
export type { PluginConfigValues } from '@localixai/plugin-sdk/backend'
import type { PluginConfigValues } from '@localixai/plugin-sdk/backend'

/**
 * Resolve a plugin's effective config: declared defaults overlaid with the user's
 * stored values (which win). Used to build the context handed to native tools/hooks
 * and to substitute `${KEY}` tokens in MCP config.
 */
export function resolvePluginConfig(
  manifest: PluginManifest,
  stored: PluginConfigValues | undefined,
): PluginConfigValues {
  const out: PluginConfigValues = {}
  for (const [k, opt] of Object.entries(manifest.config ?? {})) {
    if (opt.default !== undefined) out[k] = opt.default
  }
  for (const [k, v] of Object.entries(stored ?? {})) out[k] = v
  return out
}

/** The set of config keys a manifest declares — the only keys allowed to read host env. */
export function declaredConfigKeys(manifest: PluginManifest): Set<string> {
  return new Set(Object.keys(manifest.config ?? {}))
}
