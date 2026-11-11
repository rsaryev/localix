import { watch as fsWatch } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_AGENT_ID } from '@localixai/agent/agents'
import type { Kysely } from 'kysely'
import type { AppDatabase } from '../db/types'
import { userHome } from '../lib/env'
import { claudeConfigDir } from '../features/cc-settings/config-dir'
import { readAvailability } from '../features/capabilities/availability'
import { createCapabilitySourceRepository } from '../features/capabilities/source-repository'
import type { AgentFolders } from '../features/agents/catalog/agent-file'
import type { ScopeCatalog } from '../features/agents/catalog/compose'
import type { AgentSnapshot } from '../features/agents/bindings/bindings'
import { createAgentWatcher, type After, type WatchDir } from '../features/agents/bindings/watcher'
import { recordCoreChanges } from '../features/changes/core-entities'
import { onCapabilityRevision } from '../features/capabilities/revision'
import { buildPluginCatalog } from '../features/plugins/catalog'
import { kitPluginsOf } from '../features/plugins/catalog-kit'
import { managedSettingsDir, scopeAgents, type LocalixPluginHost } from '../features/plugins/kit'
import type { ModAgentGroup } from '../features/mods/host'

type ProjectCwd = (userId: string, projectId: string) => Promise<string | null>

/** The `.claude` folders a scope's agent files are written to and watched in. */
export function createAgentFoldersPort(resolveProjectCwd: ProjectCwd) {
  return async (userId: string, projectId: string): Promise<AgentFolders> => {
    const cwd = projectId ? await resolveProjectCwd(userId, projectId) : null
    return {
      managed: join(managedSettingsDir(), '.claude'),
      user: claudeConfigDir(userHome()),
      project: cwd ? join(cwd, '.claude') : null,
    }
  }
}

/**
 * A scope's subagents as the kit resolves them in a session of the scope's folder (`/` for no
 * project, so the person's own agents are not read as a project's), with its installed plugins: a
 * plugin's own switch is the person's rule on the main agent, as everywhere else, and a disabled
 * plugin's agents are not gone, just not offered.
 */
export function createAgentCatalogPort(
  db: Kysely<AppDatabase>,
  pluginHost: LocalixPluginHost,
  resolveProjectCwd: ProjectCwd,
  /** The agent types the loaded mods registered (`$.agent.register`), by plugin. */
  modAgents: () => readonly ModAgentGroup[] = () => [],
) {
  return async (userId: string, projectId: string): Promise<ScopeCatalog> => {
    const cwd = projectId ? await resolveProjectCwd(userId, projectId) : null
    const catalog = await buildPluginCatalog({
      repo: createCapabilitySourceRepository(db, 'plugin'),
      availability: await readAvailability(db, { userId, agentId: DEFAULT_AGENT_ID }),
      userId,
      projectId,
      cwd,
      homeDir: userHome(),
    })
    const plugins = kitPluginsOf(catalog)
    // A person's switched-off plugin brings no agent, its mods' included.
    const off = new Set(
      plugins.filter((one) => !one.selected && one.scope === 'user').map((one) => one.plugin.name),
    )
    const flag = Object.fromEntries(
      modAgents()
        .filter((group) => !off.has(group.plugin))
        .flatMap((group) => Object.entries(group.agents)),
    )
    return {
      agents: await scopeAgents(
        pluginHost,
        { cwd: cwd ?? '/', homeDir: userHome(), plugins },
        { flag },
      ),
      plugins: plugins.map((plugin) => ({
        plugin: plugin.plugin.name,
        projectId: plugin.scope === 'project' ? projectId : '',
        enabled: plugin.selected,
      })),
      projectReadable: !projectId || cwd !== null,
    }
  }
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
