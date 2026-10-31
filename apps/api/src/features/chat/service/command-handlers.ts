import { formatSessionUsageFromTurns } from './usage'
import { parseControlCommand, parseSlashInvocation } from './slash-commands'
import { handleLoopControlCommand } from './command-handlers-loop'
import {
  handleHelpControlCommand,
  handleMemoryControlCommand,
  handleSkillsControlCommand,
  handleMcpControlCommand,
} from './command-handlers-listings'
import { handleRecapCommand } from './command-handlers-recap'
import { handleModelCommand } from './command-handlers-settings'
import { handleOutputStyleCommand } from './command-handlers-output-style'
import { handlePluginsControlCommand, reloadPlugins } from './command-handlers-plugins'
import { handleMiniAppsControlCommand } from './command-handlers-mini-apps'
import { handleAgentsControlCommand } from './command-handlers-agents'
import { handleClaudeCodeControlCommand, isClaudeCodeControl } from './command-handlers-claude-code'
import type { SessionRecord } from '../repository'
import type { MessageMutationResponse } from '../contracts'
import type { CommandHandlerContext } from './command-handlers-context'
import { readSessionUsageRows } from '../../usage/session-summary'
import { resolveCommandSpec, suggestCommands } from '../slash-catalog'
import { claudeCodeGapReply } from '../slash-catalog-claude-code-gaps'

// Re-export the handler-context surface so existing importers of
// './command-handlers' (the sibling handler modules + service.ts) are unchanged.
export { type CommandHandlerContext, type DirectReply } from './command-handlers-context'

export { handlePluginCommand } from './command-handlers-plugin-command'
export { handleMcpPromptCommand } from './command-handlers-mcp-prompt'
export { handleSkillCommand } from './command-handlers-skill'

/**
 * Handles the built-in control slash commands the catalog marks `scope: 'server'` (/help,
 * /usage, /model, /output-style, /memory, /skills, /mcp, /plugin, /mini-app, /loop, /agents,
 * /recap and Claude Code's /reload-plugins). Returns null when the prompt isn't a control
 * command — the caller falls through to the next dispatch stage. `scope: 'client'` commands
 * (/fork, /clear, /rewind, …) never parse here: the composer runs them.
 */
export async function handleControlCommand(
  ctx: CommandHandlerContext,
  userId: string,
  sessionId: string,
  session: SessionRecord,
  prompt: string,
): Promise<MessageMutationResponse | null> {
  const { repo, usageRepo, now, insertDirectReply } = ctx

  const control = parseControlCommand(prompt)
  if (!control) return null

  const ts = now()
  const existingMessages = () => repo.listMessages(userId, sessionId)

  // Local shorthand: every direct reply in this handler shares the same
  // userId/sessionId/prompt/ts — only the text varies.
  const directReply = (text: string) => insertDirectReply(userId, sessionId, prompt, text, ts)

  if (control === 'help') {
    return handleHelpControlCommand(directReply, prompt)
  }

  if (control === 'agents') {
    return handleAgentsControlCommand(ctx, userId, session, prompt, directReply)
  }

  if (control === 'usage') {
    const [turns, ledgerByKind] = await Promise.all([
      repo.getActiveBranchUsage(userId, sessionId),
      readSessionUsageRows(usageRepo, userId, sessionId),
    ])
    return directReply(formatSessionUsageFromTurns(turns, ledgerByKind))
  }

  if (control === 'recap') {
    return handleRecapCommand(ctx, userId, sessionId, directReply)
  }

  if (control === 'model') {
    return handleModelCommand(ctx, userId, sessionId, session, prompt, ts, directReply)
  }

  if (control === 'output-style') {
    return handleOutputStyleCommand(ctx, userId, sessionId, session, prompt, ts, directReply)
  }

  if (control === 'loop') {
    return handleLoopControlCommand(
      ctx,
      userId,
      sessionId,
      session,
      existingMessages,
      prompt,
      ts,
      directReply,
    )
  }

  if (control === 'memory') {
    return handleMemoryControlCommand(ctx, userId, session, prompt, directReply)
  }

  if (control === 'skills') {
    return handleSkillsControlCommand(ctx, userId, session, directReply)
  }

  if (control === 'mcp') {
    return handleMcpControlCommand(ctx, userId, session, prompt, directReply)
  }

  if (control === 'plugins') {
    return handlePluginsControlCommand(ctx, userId, session, prompt, directReply)
  }

  if (control === 'reload-plugins') {
    return reloadPlugins(ctx.pluginService, directReply)
  }

  if (control === 'mini-apps') {
    return handleMiniAppsControlCommand(ctx, userId, session, prompt, directReply)
  }

  if (isClaudeCodeControl(control)) {
    return handleClaudeCodeControlCommand(ctx, control, userId, session, prompt, directReply)
  }

  // Values can cross untyped RPC/plugin/test boundaries; an unknown one fails closed.
  return unsupportedControlCommand(control)
}

function unsupportedControlCommand(command: never): never {
  throw new Error(`Unsupported control command: ${String(command)}`)
}

/** Final slash-routing gate. Control, plugin, and skill handlers all had their
 * chance before this runs; a remaining command-shaped token is therefore an
 * error, not model input. This prevents typos and client-only commands on an
 * unsupported surface from silently becoming agent prompts. */
export async function handleUnresolvedSlashCommand(
  ctx: Pick<CommandHandlerContext, 'insertDirectReply' | 'now'>,
  userId: string,
  sessionId: string,
  prompt: string,
): Promise<MessageMutationResponse | null> {
  const invocation = parseSlashInvocation(prompt)
  if (!invocation) return null

  const spec = resolveCommandSpec(invocation.name)
  // A Claude Code command Localix cannot run says why. Read only here, after skills and plugins
  // had their chance, so a skill or plugin command of the same name still runs.
  const gap = spec ? undefined : claudeCodeGapReply(invocation.name)
  if (gap) return ctx.insertDirectReply(userId, sessionId, prompt, gap, ctx.now(), 'warning')
  const reply =
    spec?.scope === 'client'
      ? `Command \`/${spec.name}\` must be handled by a compatible client and is not available on this surface.`
      : (() => {
          const suggestions = suggestCommands(invocation.name)
          const hint = suggestions.length
            ? ` Did you mean ${suggestions.map((candidate) => `\`/${candidate.name}\``).join(', ')}?`
            : ' Run `/help` to see available commands.'
          return `Unknown slash command \`/${invocation.name}\`.${hint}`
        })()
  const tone = spec?.scope === 'client' ? 'warning' : 'error'
  return ctx.insertDirectReply(userId, sessionId, prompt, reply, ctx.now(), tone)
}
