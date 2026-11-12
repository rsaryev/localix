import type { ClaudeSettingsInput } from '../plugins/kit'
import { installedMcpSettingsReader } from './claude-code-settings'
import type { McpServerRecord } from './repository'

/**
 * THE MCP SERVERS A PERSON CONFIGURED FOR CLAUDE CODE, joined to a Localix run in that folder. Which
 * of them load is Claude Code's rule and the kit's (`plugins/kit/settings/mcp-plan.ts`: scopes and
 * precedence, project approval, `managed-mcp.json`, the allow and deny lists); this module is the
 * port it is installed behind and the Localix record each loaded entry becomes. Read on every run;
 * nothing here writes.
 */

export interface ClaudeCodeMcpInput extends ClaudeSettingsInput {
  cwd: string
  /** The person's servers in Localix's registry, and the run's plugin servers. */
  own: readonly McpServerRecord[]
  plugins: readonly McpServerRecord[]
  /**
   * Servers a subagent's own file defines (`agent-servers.ts`). They load after every configured
   * one, so a name already taken keeps its configured server, and the allow and deny lists judge
   * them like the rest.
   */
  extra?: readonly McpServerRecord[]
  userId: string
  projectId: string
}

/**
 * The servers a run in the folder connects: what Claude Code would load there, decided by the kit
 * (`plugins/kit/settings/mcp-plan.ts`, installed at boot), with Localix's own and the subagent's.
 * Until the host installs its reader no Claude Code file is read: Localix's own servers, the
 * plugins' and the subagent's, one per name.
 */
export function claudeCodeMcpServers(input: ClaudeCodeMcpInput): McpServerRecord[] {
  const planned = installedMcpSettingsReader()?.servers(input)
  if (planned) return planned
  const taken = new Set<string>()
  return [...input.own, ...input.plugins, ...(input.extra ?? [])].filter(
    (server) => !taken.has(server.name) && taken.add(server.name),
  )
}
