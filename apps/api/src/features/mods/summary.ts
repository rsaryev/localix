/**
 * Each mod as the Store lists it on its plugin's page: its plugin and version, what it hooks, how many panes it has
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

export function summarize(input: {
  /** Each plugin with a hooks module, with the version it loaded at (`ModSource.version`). */
  sources: readonly { plugin: string; version?: string }[]
  events: ReadonlyMap<string, readonly string[]>
  failures: ReadonlyMap<string, string>
  panes: readonly { plugin: string }[]
}): ModSummary[] {
  const plugins = new Set([...input.sources.map((one) => one.plugin), ...input.failures.keys()])
  return [...plugins].map((plugin) => {
    const version = input.sources.find((one) => one.plugin === plugin)?.version
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
