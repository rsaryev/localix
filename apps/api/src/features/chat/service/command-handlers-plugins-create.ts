import { ApiError } from '../../../lib/errors'
import { PLUGIN_BUILD_TOOL } from '../../plugins/authoring/prose'
import type { MessageMutationResponse } from '../contracts'
import type { SessionRecord } from '../repository'
import {
  BUSY_STOP_FIRST,
  type CommandHandlerContext,
  type DirectReply,
} from './command-handlers-context'
import { assertSessionNotBusy } from './session-access'

/**
 * `/plugin create <what it should do>` — the person describes a plugin; the agent names it and
 * builds it, its first `plugin_build` call creating the copy.
 *
 * ONE form, the description. The command used to take a name too (`<name> [description]`, or
 * `--describe` to delegate the name), so the person had to invent a lower-kebab identifier before
 * saying what they wanted, and `/plugin create show GPU temperatures` silently made a plugin named
 * "show". Naming is the agent's job; the host makes the name valid and unique (`plugin_build`).
 *
 * The write is deferred to that tool call: a host that forked the template before the turn left an
 * enabled throwaway copy whenever the run could not reach the tool. And no source checkout is
 * named: a user plugin lives in `~/.localix/plugins`, never in the application's repository.
 */

export const CREATE_USAGE =
  'Usage: `/plugin create <what it should do>` — e.g. `/plugin create show GPU temperature and fan speed`. The agent names the plugin, builds it in `~/.localix/plugins` and enables it.'

type CreateCommandContext = Pick<
  CommandHandlerContext,
  'repo' | 'runner' | 'now' | 'runMacroCommand'
>

/** The agent turn: the model picks the identity, and its first call creates the plugin. */
function createPluginInstruction(description: string): string {
  return [
    `The user wants a new Localix plugin: ${description}`,
    `Call ${PLUGIN_BUILD_TOOL} first, before reading or writing anything, with: name — a short lower-kebab-case name (e.g. gpu-monitor); title — the name people see, a few words (e.g. GPU Monitor); description — one English sentence on what it does. The host creates the plugin in ~/.localix/plugins/<name> under that name or the next free one, builds and enables it, and answers with the authoring instruction. Use the name the result gives, and follow the instruction to the end.`,
  ].join('\n\n')
}

export async function handlePluginCreateSubcommand(
  ctx: CreateCommandContext,
  userId: string,
  session: SessionRecord,
  prompt: string,
  directReply: DirectReply,
): Promise<MessageMutationResponse> {
  // From the prompt itself, not its whitespace tokens: a detailed request has lines and lists.
  const description = prompt.replace(/^\s*\/plugin\s+create(?:\s+|$)/iu, '').trim()
  if (!description) return directReply(CREATE_USAGE)

  // Reject what would fail the turn before it starts: an active session, an agentless one.
  assertSessionNotBusy(ctx.runner, session.id, BUSY_STOP_FIRST)
  if (!session.agents.length) {
    throw new ApiError(400, 'session_party_empty', 'Choose an agent before running a command')
  }
  // An agent turn, not a direct reply: the user's message stays in the transcript as the request
  // it is, and the run cannot start without the one tool that creates the plugin.
  return ctx.runMacroCommand(
    userId,
    session.id,
    session,
    () => ctx.repo.listMessages(userId, session.id),
    prompt,
    createPluginInstruction(description),
    ctx.now(),
    {
      commandOrigin: { command: '/plugin create', label: 'Plugin · new' },
      requiredTools: [{ name: PLUGIN_BUILD_TOOL }],
    },
  )
}
