import { pluginOfInstance } from './instance-id'

/**
 * What mods add to Localix while they are loaded: commands (`$.command.register`), tools
 * (`$.tool.register`) and open panes (`$.ui.open`). Each belongs to the mod instance that added it
 * (`instance-id.ts`) and goes when that instance unloads. Names follow Claude Code's rule: letters,
 * digits, `_` and `-`, up to 64.
 */
const NAME = /^[A-Za-z0-9_-]{1,64}$/

export interface Owned {
  /** The mod instance that added it. */
  instance: string
  plugin: string
}

export interface ModCommand extends Owned {
  name: string
  description: string
  argumentHint?: string
}

export interface ModTool extends Owned {
  name: string
  description: string
  inputSchema?: Record<string, unknown>
}

/** An agent type a mod defined (`$.agent.register`), spawned as `<plugin>:<name>`. */
export interface ModAgent extends Owned {
  name: string
  description: string
  prompt: string
}

export interface ModPane extends Owned {
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
  const agents = new Map<string, ModAgent>()
  const key = (instance: string, name: string) => `${instance}\u0000${name}`
  const owner = (instance: string): Owned => ({ instance, plugin: pluginOfInstance(instance) })
  const owned = <T extends Owned>(map: Map<string, T>, instance?: string) =>
    [...map.values()].filter((entry) => instance === undefined || entry.instance === instance)
  return {
    addCommand(instance: string, spec: Omit<ModCommand, keyof Owned>) {
      const name = checkName('A command', spec.name)
      commands.set(key(instance, name), { ...owner(instance), ...spec, name })
      onChange()
    },
    addTool(instance: string, spec: Omit<ModTool, keyof Owned>) {
      const name = checkName('A tool', spec.name)
      tools.set(key(instance, name), { ...owner(instance), ...spec, name })
      onChange()
    },
    addAgent(instance: string, spec: Omit<ModAgent, keyof Owned>): string {
      const name = checkName('An agent', spec.name)
      const agent = { ...owner(instance), ...spec, name }
      agents.set(key(instance, name), agent)
      return `${agent.plugin}:${name}`
    },
    /** `<plugin>:<name>` as an instance of that plugin registered it. */
    agent: (fullName: string, instances?: ReadonlySet<string>) =>
      [...agents.values()].find(
        (agent) =>
          `${agent.plugin}:${agent.name}` === fullName &&
          (!instances || instances.has(agent.instance)),
      ),
    openPane(instance: string, pane: Omit<ModPane, keyof Owned>) {
      const id = checkName('A pane', pane.id)
      panes.set(key(instance, id), { ...owner(instance), ...pane, id })
      onChange()
    },
    closePane(instance: string, id: string): boolean {
      const removed = panes.delete(key(instance, id))
      if (removed) onChange()
      return removed
    },
    pane: (instance: string, id: string) => panes.get(key(instance, id)),
    /** An instance's commands; without one, each plugin's commands once, as a person lists them. */
    commands(instance?: string): ModCommand[] {
      if (instance !== undefined) return owned(commands, instance)
      const seen = new Map<string, ModCommand>()
      for (const command of commands.values())
        if (!seen.has(`${command.plugin}:${command.name}`))
          seen.set(`${command.plugin}:${command.name}`, command)
      return [...seen.values()]
    },
    tools: (instance?: string) => owned(tools, instance),
    panes: (instance?: string) => owned(panes, instance),
    /** Everything an instance added goes with it. */
    clear(instance: string) {
      let changed = false
      for (const map of [commands, tools, panes, agents] as Map<string, Owned>[])
        for (const [entry, value] of map)
          if (value.instance === instance) changed = map.delete(entry) || changed
      if (changed) onChange()
    },
  }
}

export type ModRegistry = ReturnType<typeof createModRegistry>
