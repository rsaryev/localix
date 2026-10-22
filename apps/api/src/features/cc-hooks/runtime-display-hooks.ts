/**
 * The Claude Code events around what the person sees and answers: an MCP server's request for
 * input (`Elicitation`, `ElicitationResult`) and the assistant text on screen (`MessageDisplay`).
 */
import type {
  McpElicitationAnswer,
  McpElicitationContent,
  McpElicitationHookRequest,
} from '../agent-core/tools/hitl/mcp-elicitation'
import type { CcHookInput, CcHookOutcome } from './contracts'
import { matchesField } from './matcher'
import type { HookDispatchDeps } from './runtime-tool-hooks'

export interface CcDisplayHooksRuntime {
  /**
   * An MCP server asked for input. An answer (`action`, exit 2 or `decision:"block"` declining)
   * goes to the server in place of the card; undefined leaves it to the person.
   */
  runElicitation(request: McpElicitationHookRequest): Promise<McpElicitationAnswer | undefined>
  /** The person answered; a hook may replace or block the answer. Undefined lets it through. */
  runElicitationResult(
    request: McpElicitationHookRequest,
    answer: McpElicitationAnswer,
  ): Promise<McpElicitationAnswer | undefined>
  /** The final assistant text is settled; `displayContent` replaces only what is shown. */
  runMessageDisplay(message: {
    turnId: string
    messageId: string
    text: string
  }): Promise<{ displayContent?: string }>
}

/**
 * Fold the answers of every hook that ran, as Claude Code does: a decline from any of them — its
 * `action`, an exit 2 (whose `hookSpecificOutput` is ignored) or a top-level `decision:"block"`
 * — overrides an accept or a cancel from another. A cancel outranks an accept; among accepts the
 * last one's content stands. Failed hooks have no say.
 */
export function elicitationAnswerFrom(
  outcomes: readonly CcHookOutcome[],
): McpElicitationAnswer | undefined {
  let answer: McpElicitationAnswer | undefined
  for (const outcome of outcomes) {
    if (outcome.blocked || outcome.decision === 'block') return { action: 'decline' }
    const said = outcome.elicitation
    if (!said) continue
    if (said.action === 'decline') return { action: 'decline' }
    const content = said.content as McpElicitationContent | undefined
    if (said.action === 'cancel') answer = { action: 'cancel', ...(content ? { content } : {}) }
    else if (answer?.action !== 'cancel') answer = { action: 'accept', content: content ?? {} }
  }
  return answer
}

/** The last hook that named a replacement text wins; none (or a failure) shows the original. */
export function displayContentFrom(outcomes: readonly CcHookOutcome[]): string | undefined {
  let shown: string | undefined
  for (const outcome of outcomes)
    if (outcome.displayContent !== undefined) shown = outcome.displayContent
  return shown
}

export function createDisplayHookRunners({
  runAll,
  baseInput,
}: HookDispatchDeps): CcDisplayHooksRuntime {
  const optional = (request: McpElicitationHookRequest) => ({
    mode: request.mode,
    ...(request.elicitationId ? { elicitation_id: request.elicitationId } : {}),
  })
  return {
    async runElicitation(request) {
      const input: CcHookInput = {
        ...baseInput('Elicitation'),
        mcp_server_name: request.server,
        message: request.message,
        ...optional(request),
        ...(request.url ? { url: request.url } : {}),
        ...(request.requestedSchema ? { requested_schema: request.requestedSchema } : {}),
      }
      const match = (m: string | undefined) => matchesField(m, request.server)
      return elicitationAnswerFrom(await runAll('Elicitation', match, input, false))
    },

    async runElicitationResult(request, answer) {
      const input: CcHookInput = {
        ...baseInput('ElicitationResult'),
        mcp_server_name: request.server,
        action: answer.action,
        ...(answer.content ? { content: answer.content } : {}),
        ...optional(request),
      }
      const match = (m: string | undefined) => matchesField(m, request.server)
      return elicitationAnswerFrom(await runAll('ElicitationResult', match, input, false))
    },

    async runMessageDisplay(message) {
      const input: CcHookInput = {
        ...baseInput('MessageDisplay'),
        turn_id: message.turnId,
        message_id: message.messageId,
        index: 0,
        final: true,
        delta: message.text,
      }
      // No matcher support: every handler runs on every message, as in Claude Code.
      const shown = displayContentFrom(await runAll('MessageDisplay', () => true, input, false))
      return shown !== undefined && shown !== message.text ? { displayContent: shown } : {}
    },
  }
}
