/**
 * Group routing's first strategy: the decision model (`features/decisions` — Jev, the one measured
 * best at "who speaks next"). Available wherever a live connection serves it, so connecting
 * OpenRouter is what turns it on; nothing else configures it. The three questions and their
 * reading are pure (`floor-advice.ts`); the decision service runs them, records the spend as
 * `routing` and writes its own log record beside the floor's.
 */
import type { DecisionService } from '../../decisions/service'
import { floorDecisionRequest, readFloor } from './floor-advice'
import type { FloorStrategy } from './floor-advisor'

export function decisionFloorStrategy(
  decisions: Pick<DecisionService, 'available' | 'decide'>,
): FloorStrategy {
  return {
    async prepare(scope) {
      const available = await decisions.available(scope.userId)
      if (!available) return null
      return {
        strategy: 'decision',
        model: available.model,
        async advise(question, signal) {
          const request = floorDecisionRequest(question)
          const outcome = await decisions.decide(scope.userId, request, {
            purpose: 'routing',
            usageKind: 'routing',
            sessionId: scope.sessionId,
            signal,
          })
          // Anything but answers is the grammar's turn: the advisor records it as an error.
          if (outcome.status !== 'answered') throw new Error(`decision ${outcome.status}`)
          return readFloor({ answers: outcome.answers }, request)
        },
      }
    },
  }
}
