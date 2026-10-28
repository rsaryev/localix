import { issue, type PluginIssue } from './issues'

/**
 * A plugin's default settings: `settings.json` at its root, or the manifest's `settings` key. Only
 * `agent` and `subagentStatusLine` take effect and every other key is dropped. The file wins over
 * the manifest when it sets at least one supported key.
 */
export interface PluginSettings {
  /** One of the plugin's own agents, run as the session's main thread while the plugin is enabled. */
  agent?: string
  /** A command that rewrites each subagent row: `{ type: 'command', command }`. */
  subagentStatusLine?: { type: 'command'; command: string }
}

export const PLUGIN_SETTINGS_KEYS = ['agent', 'subagentStatusLine'] as const

function supported(raw: unknown, path: string, issues: PluginIssue[]): PluginSettings {
  if (raw === undefined) return {}
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    issues.push(issue('error', path, 'Settings must be a JSON object'))
    return {}
  }
  const record = raw as Record<string, unknown>
  const out: PluginSettings = {}
  if (typeof record.agent === 'string' && record.agent.trim()) out.agent = record.agent.trim()
  else if (record.agent !== undefined)
    issues.push(issue('error', `${path}#agent`, '"agent" must name one of the plugin’s agents'))
  const line = record.subagentStatusLine as Record<string, unknown> | undefined
  if (line?.type === 'command' && typeof line.command === 'string' && line.command)
    out.subagentStatusLine = { type: 'command', command: line.command }
  else if (line !== undefined)
    issues.push(
      issue('error', `${path}#subagentStatusLine`, '"subagentStatusLine" must be a command'),
    )
  const dropped = Object.keys(record).filter(
    (key) => !(PLUGIN_SETTINGS_KEYS as readonly string[]).includes(key),
  )
  if (dropped.length)
    issues.push(
      issue('warning', path, `Plugin settings ignore ${dropped.map((k) => `"${k}"`).join(', ')}`),
    )
  return out
}

/** Resolve the settings a plugin applies from its `settings.json` and its manifest key. */
export function pluginSettingsOf(
  file: unknown,
  manifestSettings: unknown,
): { settings: PluginSettings; issues: PluginIssue[] } {
  const issues: PluginIssue[] = []
  const fromFile = supported(file, 'settings.json', issues)
  if (Object.keys(fromFile).length > 0) return { settings: fromFile, issues }
  return { settings: supported(manifestSettings, 'settings', issues), issues }
}
