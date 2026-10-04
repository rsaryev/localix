import type { SessionRecord } from '../repository'
import type { MessageMutationResponse } from '../contracts'
import type { ControlCommand } from './slash-commands'
import type { CommandHandlerContext, DirectReply } from './command-handlers'
import type { ExistingMessages } from './run-agent'

/**
 * Commands that reach the post-busy context mutation dispatcher. Deriving this
 * subset from ControlCommand makes the call site an exhaustiveness check: when
 * a new control command is added but not handled above it, type-checking fails
 * instead of silently routing the command into a context mutation.
 */
type MacroOrContextCommand = Extract<ControlCommand, 'clear'>

function unsupportedContextCommand(command: never): never {
  throw new Error(`Unsupported macro/context control command: ${String(command)}`)
}

/**
 * Handles the context-mutating control commands that run AFTER the session-busy
 * guard: `/clear` (bare boundary). Task macros belong to extensions, so no macro
 * runs through core.
 */
export async function handleMacroOrContextCommand(
  ctx: Pick<CommandHandlerContext, 'runner' | 'insertContextBoundary'>,
  control: MacroOrContextCommand,
  userId: string,
  sessionId: string,
  session: SessionRecord,
  _allMessages: ExistingMessages,
  prompt: string,
  ts: string,
  _directReply: DirectReply,
): Promise<MessageMutationResponse> {
  const { runner, insertContextBoundary } = ctx

  if (control === 'clear') {
    // CC re-fires SessionStart('clear') after /clear — schedule it for the next
    // run so any injected context lands in a model turn.
    runner.noteSessionStartSource(sessionId, 'clear')
    return insertContextBoundary(
      userId,
      sessionId,
      session,
      prompt,
      'Context cleared. Earlier messages stay visible but the agent will start fresh from here.',
      ts,
    )
  }

  // Keep an explicit runtime guard as well as the narrowed TypeScript contract.
  // Values can still cross untyped RPC/plugin/test boundaries; an unknown value
  // must fail closed without mutating context.
  return unsupportedContextCommand(control)
}
