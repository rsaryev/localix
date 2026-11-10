import type { createAgentsService } from '../features/agents/service'
import { claudeCodeHome } from '../features/cc-settings/config-dir'
import {
  mainAgentSetting,
  readClaudeSettings,
  settingsAdditionalDirectories,
  settingsDeniesAgent,
  settingsRuleEntries,
  settingsRules,
} from '../features/plugins/kit'

type AgentsService = ReturnType<typeof createAgentsService>

interface DirectoryOptions {
  /** Where Claude Code's user settings live. */
  homeDir?: string
  /** The folder of a project: its settings files hold rules too. */
  cwdOf?: (userId: string, projectId: string | null) => Promise<string | null>
}

/**
 * Whether an `Agent(name)` deny rule of Claude Code's settings keeps a subagent from the model
 * (permissions.md, "Agent"): `Agent` would refuse the call, so the directory does not offer it.
 */
async function agentDenial(homeDir: string, cwd: string | null) {
  const settings = await readClaudeSettings({ homeDir, cwd })
  const additionalDirectories = settingsAdditionalDirectories(settings)
  const rules = settingsRules(settingsRuleEntries(settings), {
    cwd: cwd ?? homeDir,
    homeDir,
    additionalDirectories,
  })
  return (name: string) => settingsDeniesAgent(rules, name)
}

/** The prompt directory and the main-agent lookup. */
export function createAgentDirectoryPorts(
  agentsService: AgentsService,
  options: DirectoryOptions = {},
) {
  const homeDir = options.homeDir ?? claudeCodeHome()
  return {
    resolveMainAgent: async (userId: string, projectId: string | null, cwd: string | null) => {
      const name = mainAgentSetting(await readClaudeSettings({ homeDir, cwd }))
      return name ? agentsService.resolveMainAgent(userId, name, projectId) : null
    },
    // The directory is advisory prompt context, so a failed read omits it rather than failing
    // the run — but it says so, instead of presenting an empty registry as the truth.
    listRegistryAgents: async (userId: string, projectId?: string | null) => {
      try {
        const rows = await agentsService.directory(userId, projectId)
        const cwd = (await options.cwdOf?.(userId, projectId ?? null)) ?? null
        const denied = await agentDenial(homeDir, cwd)
        const hidden = (name: string) =>
          [name, name.slice(name.indexOf(':') + 1)].some((candidate) => denied(candidate))
        return rows.map((row) => (hidden(row.name) ? { ...row, delegable: false } : row))
      } catch (error: unknown) {
        console.warn('[agents] directory unavailable for this run:', error)
        return []
      }
    },
  }
}
