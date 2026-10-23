import type { PluginManifest } from './contracts'

import type { PluginConfigValues } from './contracts-base'

export type { PluginConfigValues } from './contracts-base'

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
  for (const [k, v] of Object.entries(stored ?? {})) out[k] = typed(manifest.config?.[k]?.type, v)
  return out
}

/**
 * A stored value as its declared type. The vault holds a secret option as text, so a sensitive
 * number or boolean comes back as `"1234"` or `"false"` (which reads as true); it is turned back.
 */
function typed(type: string | undefined, value: PluginConfigValues[string]) {
  if (typeof value !== 'string') return value
  if (type === 'boolean' && (value === 'true' || value === 'false')) return value === 'true'
  if (type === 'number' && value.trim() !== '' && Number.isFinite(Number(value)))
    return Number(value)
  return value
}

/** The set of config keys a manifest declares — the only keys allowed to read host env. */
export function declaredConfigKeys(manifest: PluginManifest): Set<string> {
  return new Set(Object.keys(manifest.config ?? {}))
}
