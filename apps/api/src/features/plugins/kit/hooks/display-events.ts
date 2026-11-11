import { resolveWorktreePath } from '@rsaryev/llx-plugin/hooks'
import type { McpElicitationHookRequest } from '../../../agent-core/tools/hitl/mcp-elicitation'
import type { CcHooksRuntime } from '../../../cc-hooks/runtime-contracts'
import { elicitationFacts, hookElicitationAnswer, reviewedElicitationAnswer } from '../elicitation'
import type { EventDeps } from './runtime'

type DisplayEvents = Pick<
  CcHooksRuntime,
  'runElicitation' | 'runElicitationResult' | 'runMessageDisplay' | 'runWorktreeCreate'
>

const requestFacts = (request: McpElicitationHookRequest) => ({
  mcp_server_name: request.server,
  mode: request.mode,
  ...(request.elicitationId ? { elicitation_id: request.elicitationId } : {}),
})

/** What the chat shows and asks: an elicitation, a message's display, a worktree's folder. */
export function createDisplayEvents({ fire, cwd }: EventDeps): DisplayEvents {
  return {
    runElicitation: async (request) =>
      hookElicitationAnswer(await fire('Elicitation', elicitationFacts(request))),
    runElicitationResult: async (request, answer) =>
      reviewedElicitationAnswer(
        await fire('ElicitationResult', {
          ...requestFacts(request),
          action: answer.action,
          ...(answer.content ? { content: answer.content } : {}),
        } as never),
        answer,
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
