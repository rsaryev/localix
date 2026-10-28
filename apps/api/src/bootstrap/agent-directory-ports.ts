import type { createAgentsService } from '../features/agents/service'
import { claudeCodeHome } from '../features/cc-settings/config-dir'
import { readSettingsLayers } from '../features/cc-settings/settings-files'
import { settingsPermissionRules } from '../features/cc-settings/settings-permissions'
import { specifierMatchesValue } from '../features/cc-settings/permission-rules'
import { claudeCodeMainAgent } from '../features/cc-settings/settings-modes'

type AgentsService = ReturnType<typeof createAgentsService>

interface DirectoryOptions {
  /** Where Claude Code's user settings live. */
  homeDir?: string
  /** The folder of a project: its settings files hold rules too. */
  cwdOf?: (userId: string, projectId: string | null) => Promise<string | null>
}

/**
 * The names an `Agent(name)` deny rule of Claude Code's settings keeps from the model
 * (permissions.md, "Agent"): `Agent` would refuse the call, so the directory does not offer it.
 */
async function deniedAgentSpecifiers(homeDir: string, cwd: string | null): Promise<string[]> {
  const layers = await readSettingsLayers({ homeDir, cwd })
  return settingsPermissionRules(layers, { projectTrusted: false }).flatMap((rule) =>
    rule.effect === 'deny' && (rule.tool === 'Agent' || rule.tool === 'Task') && rule.specifier
      ? [rule.specifier]
      : [],
  )
}

/** The prompt directory and the main-agent lookup. */
export function createAgentDirectoryPorts(
  agentsService: AgentsService,
  options: DirectoryOptions = {},
) {
  const homeDir = options.homeDir ?? claudeCodeHome()
  return {
    resolveMainAgent: async (userId: string, projectId: string | null, cwd: string | null) => {
      const name = await claudeCodeMainAgent({ homeDir, cwd })
      return name ? agentsService.resolveMainAgent(userId, name, projectId) : null
    },
    // The directory is advisory prompt context, so a failed read omits it rather than failing
    // the run — but it says so, instead of presenting an empty registry as the truth.
    listRegistryAgents: async (userId: string, projectId?: string | null) => {
      try {
        const rows = await agentsService.directory(userId, projectId)
        const cwd = (await options.cwdOf?.(userId, projectId ?? null)) ?? null
        const denied = await deniedAgentSpecifiers(homeDir, cwd)
        if (denied.length === 0) return rows
        const hidden = (name: string) =>
          [name, name.slice(name.indexOf(':') + 1)].some((candidate) =>
            denied.some((spec) => specifierMatchesValue(spec, candidate)),
          )
        return rows.map((row) => (hidden(row.name) ? { ...row, delegable: false } : row))
      } catch (error: unknown) {
        console.warn('[agents] directory unavailable for this run:', error)
        return []
      }
    },
  }
}
