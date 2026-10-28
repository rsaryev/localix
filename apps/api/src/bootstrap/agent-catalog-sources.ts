import { watch as fsWatch } from 'node:fs'
import { DEFAULT_AGENT_ID } from '@localixai/agent/agents'
import type { Kysely } from 'kysely'
import type { AppDatabase } from '../db/types'
import { userHome } from '../lib/env'
import { readAvailability } from '../features/capabilities/availability'
import { createCapabilitySourceRepository } from '../features/capabilities/source-repository'
import { agentFolders } from '../features/agents/catalog/scan'
import type { AgentSnapshot, PluginAgentGroup } from '../features/agents/bindings/bindings'
import { createAgentWatcher, type After, type WatchDir } from '../features/agents/bindings/watcher'
import { recordCoreChanges } from '../features/changes/core-entities'
import { onCapabilityRevision } from '../features/capabilities/revision'
import { buildPluginCatalog } from '../features/plugins/catalog'
import { buildLoadedAgent, type LoadedPluginAgent } from '../features/plugins/loader-contract'

/** Claude Code's folders for one scope; `project` is null while the project's directory is gone. */
export function createAgentFoldersPort(
  resolveProjectCwd: (userId: string, projectId: string) => Promise<string | null>,
) {
  return async (userId: string, projectId: string) => {
    const home = userHome()
    if (!projectId) return agentFolders({ cwd: undefined, home })
    const cwd = await resolveProjectCwd(userId, projectId)
    const folders = await agentFolders({ cwd, home })
    return cwd ? folders : { ...folders, project: null }
  }
}

/**
 * The agents plugins bring, per installed plugin. A plugin's own switch is the person's rule on
 * the main agent, as everywhere else; a disabled plugin's agents are not gone, just not offered.
 */
export function createPluginAgentGroups(
  db: Kysely<AppDatabase>,
  resolveProjectCwd: (userId: string, projectId: string) => Promise<string | null>,
  /** The agent types the loaded mods registered (`$.agent.register`), by plugin. */
  modAgents: () => readonly ModAgentGroup[] = () => [],
) {
  return async (userId: string, projectId: string): Promise<PluginAgentGroup[]> => {
    const catalog = await buildPluginCatalog({
      repo: createCapabilitySourceRepository(db, 'plugin'),
      availability: await readAvailability(db, { userId, agentId: DEFAULT_AGENT_ID }),
      userId,
      projectId,
      cwd: projectId ? await resolveProjectCwd(userId, projectId) : null,
      homeDir: userHome(),
    })
    const files = catalog.all.map((entry) => ({
      plugin: entry.plugin.manifest.name,
      projectId: entry.plugin.scope === 'global' ? '' : projectId,
      enabled: entry.enabled,
      agents: entry.plugin.agents.map((agent) =>
        buildLoadedAgent(entry.plugin.manifest.name, agent, (text) => text),
      ),
    }))
    return withModAgents(files, modAgents())
  }
}

/** The agents a plugin's loaded mod registered. */
export interface ModAgentGroup {
  plugin: string
  agents: readonly LoadedPluginAgent[]
}

/**
 * Plugin groups with the mods' agents in them. A mod is part of its plugin, so its agents join the
 * plugin's own group (a type the mod registers replaces a file of the same name); a plugin the
 * catalog does not list gets a group of its own, on for every project.
 */
export function withModAgents(
  groups: readonly PluginAgentGroup[],
  mods: readonly ModAgentGroup[],
): PluginAgentGroup[] {
  const out = groups.map((group) => ({ ...group }))
  for (const mod of mods) {
    const own = out.find((group) => group.plugin === mod.plugin && group.projectId === '')
    if (!own) {
      out.push({ plugin: mod.plugin, projectId: '', enabled: true, agents: [...mod.agents] })
      continue
    }
    const names = new Set(mod.agents.map((agent) => agent.fullName))
    own.agents = [...own.agents.filter((agent) => !names.has(agent.fullName)), ...mod.agents]
  }
  return out
}

/** `fs.watch` as the watcher's seam: a missing folder is reported, never thrown. */
export const watchDirectory: WatchDir = (dir, recursive, onEvent, onError) => {
  try {
    const watcher = fsWatch(dir, { recursive }, (_event, name) =>
      onEvent(name ? String(name) : null),
    )
    watcher.on('error', onError)
    return () => watcher.close()
  } catch {
    onError()
    return () => {}
  }
}

export const afterMs: After = (ms, fn) => {
  const timer = setTimeout(fn, ms)
  return () => clearTimeout(timer)
}

/** Watch the agent folders while the app runs; the returned task starts it, `signal` stops it. */
export function createAgentFilesTask(input: {
  db: Kysely<AppDatabase>
  userId: string
  agentsService: { bindings: { snapshot(userId: string, scope: string): Promise<AgentSnapshot> } }
  folders: ReturnType<typeof createAgentFoldersPort>
  projects(userId: string): Promise<readonly string[]>
  signal?: AbortSignal
}): { name: string; run: () => Promise<void> } {
  const { userId } = input
  const watcher = createAgentWatcher({
    reconcile: (scope) => input.agentsService.bindings.snapshot(userId, scope),
    folders: (scope) => input.folders(userId, scope),
    projects: () => input.projects(userId),
    resync: async () => {
      await recordCoreChanges(input.db, [{ entity: 'agent', op: 'resync' }])
    },
    watch: watchDirectory,
    after: afterMs,
  })
  // A plugin or a project that came or went changes which folders are read.
  const off = onCapabilityRevision(() => watcher.refresh())
  input.signal?.addEventListener(
    'abort',
    () => {
      off()
      watcher.stop()
    },
    { once: true },
  )
  return {
    name: 'agent_files',
    run: () => (input.signal?.aborted ? Promise.resolve() : watcher.start()),
  }
}
