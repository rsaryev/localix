import { ApiError } from '../../../lib/errors'
import { agentHandleSchema } from '@localixai/agent/agents'
import { TOOL } from '../../agent-core/tool-names'
import type { MessageMutationResponse } from '../contracts'
import type { SessionRecord } from '../repository'
import { BUSY_STOP_FIRST, type CommandHandlerContext } from './command-handlers-context'
import { assertSessionNotBusy } from './session-access'

type CreateCommandContext = Pick<
  CommandHandlerContext,
  'repo' | 'runner' | 'now' | 'runMacroCommand'
>

/**
 * `/agents create <request>` is prose when it has no options and is not one valid handle: several
 * words, or a word a handle cannot be. A single handle still opens the form, and options still
 * save directly, so the request form never guesses a name out of the first word.
 *
 * Read from the raw prompt before tokenizing: prose keeps its lines, and an apostrophe such as
 * "doesn't" is not an unclosed quote.
 */
export function agentCreateRequest(prompt: string): string | null {
  const match = /^\s*\/agents\s+create(?:\s+([\s\S]*))?$/iu.exec(prompt)
  const request = match?.[1]?.trim()
  if (!request || /(^|\s)--\S/u.test(request)) return null
  const handle = request.replace(/^@/, '')
  if (!/\s/u.test(request) && agentHandleSchema.safeParse(handle).success) return null
  return request
}

function createAgentInstruction(request: string): string {
  return [
    `The user wants a new reusable specialist agent in this chat’s registry: ${request}`,
    `Call ${TOOL.agents} with action "create" and one agent: handle — short, lower-kebab-case and not already in the agent directory; description — one English sentence on its specialization; instructions — standing instructions it can reuse across tasks, without task-specific details or private chat data; leadership_priority — an integer from −2 to 2 (0 for a regular specialist, negative for a supporting role).`,
    'Creating the agent does not invite or start it. Afterwards, reply with its handle written without @ and one line on what it does; tag it only if the user asked for it to start working here.',
  ].join('\n\n')
}

/** An agent turn, like `/plugin create`: the request stays in the transcript, and the run needs the tool. */
export function runAgentCreateRequest(
  ctx: CreateCommandContext,
  userId: string,
  session: SessionRecord,
  prompt: string,
  request: string,
): Promise<MessageMutationResponse> {
  assertSessionNotBusy(ctx.runner, session.id, BUSY_STOP_FIRST)
  if (!session.agents.length) {
    throw new ApiError(400, 'session_party_empty', 'Choose an agent before running a command')
  }
  return ctx.runMacroCommand(
    userId,
    session.id,
    session,
    () => ctx.repo.listMessages(userId, session.id),
    prompt,
    createAgentInstruction(request),
    ctx.now(),
    {
      commandOrigin: { command: '/agents create', label: 'Agent · new' },
      requiredTools: [{ name: TOOL.agents }],
    },
  )
}
