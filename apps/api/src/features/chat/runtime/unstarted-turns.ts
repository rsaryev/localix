import type { ChatRepository } from '../repository'
import type { SessionStreamRegistry } from './session-stream-registry'
import { insertUiNote } from './message-persistence'
import type { TurnStartRepository } from './turn-start-repository'

/** Short, like every restart notice (see `RUN_INTERRUPTED_NOTICE`). */
export const TURN_NOT_STARTED_NOTICE = 'Backend restarted before this reply started.'

export interface SettleUnstartedTurnsDeps {
  turnStarts: TurnStartRepository
  repo: ChatRepository
  streamRegistry: SessionStreamRegistry
  now: () => string
  logger?: { warn: (msg: string) => void }
}

/**
 * Boot recovery for the one window the durable turn queue does not replay: an agent turn ticket
 * acknowledged (at most once, so a crash never repeats tools) before its run record existed.
 *
 * A slot whose run did start is left to the interrupted-run sweep. Otherwise its reply was never
 * written: the empty placeholder is removed and a notice says so, with a retry. Idempotent — the
 * notice id derives from the slot, and the record is settled only after both writes.
 */
export async function settleUnstartedTurns(deps: SettleUnstartedTurnsDeps): Promise<number> {
  let settled = 0
  for (const start of await deps.turnStarts.listPending()) {
    try {
      if (!(await deps.turnStarts.runStartedSince(start))) {
        const messages = await deps.repo.listMessages(start.userId, start.sessionId)
        const slot = messages.find((message) => message.id === start.assistantMessageId)
        const empty =
          slot && !slot.payload.content && !slot.payload.items?.length && !slot.payload.isInternal
        if (empty || !slot) {
          await insertUiNote({
            repo: deps.repo,
            streamRegistry: deps.streamRegistry,
            now: deps.now,
            userId: start.userId,
            sessionId: start.sessionId,
            messageId: `unstarted-${start.assistantMessageId}`,
            content: TURN_NOT_STARTED_NOTICE,
            systemNotice: {
              kind: 'run_interrupted',
              tone: 'warning',
              text: TURN_NOT_STARTED_NOTICE,
              recovery: ['retry'],
            },
          })
          if (slot) await deps.repo.deleteMessagesByIds(start.userId, start.sessionId, [slot.id])
          settled += 1
        }
      }
      await deps.turnStarts.settle(start.assistantMessageId)
    } catch (error) {
      // One unwritable session must not stop the boot; the record stays for the next one.
      deps.logger?.warn(
        `unstarted turn ${start.assistantMessageId}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  return settled
}
