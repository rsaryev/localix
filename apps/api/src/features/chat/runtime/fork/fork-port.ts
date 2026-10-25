import type { StoredMessagePayload } from '../../../../db'
import type { ForkSeed } from '../../../agent-core/fork-seed'
import type {
  ForkCapture,
  ForkRoute,
  TaskDelegationOptions,
} from '../../../agent-core/tools/task-delegation-contracts'
import type { ModelContextRepository } from '../../model-context-repository'
import type { ChatRepository, SessionRecord } from '../../repository'
import { forkSnapshotPayload } from './fork-row'

/**
 * What a run offers a fork of itself, read at the moment of the call. Left to the run (`stages/
 * stream.ts`) to fill, because the system prompt, the tools and the row in flight exist only
 * there.
 */
export interface ForkLiveRun {
  /** Resolves once the run has written the call into the row in flight (`createRecordedCalls`). */
  recorded: (toolCallId: string) => Promise<void>
  /** The assistant row the run is writing now (it moves when a steer splits the row). */
  currentRowId: () => string
  /** That row as the run holds it in memory, which is ahead of what is stored. */
  currentPayload: () => StoredMessagePayload
  /** The route the run is on: the fork is created on the same one. */
  route: ForkRoute
  /** The system prompt, the tools and the cache key this run is sending. */
  captureSeed: () => ForkSeed
}

/** What `capture` keeps for `persist`: the copy of the row and the seed, not yet stored. */
interface CapturedFork {
  parentRowId: string
  payload: StoredMessagePayload
  seed: ForkSeed
}

export interface ForkPortInput {
  userId: string
  parent: Pick<SessionRecord, 'id'>
  repo: Pick<ChatRepository, 'messageParent' | 'insertMessage' | 'setForkSeed'>
  modelContext: ModelContextRepository
  live: () => ForkLiveRun | undefined
  now: () => string
  newId?: () => string
}

/**
 * The host side of `delegate` with `context: "fork"`: cut the parent's line where the call is
 * made, and carry what the child needs of it.
 *
 * Nothing of the parent's history is copied. The child reads the parent's rows up to the row
 * before the one in flight (`repository-message-branches.ts`), so they stay the parent's and the
 * provider sees the same bytes however long the parent goes on. What is the child's own is the
 * row in flight, frozen at the call (`forkSnapshotPayload`), the model context stored for it, and
 * the seed of the parent's run.
 */
export function createForkPort(input: ForkPortInput): NonNullable<TaskDelegationOptions['fork']> {
  const { userId, parent, repo, modelContext } = input
  return {
    async capture(toolCallId): Promise<ForkCapture> {
      const run = input.live()
      if (!run) throw new Error('A fork can only be made while the run is streaming')
      await run.recorded(toolCallId)
      const parentRowId = run.currentRowId()
      const snapshotMessageId = input.newId?.() ?? crypto.randomUUID()
      const captured: CapturedFork = {
        parentRowId,
        payload: forkSnapshotPayload(run.currentPayload(), toolCallId, snapshotMessageId),
        seed: run.captureSeed(),
      }
      return {
        baseMessageId: await repo.messageParent(userId, parent.id, parentRowId),
        snapshotMessageId,
        route: run.route,
        host: captured,
      }
    },

    async persist(childSessionId, capture) {
      const { parentRowId, payload, seed } = capture.host as CapturedFork
      const at = input.now()
      await repo.insertMessage({
        id: capture.snapshotMessageId,
        sessionId: childSessionId,
        userId,
        payload,
        createdAt: at,
        updatedAt: at,
      })
      // What the model was shown with that row — its runtime context and a checkpoint it took —
      // is looked up under the row's own session, so the copy needs it under its own.
      const stored = (await modelContext.list(parent.id, [parentRowId])).get(parentRowId)
      const checkpoint = stored?.hasCheckpoint
        ? await modelContext.getCheckpoint(parent.id, parentRowId)
        : undefined
      if (stored?.turnContext || checkpoint) {
        await modelContext.write({
          sessionId: childSessionId,
          messageId: capture.snapshotMessageId,
          ...(stored?.turnContext ? { turnContext: stored.turnContext } : {}),
          ...(checkpoint ? { checkpoint } : {}),
          now: at,
        })
      }
      await repo.setForkSeed(userId, childSessionId, seed)
    },
  }
}
