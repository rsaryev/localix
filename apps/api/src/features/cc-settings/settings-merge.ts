import { isRecord } from '../../lib/record'

/**
 * HOW CLAUDE CODE COMBINES ITS SETTINGS FILES (settings.md, "Settings precedence" and "Lists
 * merge instead of overriding"; managed-settings.md, "Split a file-based policy across teams"):
 * a single value from a higher file replaces a lower one, lists combine without repeats, and
 * nested blocks (`env`, `permissions`, `sandbox`) merge key by key under the same rules — except
 * the keys whose value is one ordered whole:
 *
 *   - `fallbackModel` — a chain; the higher file's chain replaces the lower one;
 *   - `modelPicker` — one lineup, taken from managed settings, `--settings` or user settings only;
 *   - `availableModels` — when managed settings define it, that list applies as-is;
 *   - `extraKnownMarketplaces`, `managedMcpServers` — an entry of the same name is replaced whole.
 */

export type Settings = Record<string, unknown>

export type SettingsSource = 'user' | 'project' | 'local' | 'flag' | 'policy'

const WHOLE_VALUES = new Set(['fallbackModel', 'modelPicker'])
const WHOLE_ENTRIES = new Set(['extraKnownMarketplaces', 'managedMcpServers'])

function mergeValue(below: unknown, above: unknown): unknown {
  if (isRecord(below) && isRecord(above)) return mergeSettingsLayer(below, above)
  if (Array.isArray(below) && Array.isArray(above)) return union(below, above)
  return above
}

function union(below: readonly unknown[], above: readonly unknown[]): unknown[] {
  const out: unknown[] = []
  const seen = new Set<string>()
  for (const item of [...below, ...above]) {
    const key = typeof item === 'string' ? `s:${item}` : `j:${JSON.stringify(item)}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

/** One file over another: `higher` wins single values, lists union, blocks merge. */
export function mergeSettingsLayer(lower: Settings, higher: Settings): Settings {
  const merged: Settings = { ...lower }
  for (const [key, value] of Object.entries(higher)) {
    if (WHOLE_VALUES.has(key)) merged[key] = value
    else if (WHOLE_ENTRIES.has(key) && isRecord(merged[key]) && isRecord(value))
      merged[key] = { ...(merged[key] as Settings), ...value }
    else merged[key] = mergeValue(merged[key], value)
  }
  return merged
}

/** The settings files Claude Code reads, lowest precedence first, merged into what applies. */
export function mergeSettingsSources(
  layers: ReadonlyArray<{ source: SettingsSource; settings: Settings }>,
): Settings {
  let merged: Settings = {}
  for (const { source, settings } of layers) {
    const { modelPicker, ...rest } = settings
    merged = mergeSettingsLayer(merged, rest)
    // Project and local settings cannot choose the model lineup.
    if (modelPicker !== undefined && source !== 'project' && source !== 'local')
      merged.modelPicker = modelPicker
  }
  const managed = layers.find((layer) => layer.source === 'policy')?.settings
  if (managed && managed.availableModels !== undefined)
    merged.availableModels = managed.availableModels
  return merged
}
