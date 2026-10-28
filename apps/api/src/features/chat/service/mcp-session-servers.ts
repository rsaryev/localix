import { claudeCodeHome } from '../../cc-settings/config-dir'
import { claudeCodeMcpServers } from '../../mcp/claude-code-servers'
import type { McpServerRecord } from '../../mcp/repository'
import { hydrateMcpRecords } from '../../mcp/store-secrets'
import type { SessionRecord } from '../repository'
import type { CommandHandlerContext } from './command-handlers'

/**
 * The MCP servers a run of this session would connect, built as the run builds them: the person's
 * own (secrets put back), Claude Code's files, the organization's and the enabled plugins'. What
 * `/mcp` lists and what an `/mcp__<server>__<prompt>` command reads its prompt from.
 */
export async function sessionMcpServers(
  ctx: Pick<CommandHandlerContext, 'mcpRepo' | 'loadSessionPluginMcpServers'>,
  userId: string,
  session: SessionRecord,
  cwd: string,
): Promise<McpServerRecord[]> {
  const projectId = session.projectId ?? ''
  return claudeCodeMcpServers({
    own: await hydrateMcpRecords(userId, await ctx.mcpRepo.listForScope(userId, projectId)),
    // A plugin listing that fails leaves the other servers listed.
    plugins: await ctx.loadSessionPluginMcpServers(userId, session).catch(() => []),
    userId,
    projectId,
    cwd,
    homeDir: claudeCodeHome(),
  })
}
