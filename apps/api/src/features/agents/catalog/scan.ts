import { promises as fs } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { claudeConfigDir } from '../../cc-settings/config-dir'
import { managedSettingsDir } from '../../cc-settings/managed-settings'
import type { LoadedPluginAgent } from '../../plugins/loader-contract'
import { bodyHashOf, scanAgentFolder, type CatalogAgent } from './agent-file'
import { BUILTIN_AGENT_TYPES } from './builtin-types'
import { composeCatalog, type AgentCatalog } from './catalog'

/** Claude Code's folders an agent file is read from, as `<claude dir>` (it holds `agents/`). */
export interface AgentFolders {
  managed: string
  user: string
  /** The project's chain, closest first: the working directory up to the repository root. */
  project: string[]
}

const isRepositoryRoot = (dir: string) =>
  fs.stat(join(dir, '.git')).then(
    () => true,
    () => false,
  )

/**
 * `.claude` folders of a project, closest first: the working directory and each parent up to the
 * repository root (outside a repository, the working directory alone), never the home itself.
 */
export async function projectClaudeDirs(cwd: string, home: string): Promise<string[]> {
  const chain: string[] = []
  let found = false
  let cur = resolve(cwd)
  while (cur !== home) {
    chain.push(cur)
    if (await isRepositoryRoot(cur)) {
      found = true
      break
    }
    const parent = dirname(cur)
    if (parent === cur) break
    cur = parent
  }
  if (!found) chain.splice(1)
  return chain.map((dir) => join(dir, '.claude'))
}

export async function agentFolders(opts: {
  cwd: string | null | undefined
  home: string
  managedDir?: string
}): Promise<AgentFolders> {
  return {
    managed: join(opts.managedDir ?? managedSettingsDir(), '.claude'),
    user: claudeConfigDir(opts.home),
    project: opts.cwd && opts.cwd !== '/' ? await projectClaudeDirs(opts.cwd, opts.home) : [],
  }
}

/** A plugin's agent (`<plugin>:<name>`) as a catalog entry. */
export function pluginCatalogAgent(agent: LoadedPluginAgent): CatalogAgent {
  return {
    ...agent,
    source: 'plugin',
    projectId: '',
    path: '',
    bodyHash: bodyHashOf(agent.prompt),
    localix: agent.localix ?? { priority: 0 },
  }
}

/** Every definition of one scope in Claude Code's precedence, built-ins last. */
export async function scanAgents(opts: {
  folders: AgentFolders
  projectId: string
  plugins?: readonly LoadedPluginAgent[]
}): Promise<AgentCatalog> {
  const { folders, projectId } = opts
  const groups = await Promise.all([
    scanAgentFolder(folders.managed, 'managed', ''),
    ...folders.project.map((dir) => scanAgentFolder(dir, 'project', projectId)),
    scanAgentFolder(folders.user, 'user', ''),
  ])
  return composeCatalog([
    ...groups.flat(),
    ...(opts.plugins ?? []).map(pluginCatalogAgent),
    ...BUILTIN_AGENT_TYPES,
  ])
}
