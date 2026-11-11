import {
  answerElicitation,
  autoRespondElicitation,
  elicitationHookFacts,
  overrideElicitationResult,
  type ElicitationAnswer,
} from '@rsaryev/llx-plugin/elicitation'
import type { ElicitationRequest, HookOutcome } from '@rsaryev/llx-plugin'
import type {
  McpElicitationAnswer,
  McpElicitationHookRequest,
} from '../../agent-core/tools/hitl/mcp-elicitation'

/**
 * An MCP elicitation's answers, as Claude Code decides them (mcp.md, "Respond to MCP elicitation
 * requests"; hooks.md, "Elicitation", "ElicitationResult"): the person's answer checked against the
 * requested form (`answerElicitation`), an `Elicitation` hook's answer sent without a card
 * (`autoRespondElicitation`), and an `ElicitationResult` hook's override (`overrideElicitationResult`).
 * A blocking hook is the kit's decline. `mcp` reaches the first through its installed port.
 */

const kitRequest = (request: McpElicitationHookRequest): ElicitationRequest => ({
  serverName: request.server,
  message: request.message,
  mode: request.mode,
  ...(request.url ? { url: request.url } : {}),
  ...(request.elicitationId ? { elicitationId: request.elicitationId } : {}),
  ...(request.requestedSchema ? { requestedSchema: { ...request.requestedSchema } } : {}),
})

/** What the `Elicitation` hook receives about the request. */
export const elicitationFacts = (request: McpElicitationHookRequest) =>
  elicitationHookFacts(kitRequest(request))

/** The answer the person gave, as the server gets it, or the problems of its form's values. */
export const personElicitationAnswer = (
  request: McpElicitationHookRequest,
  answer: McpElicitationAnswer,
): ElicitationAnswer =>
  answerElicitation(
    kitRequest(request),
    answer.action === 'accept'
      ? { action: 'accept', values: answer.content ?? {} }
      : { action: answer.action },
  )

type ElicitationOutcome = HookOutcome<'Elicitation' | 'ElicitationResult'> | undefined

/** The `Elicitation` hooks' answer, sent to the server without a card; `undefined`: ask the person. */
export function hookElicitationAnswer(
  outcome: ElicitationOutcome,
): McpElicitationAnswer | undefined {
  const said = outcome?.effects.elicitation
  return autoRespondElicitation(said && { hookEventName: 'Elicitation', ...said })
}

/** The answer after the `ElicitationResult` hooks; `undefined`: they left it as it was. */
export function reviewedElicitationAnswer(
  outcome: ElicitationOutcome,
  answer: McpElicitationAnswer,
): McpElicitationAnswer | undefined {
  const said = outcome?.effects.elicitation
  if (!said) return undefined
  return overrideElicitationResult(answer, { hookEventName: 'ElicitationResult', ...said })
}
