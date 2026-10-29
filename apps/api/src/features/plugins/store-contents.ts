import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import type { InstallPlan, StoreComponent } from '@localixai/store'

import { isRecord } from '../../lib/record'
import { readSkillsFromRoot } from '../agent-core/skill-discovery'
import { withEntry } from './claude-code-installs'
import type { DiscoveredPlugin } from './discovery-types'
import type { MarketplaceEntry } from './marketplace'
import { loadManifest } from './manifest-load'

/**
 * WHAT A PLUGIN ADDS AND RUNS, read from its folder without installing it: the Store's
 * components (skills, commands, agents, hooks, a mod, MCP and LSP servers, output styles, themes,
 * monitors) and its plan's "runs" (hooks, the mod, stdio servers, monitors, `bin/`) and network
 * (the hosts its remote MCP servers reach). Read the way discovery reads an installed plugin
 * (`manifest-load.ts`), with the marketplace entry composed in as an install would.
 */
export interface PluginContents {
  components: StoreComponent[]
  runs: InstallPlan['runs']
  network: string[]
}

/** The events a hooks file wires, each with the commands it runs. */
function hookEvents(configs: readonly unknown[]): Map<string, string[]> {
  const events = new Map<string, string[]>()
  for (const config of configs) {
    const table = isRecord(config) && isRecord(config.hooks) ? config.hooks : config
    if (!isRecord(table)) continue
    for (const [event, matchers] of Object.entries(table)) {
      const commands = events.get(event) ?? []
      for (const matcher of Array.isArray(matchers) ? matchers : [])
        for (const hook of isRecord(matcher) && Array.isArray(matcher.hooks) ? matcher.hooks : [])
          if (isRecord(hook) && typeof hook.command === 'string') commands.push(hook.command)
      events.set(event, commands)
    }
  }
  return events
}

const hostOf = (url: unknown) => {
  try {
    return typeof url === 'string' ? new URL(url).host : null
  } catch {
    return null
  }
}

export function contentsOfPlugin(
  plugin: DiscoveredPlugin,
  bin: string[],
  /** What each skill says it does, by name, from its `SKILL.md`. */
  skillDescriptions: ReadonlyMap<string, string> = new Map(),
): PluginContents {
  const name = plugin.manifest.name
  const described = (kind: StoreComponent['kind'], part: { name: string; description?: string }) =>
    ({
      kind,
      name: part.name,
      ...(part.description ? { description: part.description } : {}),
    }) as StoreComponent
  const components: StoreComponent[] = [
    ...plugin.provides.skills.map((skill) =>
      described('skill', { name: skill, description: skillDescriptions.get(skill) }),
    ),
    ...plugin.commands.map((command) =>
      described('command', { ...command, name: `/${name}:${command.name}` }),
    ),
    ...plugin.agents.map((agent) => described('agent', agent)),
  ]
  const runs: InstallPlan['runs'] = []
  const network = new Set<string>()
  for (const [event, commands] of hookEvents(plugin.entrypoints.hookConfigs)) {
    components.push({ kind: 'hook', name: event })
    for (const command of commands) runs.push({ kind: 'hook', name: event, command })
  }
  if (plugin.entrypoints.hookModule) {
    components.push({ kind: 'mod', name })
    runs.push({ kind: 'mod', name })
  }
  for (const [server, config] of Object.entries(plugin.entrypoints.mcpServers)) {
    components.push({ kind: 'mcp-server', name: server })
    if (typeof config.command === 'string') {
      const args = Array.isArray(config.args) ? config.args.map(String) : []
      runs.push({ kind: 'mcp-server', name: server, command: [config.command, ...args].join(' ') })
    }
    const host = hostOf(config.url)
    if (host) network.add(host)
  }
  for (const [server, config] of Object.entries(plugin.entrypoints.lspServers)) {
    components.push({ kind: 'lsp-server', name: server })
    const command = isRecord(config) && typeof config.command === 'string' ? config.command : ''
    runs.push({ kind: 'lsp-server', name: server, ...(command ? { command } : {}) })
  }
  for (const style of plugin.entrypoints.components?.outputStyles ?? [])
    components.push(described('output-style', style))
  for (const theme of plugin.entrypoints.components?.themes ?? [])
    components.push({ kind: 'theme', name: theme.name })
  for (const monitor of plugin.entrypoints.monitors) {
    components.push({ kind: 'monitor', name: monitor.name })
    runs.push({ kind: 'monitor', name: monitor.name, command: monitor.command })
  }
  for (const file of bin) runs.push({ kind: 'command', name: 'bin/', command: file })
  return { components, runs, network: [...network].sort() }
}

/** Read a plugin folder; `id` is its `<name>@<marketplace>`, `entry` its marketplace entry. */
export async function scanPluginContents(
  dir: string,
  id: string,
  entry?: MarketplaceEntry,
): Promise<PluginContents> {
  const [plugin, bin] = await Promise.all([
    loadManifest(dir, 'global', '', withEntry(id, entry)),
    fs.readdir(join(dir, 'bin')).catch(() => [] as string[]),
  ])
  // A skill's description is in its own file; a folder that cannot be read just says less.
  const skills = await Promise.all(
    plugin.entrypoints.skillDirs.map((root) => readSkillsFromRoot(root, 'global').catch(() => [])),
  )
  const descriptions = new Map(
    skills.flat().flatMap((skill) => (skill.description ? [[skill.name, skill.description]] : [])),
  )
  return contentsOfPlugin(plugin, bin.sort(), descriptions)
}

/** A plugin folder's README, at most this long: a page of text, not a book. */
const README_CHARS = 200_000

export async function readPluginReadme(dir: string): Promise<string | null> {
  for (const name of ['README.md', 'readme.md', 'Readme.md']) {
    const text = await fs.readFile(join(dir, name), 'utf8').catch(() => null)
    if (text !== null) return text.slice(0, README_CHARS)
  }
  return null
}
