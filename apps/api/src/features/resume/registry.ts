/**
 * THE ONE PLACE "CONTINUE" HAPPENS — every producer's points, and what picking one does.
 *
 * Producers only say what is unfinished and what the agent should be told (`contracts.ts`); the
 * steps that must be identical for every kind live here once:
 *
 *   validate the key → ask its producer → (gone: 409 with the current list) → say it in the
 *   conversation → wake the conversation → answer the current list.
 *
 * A point that no longer holds — finished, set aside, continued from another window — is a 409
 * that CARRIES the current list, so the client replaces what it shows instead of keeping a
 * Continue that cannot work (the shape the plan decisions already use).
 */
import { ApiError } from '../../lib/errors'
import type { StoredSystemNotice } from '../../db/payload'
import type { WakeRequest } from '../chat/contracts'
import type { WakeOutcome } from '../triggers/delivery'
import { resumeKindOf, type ResumeOwner, type ResumePoint, type ResumeProducer } from './contracts'

export class ResumeConflictError extends ApiError {
  readonly points: ResumePoint[]

  constructor(points: ResumePoint[]) {
    super(409, 'resume_point_gone', 'This work is no longer waiting to be continued')
    this.name = 'ResumeConflictError'
    this.points = points
  }
}

export const isResumeConflict = (error: unknown): error is ResumeConflictError =>
  error instanceof ResumeConflictError

export interface ResumeRegistryDeps {
  /** Read at call time: producers are features composed after the registry exists. */
  producers: () => readonly ResumeProducer[]
  wake: (request: WakeRequest) => Promise<WakeOutcome>
  notice: (owner: ResumeOwner, notice: StoredSystemNotice) => Promise<void>
  /** The owner's points changed: push them (`session_resume.updated`). */
  publish: (owner: ResumeOwner, points: ResumePoint[]) => void
}

export interface ResumeAnswer {
  wake: WakeOutcome['status']
  points: ResumePoint[]
}

export function createResumeRegistry(deps: ResumeRegistryDeps) {
  /** Every producer's points; one failing producer hides only its own. */
  async function list(owner: ResumeOwner): Promise<ResumePoint[]> {
    const lists = await Promise.all(
      deps.producers().map((producer) => producer.list(owner).catch(() => [])),
    )
    return lists.flat()
  }

  return {
    list,

    /** A producer's work changed for this owner: push the whole list to its composers. */
    async changed(owner: ResumeOwner): Promise<void> {
      deps.publish(owner, await list(owner))
    },

    async resume(owner: ResumeOwner, key: string): Promise<ResumeAnswer> {
      const kind = resumeKindOf(key)
      const producer = deps.producers().find((candidate) => candidate.kind === kind)
      if (!producer) throw new ApiError(400, 'unknown_resume_kind', `Nothing can continue ${key}`)
      const action = await producer.take(owner, key)
      if (!action) throw new ResumeConflictError(await list(owner))
      await deps.notice(owner, action.notice).catch(() => undefined)
      const outcome = await deps.wake({
        userId: owner.userId,
        sessionId: owner.sessionId,
        content: action.content,
        source: 'resume',
        // One wake per point while it waits in the queue: a double click is the same request.
        // No receipt — after that wake ran, a later Continue (after another stop) is a new one.
        deliveryKey: `resume:${key}`,
      })
      return { wake: outcome.status, points: await list(owner) }
    },
  }
}

export type ResumeRegistry = ReturnType<typeof createResumeRegistry>
