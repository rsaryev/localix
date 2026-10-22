/**
 * What mods add to Localix while they are loaded: commands (`$.command.register`), tools
 * (`$.tool.register`) and open panes (`$.ui.open`). Each belongs to its mod and goes when the mod
 * unloads. Names follow Claude Code's rule: letters, digits, `_` and `-`, up to 64.
 */
const NAME = /^[A-Za-z0-9_-]{1,64}$/

export interface ModCommand {
  plugin: string
  name: string
  description: string
  argumentHint?: string
}

export interface ModTool {
  plugin: string
  name: string
  description: string
  inputSchema?: Record<string, unknown>
}

export interface ModPane {
  plugin: string
  id: string
  title?: string
  rows?: number
  columns?: number
}

function checkName(kind: string, name: unknown): string {
  if (typeof name !== 'string' || !NAME.test(name))
    throw new Error(`${kind} name must be letters, digits, _ or -, up to 64: ${String(name)}`)
  return name
}

export function createModRegistry(onChange: () => void) {
  const commands = new Map<string, ModCommand>()
  const tools = new Map<string, ModTool>()
  const panes = new Map<string, ModPane>()
  const key = (plugin: string, name: string) => `${plugin}\u0000${name}`
  const owned = <T extends { plugin: string }>(map: Map<string, T>, plugin?: string) =>
    [...map.values()].filter((entry) => plugin === undefined || entry.plugin === plugin)
  return {
    addCommand(plugin: string, spec: Omit<ModCommand, 'plugin'>) {
      const name = checkName('A command', spec.name)
      commands.set(key(plugin, name), { plugin, ...spec, name })
      onChange()
    },
    addTool(plugin: string, spec: Omit<ModTool, 'plugin'>) {
      const name = checkName('A tool', spec.name)
      tools.set(key(plugin, name), { plugin, ...spec, name })
      onChange()
    },
    openPane(plugin: string, pane: Omit<ModPane, 'plugin'>) {
      const id = checkName('A pane', pane.id)
      panes.set(key(plugin, id), { plugin, ...pane, id })
      onChange()
    },
    closePane(plugin: string, id: string): boolean {
      const removed = panes.delete(key(plugin, id))
      if (removed) onChange()
      return removed
    },
    command: (plugin: string, name: string) => commands.get(key(plugin, name)),
    tool: (plugin: string, name: string) => tools.get(key(plugin, name)),
    pane: (plugin: string, id: string) => panes.get(key(plugin, id)),
    commands: (plugin?: string) => owned(commands, plugin),
    tools: (plugin?: string) => owned(tools, plugin),
    panes: (plugin?: string) => owned(panes, plugin),
    /** Everything a mod added goes with it. */
    clear(plugin: string) {
      let changed = false
      for (const map of [commands, tools, panes] as Map<string, { plugin: string }>[])
        for (const [entry, value] of map)
          if (value.plugin === plugin) changed = map.delete(entry) || changed
      if (changed) onChange()
    },
  }
}

export type ModRegistry = ReturnType<typeof createModRegistry>
