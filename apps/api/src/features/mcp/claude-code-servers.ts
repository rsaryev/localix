import type { FileScope } from '@rsaryev/llx-plugin/settings'
import type { ClaudeSettingsInput } from '../plugins/kit'
import { installedMcpSettingsReader } from './claude-code-settings'
import { normalizeMcpServerEntry } from './normalize'
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

/**
 * A server of Claude Code's files as a Localix record (`normalizeMcpServerEntry`); undefined for an
 * entry Localix cannot connect.
 */
export function claudeCodeServerRecord(
  /** The Claude Code scope a configured server was read from. */
  scope: FileScope,
  name: string,
  raw: Record<string, unknown>,
  input: ClaudeCodeMcpInput,
  trusted: boolean,
): McpServerRecord | undefined {
  try {
    const parsed = normalizeMcpServerEntry(name, raw, input.projectId)
    if (parsed.enabled === false) return undefined
    // A `headersHelper` is a shell command: a project or local server's runs only in a trusted
    // folder, and until then the server connects with its static headers alone (mcp.md, "Trust a
    // folder before its headersHelper runs"). Project servers are also approved above to load at all.
    if ((scope === 'project' || scope === 'local') && !trusted && 'headersHelper' in parsed.config)
      delete (parsed.config as { headersHelper?: string }).headersHelper
    return {
      id: `claude-code:${scope}:${name}`,
      userId: input.userId,
      projectId: input.projectId,
      name: parsed.name,
      description: parsed.description ?? '',
      transport: parsed.transport,
      config: parsed.config as Record<string, unknown>,
      createdAt: '',
      updatedAt: '',
    }
  } catch {
    // An entry Claude Code could not load either; the others still load.
    return undefined
  }
}
