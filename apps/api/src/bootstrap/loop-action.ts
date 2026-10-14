/**
 * The loop trigger action, wired to chat: a session-target fire is a wake the loop WAITS on (its
 * outcome is the fire's), a subsession fire is a fresh child session run to completion.
 *
 * Unlike every other trigger action, a loop's fire does not go through the one-way delivery
 * (`features/triggers/delivery`): a loop IS the turn, so its fire settles on the run's outcome
 * (`wakeSessionAndWait`), not on the wake being admitted.
 */
import { errorMessage } from '../lib/errors'
import { agentParticipant } from '../db/participant'
import { createChatRepository } from '../features/chat/repository'
import type { createChatService } from '../features/chat/service'
import { agentRoute, sessionRoute } from '../features/chat/session-route'
import { createLoopAction } from '../features/loops/action'
import type { LoopFireOutcome } from '../features/loops/contracts'
import { createSubsessionRunner } from '../features/loops/subsession-runner'
import type { InfraPhase } from './infra'

export interface LoopActionInput extends Pick<InfraPhase, 'db' | 'logger'> {
  chatService: ReturnType<typeof createChatService>
  finalAssistantText: InfraPhase['digests']['finalAssistantText']
}

export function buildLoopAction({ db, logger, chatService, finalAssistantText }: LoopActionInput) {
  const runSubsession = createSubsessionRunner({
    getParentSession: async (userId, sessionId, agentId) => {
      // Repo-level read rather than the public SessionDetail: the runner needs the
      // provider/model/project a child should inherit, which that view does not carry.
      const s = await createChatRepository(db)
        .getSession(userId, sessionId)
        .catch(() => null)
      if (!s) return null
      const route = agentId ? agentRoute(s, agentId) : sessionRoute(s)
      if (!route) return null
      return {
        providerConnectionId: route.providerConnectionId ?? null,
        modelId: route.modelId ?? null,
        projectId: s.projectId,
      }
    },
    createSession: (...args) => chatService.createSession(...args),
    runJobTask: async (...args) => chatService.runJobTask(...args),
    childRuntimeStatus: async (...args) =>
      (await createChatRepository(db).getSessionRuntime(...args))?.runtimeStatus ?? null,
    // The round's handoff to the next one is its final reply.
    childFinalText: finalAssistantText,
    logger: { warn: (msg) => logger.warn({ event: 'loop.subsession_warn', msg }) },
  })

  return createLoopAction({
    isSessionBusy: chatService.isBusy,
    rateLimitedUntilMs: (...args) => chatService.rateLimitedUntilMs(...args),
    runSubsession,
    wakeSession: (loop, wake): Promise<LoopFireOutcome> =>
      chatService
        .wakeSessionAndWait({
          userId: loop.userId,
          sessionId: loop.sessionId,
          content: wake.content,
          source: 'loop',
          deliveryKey: wake.deliveryKey,
          ...(wake.extraDisabledTools.length
            ? { extraDisabledTools: wake.extraDisabledTools }
            : {}),
          // The participant that armed it answers; if it has left, the conversation chooses.
          ...(loop.ownerAgentId
            ? { to: { participant: agentParticipant(loop.ownerAgentId) } }
            : {}),
        })
        .then((outcome): LoopFireOutcome => {
          if (outcome.status === 'failed') return { ok: false, error: outcome.message }
          if (outcome.status === 'delegated')
            return { ok: false, skipped: true, error: outcome.message }
          return { ok: true }
        })
        .catch((err: unknown): LoopFireOutcome => {
          logger.warn({ event: 'loop.wake_failed', loopId: loop.id, err: errorMessage(err) })
          return { ok: false, error: errorMessage(err) }
        }),
  })
}
