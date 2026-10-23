import { InvalidRequestError } from '../../../lib/domain-errors'
import { MINI_APP_BUILD_TOOL } from '../../mini-apps/authoring/prose'
import type { MessageMutationResponse } from '../contracts'
import type { SessionRecord } from '../repository'
import {
  BUSY_STOP_FIRST,
  type CommandHandlerContext,
  type DirectReply,
} from './command-handlers-context'
import { assertSessionNotBusy } from './session-access'

/**
 * `/mini-app create <what it should do>` — the person describes a mini app; the agent names it and
 * builds it, its first `mini_app_build` call creating the copy.
 *
 * ONE form, the description. The command used to take a name too (`<name> [description]`, or
 * `--describe` to delegate the name), so the person had to invent a lower-kebab identifier before
 * saying what they wanted, and `create show GPU temperatures` silently made an app named "show".
 * Naming is the agent's job; the host makes the name valid and unique (`mini_app_build`).
 *
 * The write is deferred to that tool call: a host that forked the template before the turn left an
 * enabled throwaway copy whenever the run could not reach the tool. And no source checkout is
 * named: a user's mini app lives in `~/.localix/mini-apps`, never in the application's repository.
 */

export const CREATE_USAGE =
  'Usage: `/mini-app create <what it should do>` — e.g. `/mini-app create show GPU temperature and fan speed`. The agent names the mini app, builds it in `~/.localix/mini-apps` and enables it.'

type CreateCommandContext = Pick<
  CommandHandlerContext,
  'repo' | 'runner' | 'now' | 'runMacroCommand'
>

/** The agent turn: the model picks the identity, and its first call creates the mini app. */
function createMiniAppInstruction(description: string): string {
  return [
    `The user wants a new Localix mini app: ${description}`,
    `Call ${MINI_APP_BUILD_TOOL} first, before reading or writing anything, with: name — a short lower-kebab-case name (e.g. gpu-monitor); title — the name people see, a few words (e.g. GPU Monitor); description — one English sentence on what it does. The host creates the mini app in ~/.localix/mini-apps/<name> under that name or the next free one, builds and enables it, and answers with the authoring instruction. Use the name the result gives, and follow the instruction to the end.`,
  ].join('\n\n')
}

export async function handleMiniAppCreateSubcommand(
  ctx: CreateCommandContext,
  userId: string,
  session: SessionRecord,
  prompt: string,
  directReply: DirectReply,
): Promise<MessageMutationResponse> {
  // From the prompt itself, not its whitespace tokens: a detailed request has lines and lists.
  const description = prompt.replace(/^\s*\/mini-app\s+create(?:\s+|$)/iu, '').trim()
  if (!description) return directReply(CREATE_USAGE)

  // Reject what would fail the turn before it starts: an active session, an agentless one.
  assertSessionNotBusy(ctx.runner, session.id, BUSY_STOP_FIRST)
  if (!session.agents.length) {
    throw new InvalidRequestError('session_party_empty', 'Choose an agent before running a command')
  }
  // An agent turn, not a direct reply: the user's message stays in the transcript as the request
  // it is, and the run cannot start without the one tool that creates the mini app.
  return ctx.runMacroCommand(
    userId,
    session.id,
    session,
    () => ctx.repo.listMessages(userId, session.id),
    prompt,
    createMiniAppInstruction(description),
    ctx.now(),
    {
      commandOrigin: { command: '/mini-app create', label: 'Mini app · new' },
      requiredTools: [{ name: MINI_APP_BUILD_TOOL }],
    },
  )
}
