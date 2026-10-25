import type { DiscoveredSkill } from '../../agent-core/skill-discovery'
import { skillCallName } from '../../agent-core/tools/skill-names'
import type { LoadedPlugins } from '../../plugins/loader-contract'
import type { PersistedMessage } from '../contracts'
import { claudeCodeHome } from '../../cc-settings/config-dir'
import { agentFolders, scanAgents } from '../../agents/catalog/scan'
import { nestedSkillsForTouched } from './nested-skills'
import { touchedFilesOf } from './touched-files'

/**
 * A run's plugins with what the workspace adds the Claude Code way: the skills of a subfolder the
 * session's work reached (`nested-skills.ts`) beside the plugins' skills, and the project's and
 * user's agent files (the agent catalog, `agents/catalog/`) beside the plugins' agents. `touched` — the files
 * the session worked with — also activates `paths:` skills (`prompt-skill-paths.ts`).
 */
/** The agent files Claude Code reads for this folder: managed, project, user; the first of a name wins. */
async function fileAgents(cwd: string) {
  const folders = await agentFolders({ cwd, home: claudeCodeHome() })
  const catalog = await scanAgents({ folders, projectId: '' })
  return catalog.active.filter((agent) => agent.source !== 'builtin')
}

export async function withWorkspaceExtensions(
  narrowed: LoadedPlugins,
  fileSkills: readonly DiscoveredSkill[],
  history: readonly PersistedMessage[],
  cwd: string,
): Promise<{ touched: string[]; loadedPlugins: LoadedPlugins }> {
  const touched = touchedFilesOf(history, cwd)
  const nested = await nestedSkillsForTouched(
    cwd,
    touched,
    new Set([...fileSkills, ...narrowed.skills].map(skillCallName)),
  )
  return {
    touched,
    loadedPlugins: {
      ...narrowed,
      skills: [...nested, ...narrowed.skills],
      agents: [...(await fileAgents(cwd)), ...narrowed.agents],
    },
  }
}
