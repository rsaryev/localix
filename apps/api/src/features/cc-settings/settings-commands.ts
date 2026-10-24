import { isRecord } from '../../lib/record'
import type { SettingsLayer } from './settings-files'

/**
 * A command line of Claude Code's settings — `statusLine` or `subagentStatusLine` — from the file
 * that applies (settings-reference.md, `statusLine`, `subagentStatusLine`, `disableAllHooks`): the
 * highest file that sets it, except that `allowManagedHooksOnly` in managed settings, or
 * `disableAllHooks` outside them, leaves only the managed value, and `disableAllHooks` in managed
 * settings turns every one off.
 */
export interface SettingsCommandLine {
  command: string
  /** Extra horizontal spacing, in characters. */
  padding: number
  /** Seconds between re-runs besides the event-driven ones; at least 1, absent when unset. */
  refreshInterval?: number
}

function commandLineOf(value: unknown): SettingsCommandLine | undefined {
  if (!isRecord(value) || value.type !== 'command' || typeof value.command !== 'string') return
  if (!value.command.trim()) return undefined
  const padding = typeof value.padding === 'number' && value.padding > 0 ? value.padding : 0
  const refresh = value.refreshInterval
  return {
    command: value.command,
    padding: Math.floor(padding),
    ...(typeof refresh === 'number' && refresh >= 1 ? { refreshInterval: refresh } : {}),
  }
}

export function settingsCommandLine(
  layers: readonly SettingsLayer[],
  key: 'statusLine' | 'subagentStatusLine',
): SettingsCommandLine | undefined {
  const managed = layers.filter((layer) => layer.source === 'policy')
  if (managed.some((layer) => layer.settings.disableAllHooks === true)) return undefined
  const managedOnly =
    managed.some((layer) => layer.settings.allowManagedHooksOnly === true) ||
    layers.some((layer) => layer.source !== 'policy' && layer.settings.disableAllHooks === true)
  const candidates = managedOnly ? managed : layers
  let found: SettingsCommandLine | undefined
  for (const layer of candidates) {
    if (layer.settings[key] === undefined) continue
    found = commandLineOf(layer.settings[key])
  }
  return found
}
