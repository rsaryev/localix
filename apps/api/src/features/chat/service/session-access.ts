import { ConflictError } from '../../../lib/domain-errors'
import { isToolBackedItem } from '@localixai/agent/agents'

import { TOOL } from '../../agent-core/tool-names'
import type { createKeyedSerializer } from '../../../lib/keyed-serializer'
import type { PersistedMessage, SessionSourceRuntime } from '../contracts'
import type { SessionRecord } from '../repository'

/**
 * Serializes a session's write-path mutations: two concurrent entries (send, edit,
 * rollback, fork, thread append, external turn) can never interleave a
 * read-modify-write of the same message tree. It IS `lib/keyed-serializer.ts`,
 * keyed by sessionId — named here so the op modules that take it as a collaborator
 * agree on one signature instead of each restating it.
 */
export type SessionMutationLock = ReturnType<typeof createKeyedSerializer>

export function assertMutableChatSession(session: SessionRecord) {
  if (session.sessionKind !== 'chat') {
    throw new ConflictError('runtime_session_readonly', 'Runtime sessions are read-only')
  }
}

/**
 * Which sessions accept a turn the PERSON types: a chat, and a delegated child that is still open.
 *
 * A delegated child used to be refused here as "immutable history" — while the client left its
 * composer enabled, so what the person wrote was bounced back with a read-only error. A child is
 * not one-shot any more: its delegator messages it, every run reports back
 * (`run/child-run-report.ts`), and the person may write to it the same way. What stays read-only
 * is a CLOSED child (`subagent-close.ts`), and the runtime kinds nobody converses with.
 */
export function assertUserWritableSession(session: SessionRecord) {
  if (session.closedAt) {
    throw new ConflictError(
      'session_closed',
      'This sub-agent was closed and takes no more messages',
    )
  }
  const delegatedChild =
    session.sessionKind === 'subagent' && session.provenance.kind === 'task-delegation'
  if (session.sessionKind !== 'chat' && !delegatedChild) {
    throw new ConflictError('runtime_session_readonly', 'This runtime session is read-only')
  }
}

/**
 * Throw a 409 `session_busy` if the session is BUSY — a run is active OR a wake is
 * mid-drain. The predicate is `isBusy` (activeRuns OR drainingSessions), NOT the
 * weaker `isRunning` (activeRuns only): a wake sets `drainingSessions`
 * synchronously but only enters `activeRuns` several awaits later, so during that
 * DRAIN WINDOW `isRunning` reads idle while a run is provably about to start.
 * Gating on `isRunning` let a macro (/clear), an edit/rollback/
 * fork, or a continuation turn slip through and read-modify-write CONCURRENTLY
 * with the starting run. Every production runner
 * supplies `isBusy`; `isRunning` remains only as a fallback for narrow test
 * doubles that predate it. The user-facing message varies by call site, so it is
 * overridable while the status + error code stay fixed. Release It!: fail fast and
 * VISIBLY (409), never silently mutate context under a run.
 */
export function assertSessionNotBusy(
  runner: {
    isBusy?(sessionId: string): boolean
    isRunning(sessionId: string): boolean
  },
  sessionId: string,
  message = 'Session is already generating',
) {
  const busy = runner.isBusy ? runner.isBusy(sessionId) : runner.isRunning(sessionId)
  if (busy) {
    throw new ConflictError('session_busy', message)
  }
}

export const findToolItemByCallId = (messages: PersistedMessage[], toolCallId: string) => {
  for (const message of messages) {
    const match = message.payload.items?.find(
      (it) => isToolBackedItem(it) && it.toolCallId === toolCallId,
    )
    if (match && isToolBackedItem(match)) return match
  }
  return null
}

export const toSourceRuntime = (
  toolCallId: string,
  toolItem: ReturnType<typeof findToolItemByCallId>,
): SessionSourceRuntime | null => {
  if (!toolItem) return null

  const rawInput =
    toolItem.input && typeof toolItem.input === 'object'
      ? (toolItem.input as Record<string, unknown>)
      : null

  const toolName = toolItem.name

  if (toolName === TOOL.bash) {
    return {
      toolCallId,
      toolName,
      title: typeof rawInput?.description === 'string' ? rawInput.description : undefined,
      command: typeof rawInput?.command === 'string' ? rawInput.command : undefined,
      cwd: typeof rawInput?.cwd === 'string' ? rawInput.cwd : undefined,
      description: typeof rawInput?.description === 'string' ? rawInput.description : undefined,
      isBackground: Boolean(rawInput?.background),
    }
  }

  return {
    toolCallId,
    toolName,
  }
}
