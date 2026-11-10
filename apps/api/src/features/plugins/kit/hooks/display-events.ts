import { resolveWorktreePath } from '@rsaryev/llx-plugin/hooks'
import type { HookOutcome } from '@rsaryev/llx-plugin'
import type {
  McpElicitationAnswer,
  McpElicitationContent,
  McpElicitationHookRequest,
} from '../../../agent-core/tools/hitl/mcp-elicitation'
import type { CcHooksRuntime } from '../../../cc-hooks/runtime-contracts'
import type { EventDeps } from './runtime'

type DisplayEvents = Pick<
  CcHooksRuntime,
  'runElicitation' | 'runElicitationResult' | 'runMessageDisplay' | 'runWorktreeCreate'
>

/** A hook's answer to an elicitation; a block declines it. */
function answerOf(
  outcome: HookOutcome<'Elicitation' | 'ElicitationResult'> | undefined,
): McpElicitationAnswer | undefined {
  if (!outcome) return undefined
  if (!outcome.proceed) return { action: 'decline' }
  const said = outcome.effects.elicitation
  if (!said) return undefined
  const content = said.content as McpElicitationContent | undefined
  if (said.action === 'accept') return { action: 'accept', content: content ?? {} }
  return { action: said.action, ...(content ? { content } : {}) }
}

const requestFacts = (request: McpElicitationHookRequest) => ({
  mcp_server_name: request.server,
  mode: request.mode,
  ...(request.elicitationId ? { elicitation_id: request.elicitationId } : {}),
})

/** What the chat shows and asks: an elicitation, a message's display, a worktree's folder. */
export function createDisplayEvents({ fire, cwd }: EventDeps): DisplayEvents {
  return {
    runElicitation: async (request) =>
      answerOf(
        await fire('Elicitation', {
          ...requestFacts(request),
          message: request.message,
          ...(request.url ? { url: request.url } : {}),
          ...(request.requestedSchema ? { requested_schema: request.requestedSchema } : {}),
        } as never),
      ),
    runElicitationResult: async (request, answer) =>
      answerOf(
        await fire('ElicitationResult', {
          ...requestFacts(request),
          action: answer.action,
          ...(answer.content ? { content: answer.content } : {}),
        } as never),
      ),
    async runMessageDisplay(message) {
      const outcome = await fire('MessageDisplay', {
        turn_id: message.turnId,
        message_id: message.messageId,
        index: 0,
        final: true,
        delta: message.text,
      })
      const shown = outcome?.effects.displayContent
      return shown !== undefined && shown !== message.text ? { displayContent: shown } : {}
    },
    async runWorktreeCreate(name) {
      const outcome = await fire('WorktreeCreate', { name })
      if (!outcome) return undefined
      const resolved = await resolveWorktreePath(outcome, { ranIn: cwd })
      return 'path' in resolved
        ? { ok: true, path: resolved.path, cwd }
        : { ok: false, error: resolved.failure }
    },
  }
}
