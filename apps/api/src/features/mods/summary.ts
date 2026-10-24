import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Each mod as the Mods view lists it: its plugin and version, what it hooks, how many panes it has
 * open, and whether it runs — or why it does not.
 */

export interface ModSummary {
  plugin: string
  version?: string
  /** The events its hooks module registered, by pattern. */
  events: string[]
  /** Panes it has open, in every project. */
  panes: number
  /** Whether it draws on a render site (`ui.render`): a pane or the band above the message box. */
  draws: boolean
  status: 'running' | 'failed'
  problem?: string
}

/** The `version` of the plugin's manifest, when it names one. */
function versionOf(root: string): string | undefined {
  try {
    const manifest = JSON.parse(readFileSync(join(root, '.claude-plugin/plugin.json'), 'utf8'))
    return typeof manifest?.version === 'string' ? manifest.version : undefined
  } catch {
    return undefined
  }
}

export function summarize(input: {
  /** Each plugin with a hooks module, by name, and its root. */
  roots: ReadonlyMap<string, string>
  events: ReadonlyMap<string, readonly string[]>
  failures: ReadonlyMap<string, string>
  panes: readonly { plugin: string }[]
}): ModSummary[] {
  const plugins = new Set([...input.roots.keys(), ...input.failures.keys()])
  return [...plugins].map((plugin) => {
    const root = input.roots.get(plugin)
    const version = root ? versionOf(root) : undefined
    const events = [...(input.events.get(plugin) ?? [])]
    const problem = input.failures.get(plugin)
    return {
      plugin,
      ...(version ? { version } : {}),
      events,
      panes: input.panes.filter((pane) => pane.plugin === plugin).length,
      draws: events.some((event) => event === 'ui.render' || event === 'ui.*' || event === '*'),
      status: problem === undefined ? 'running' : 'failed',
      ...(problem === undefined ? {} : { problem }),
    }
  })
}
