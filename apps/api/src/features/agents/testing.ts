import { join } from 'node:path'
import { scopeAgents } from '../plugins/kit'
import { diskPluginHost, writeTestPlugin } from '../plugins/kit/testing'
import type { HostAgents } from '../plugins/kit'
import type { AgentsServiceDeps } from './service-contract'

/** A plugin of a test scope, installed for the person, with the agent files it ships. */
export interface TestPlugin {
  plugin: string
  enabled: boolean
  agents: readonly { name: string; description?: string; prompt?: string }[]
}

const agentFile = (agent: TestPlugin['agents'][number]) =>
  `---\nname: ${agent.name}\ndescription: ${agent.description ?? agent.name}\n---\n${agent.prompt ?? `You are ${agent.name}.`}`

/**
 * The agents service's scope ports over a temp tree, for other tests: the person's home at
 * `<root>/home`, the managed folder at `<root>/managed`, each project at the folder given (null:
 * it cannot be read now), plugins installed under `<root>/plugins`. The files are read by the kit,
 * as in the app.
 */
export function testAgentScopes(opts: {
  root: string
  projects?: Readonly<Record<string, string | null>>
  plugins?: () => readonly TestPlugin[]
  /** The agent types mods registered, as the catalog's `--agents` source. */
  mods?: () => HostAgents
}): Pick<AgentsServiceDeps, 'folders' | 'catalog'> {
  const homeDir = join(opts.root, 'home')
  const managed = join(opts.root, 'managed')
  const host = diskPluginHost(homeDir, { managedDirectory: managed })
  const cwdOf = (projectId: string) => (projectId ? (opts.projects?.[projectId] ?? null) : null)
  return {
    folders: async (_userId, projectId) => {
      const cwd = cwdOf(projectId)
      return {
        managed: join(managed, '.claude'),
        user: join(homeDir, '.claude'),
        project: cwd ? join(cwd, '.claude') : null,
      }
    },
    catalog: async (_userId, projectId) => {
      const cwd = cwdOf(projectId)
      const tests = opts.plugins?.() ?? []
      const plugins = await Promise.all(
        tests.map((test) =>
          writeTestPlugin(
            join(opts.root, 'plugins', test.plugin),
            test.plugin,
            Object.fromEntries(
              test.agents.map((agent) => [`agents/${agent.name}.md`, agentFile(agent)]),
            ),
            test.enabled,
          ),
        ),
      )
      return {
        agents: await scopeAgents(
          host,
          { cwd: cwd ?? '/', homeDir, plugins, managed: { dir: managed } },
          { flag: opts.mods?.() },
        ),
        plugins: tests.map(({ plugin, enabled }) => ({ plugin, projectId: '', enabled })),
        projectReadable: !projectId || cwd !== null,
      }
    },
  }
}
