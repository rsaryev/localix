import { resolveRunProfile, type AgentSessionKind } from '../../agent-core/run-shape'
import type { RunIdentity } from './run-contract'

/**
 * Native host rosters cannot be bypassed by a remembered compatibility profile.
 *
 * A child run as a Claude Code plugin agent type (`run/speaker-agent.ts`) takes that agent's
 * surface, as Claude Code gives it: a `tools` list is the exact allowlist (still narrowed by a host
 * roster), and no list inherits the tools the main conversation has, MCP tools included. Every
 * other child, a job and an automation run keep the closed surface their shape gives them.
 */
export function resolveExecutionProfile(
  session: { sessionKind: AgentSessionKind },
  instructions: string | null | undefined,
  identity: Pick<RunIdentity, 'hostTools' | 'profileOverride'>,
  pluginSubagent?: { tools?: readonly string[] } | null,
) {
  if (identity.hostTools === undefined && identity.profileOverride) return identity.profileOverride
  const typed = pluginSubagent?.tools
  const host = identity.hostTools
  const tools = typed && host ? typed.filter((name) => host.includes(name)) : (typed ?? host)
  return resolveRunProfile(session, {
    ...(instructions ? { prompt: instructions } : {}),
    ...(tools !== undefined ? { tools } : {}),
    ...(pluginSubagent && tools === undefined ? { inheritsConversationTools: true } : {}),
  })
}
