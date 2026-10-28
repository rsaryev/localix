import { DEFAULT_AGENT_ID } from '@localixai/agent/agents'
import type { MessageBinding } from '@localixai/agent'
import { errorMessage } from '../../../lib/errors'
import { readAvailability } from '../../capabilities/availability'
import { mcpClientManager } from '../../mcp/client-manager'
import {
  mcpPromptCommandName,
  parsePromptArguments,
  promptInstruction,
  type McpPromptDef,
  type McpPromptResult,
} from '../../mcp/mcp-prompts'
import type { McpServerRecord } from '../../mcp/repository'
import type { SessionRecord } from '../repository'
import type { MessageMutationResponse } from '../contracts'
import type { CommandHandlerContext } from './command-handlers-context'
import { resolveMessageBindings } from './message-bindings'
import { sessionMcpServers } from './mcp-session-servers'

/** `/mcp__<server>__<prompt>`: a server's prompt, typed as Claude Code types it. */
export const isMcpPromptToken = (token: string): boolean => /^\/mcp__[^\s]+__[^\s]+$/i.test(token)

/** What a prompt command needs from the session: its servers, their switches and connections. */
export interface McpPromptPorts {
  servers(): Promise<McpServerRecord[]>
  enabled(name: string): boolean
  /** Connects the server if it is not yet. */
  prompts(server: McpServerRecord): Promise<McpPromptDef[]>
  getPrompt(
    server: McpServerRecord,
    name: string,
    args: Record<string, string>,
  ): Promise<McpPromptResult>
}

export type McpPromptOutcome =
  | { kind: 'run'; instruction: string }
  | { kind: 'reply'; text: string; tone: 'warning' | 'error' }

const failure = (text: string): McpPromptOutcome => ({ kind: 'reply', text, tone: 'error' })

/**
 * Resolves a typed `/mcp__<server>__<prompt> <arguments>` to the turn it makes, or to the reply
 * that says why it cannot: no such server or prompt, a server switched off or down, a missing
 * argument. The server is one whose normalized name begins the token and which offers the prompt the
 * token spells (longest name first, as names may hold `_`); a miss reports the longest server's.
 */
export async function resolveMcpPromptCommand(
  ports: McpPromptPorts,
  token: string,
  argString: string,
): Promise<McpPromptOutcome> {
  const command = token.replace(/^\//, '')
  const wanted = command.toLowerCase()
  const servers = await ports.servers()
  const prefix = (server: McpServerRecord) => mcpPromptCommandName(server.name, '').toLowerCase()
  // Longest name first. Names may hold `__`, so `a` + `b__c` and `a__b` + `c` spell one command:
  // every matching server is asked, and the first that has the prompt takes it.
  const named = servers
    .filter((server) => wanted.startsWith(prefix(server)))
    .sort((a, b) => prefix(b).length - prefix(a).length)
  if (!named.length)
    return failure(
      `No MCP server matches \`/${command}\`. Servers: ${
        servers.map((s) => `\`${s.name}\``).join(', ') || 'none'
      }.`,
    )
  let found: { server: McpServerRecord; prompt: McpPromptDef } | undefined
  let firstFailure: McpPromptOutcome | undefined
  for (const server of named) {
    let reason: McpPromptOutcome | undefined
    if (!ports.enabled(server.name)) {
      reason = failure(
        `\`${server.name}\` is disabled. Enable it with \`/mcp enable ${server.name}\`.`,
      )
    } else {
      try {
        const prompts = await ports.prompts(server)
        const prompt = prompts.find(
          (candidate) => mcpPromptCommandName(server.name, candidate.name).toLowerCase() === wanted,
        )
        if (prompt) {
          found = { server, prompt }
          break
        }
        reason = failure(
          `\`${server.name}\` has no prompt \`/${command}\`. Its prompts: ${
            prompts.map((p) => `\`/${mcpPromptCommandName(server.name, p.name)}\``).join(', ') ||
            'none'
          }.`,
        )
      } catch (error) {
        reason = failure(`Could not connect \`${server.name}\`: ${errorMessage(error)}`)
      }
    }
    firstFailure ??= reason
  }
  if (!found) return firstFailure!
  const { server, prompt } = found
  const parsed = parsePromptArguments(
    prompt,
    argString,
    mcpPromptCommandName(server.name, prompt.name),
  )
  if ('usage' in parsed) return { kind: 'reply', text: parsed.usage, tone: 'warning' }
  let result: McpPromptResult
  try {
    result = await ports.getPrompt(server, prompt.name, parsed.values)
  } catch (error) {
    return failure(`\`/${command}\` failed: ${errorMessage(error)}`)
  }
  const instruction = promptInstruction(result).trim()
  if (!instruction) return failure(`\`/${command}\` returned no text, so there is nothing to send.`)
  return { kind: 'run', instruction }
}

/**
 * Handles `/mcp__<server>__<prompt> <arguments>`: the prompt's messages become the turn, run as
 * any command's are. Returns null when the first token is not an MCP prompt command.
 */
export async function handleMcpPromptCommand(
  ctx: CommandHandlerContext,
  userId: string,
  sessionId: string,
  session: SessionRecord,
  prompt: string,
  bindings?: MessageBinding[],
): Promise<MessageMutationResponse | null> {
  const token = prompt.trim().split(/\s+/)[0] ?? ''
  if (!isMcpPromptToken(token)) return null
  const argString = prompt.trim().slice(token.length).trim()
  const cwd = await ctx.resolveSessionWorkingDir(userId, session)
  const availability = await readAvailability(ctx.deps.db, {
    userId,
    agentId: session.agent?.agentId || DEFAULT_AGENT_ID,
  })
  const outcome = await resolveMcpPromptCommand(
    {
      servers: () => sessionMcpServers(ctx, userId, session, cwd),
      enabled: (name) => availability.effectFor('mcp', name) !== 'deny',
      prompts: (server) => mcpClientManager.promptsOf(server, cwd),
      getPrompt: (server, name, args) => mcpClientManager.getPrompt(server, cwd, name, args),
    },
    token,
    argString,
  )
  const ts = ctx.now()
  if (outcome.kind === 'reply')
    return ctx.insertDirectReply(userId, sessionId, prompt, outcome.text, ts, outcome.tone)
  const resolved = await resolveMessageBindings(ctx.deps, userId, session, bindings)
  return ctx.runMacroCommand(
    userId,
    sessionId,
    session,
    () => ctx.repo.listMessages(userId, sessionId),
    prompt,
    outcome.instruction,
    ts,
    {
      commandOrigin: { command: token, label: token },
      ...(resolved?.length ? { bindings: resolved } : {}),
    },
  )
}
