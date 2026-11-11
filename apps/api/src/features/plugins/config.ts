import { joinedList, listItems } from './config-lists'
import type { LocalixManifest } from './contracts'

import type { PluginConfigValues } from './contracts-base'

export type { PluginConfigValues } from './contracts-base'

/**
 * Resolve a plugin's effective config: declared defaults overlaid with the user's
 * stored values (which win). Used to build the context handed to native tools/hooks
 * and to substitute `${KEY}` tokens in MCP config.
 */
export function resolvePluginConfig(
  manifest: LocalixManifest,
  stored: PluginConfigValues | undefined,
): PluginConfigValues {
  const out: Record<string, unknown> = {}
  for (const [k, opt] of Object.entries(manifest.config ?? {})) {
    if (opt.default !== undefined) out[k] = opt.default
  }
  Object.assign(out, storedOptionValues(manifest, stored))
  // A `multiple` option's list reads as its items joined with commas (`config-lists.ts`).
  for (const [k, opt] of Object.entries(manifest.config ?? {})) {
    const items = opt.multiple && k in out ? listItems(out[k]) : undefined
    if (items) out[k] = joinedList(items)
  }
  return out as PluginConfigValues
}

/**
 * The saved values as the plugin kit takes them (`userConfig`): each as its declared type, a
 * `multiple` option's as its list of strings.
 */
export function storedOptionValues(
  manifest: LocalixManifest,
  stored: PluginConfigValues | undefined,
): Record<string, string | number | boolean | string[]> {
  const out: Record<string, string | number | boolean | string[]> = {}
  for (const [k, v] of Object.entries(stored ?? {})) {
    const option = manifest.config?.[k]
    const items = option?.multiple ? listItems(v) : undefined
    out[k] = items ?? typed(option?.type, v)
  }
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
