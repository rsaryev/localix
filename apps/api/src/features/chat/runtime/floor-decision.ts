/**
 * Group routing's first strategy: a decision model through OpenRouter — Jev, the one measured best
 * at "who speaks next". Available wherever a live connection serves it, so connecting OpenRouter is
 * what turns it on; nothing else configures it. The three questions and their reading are pure
 * (`floor-advice.ts`); this runs them and records the spend as `routing`.
 */
import type { UsageRepository } from '../../usage/repository'
import type { RunnerDeps } from './agent-runner-types'
import { floorDecisionRequest, readFloor } from './floor-advice'
import type { FloorStrategy } from './floor-advisor'
import { resolveLanguageModel } from './model-resolution'
import { recordAuxCallUsage } from './usage-normalize'

export const FLOOR_DECISION_MODEL = 'openrouter/~typesafe/jev-latest'

export function decisionFloorStrategy(deps: {
  runner: Pick<RunnerDeps, 'providerConnectionsService' | 'catalogService' | 'languageModelFactory'>
  usageRepo: UsageRepository
}): FloorStrategy {
  return {
    async prepare(scope) {
      // Decision models live in the full catalog only, and are looked up among their own kind: a
      // decision model may share its id with a chat model of the same provider (OpenAI's).
      const full = await deps.runner.catalogService.getFullCatalog()
      const resolved = await resolveLanguageModel({
        deps: deps.runner,
        userId: scope.userId,
        modelId: FLOOR_DECISION_MODEL,
        catalog: { ...full, models: full.models.filter((model) => model.kind === 'decision') },
      })
      const decide = resolved?.model.decide?.bind(resolved.model)
      if (!resolved || !decide) return null
      return {
        strategy: 'decision',
        model: FLOOR_DECISION_MODEL,
        async advise(question, signal) {
          const request = floorDecisionRequest(question)
          const result = await decide({ ...request, signal })
          recordAuxCallUsage({
            usageRepo: deps.usageRepo,
            userId: scope.userId,
            sessionId: scope.sessionId,
            modelId: FLOOR_DECISION_MODEL,
            providerConnectionId: resolved.providerConnectionId,
            providerId: resolved.entry.id,
            kind: 'routing',
            usage: result.usage,
          })
          return readFloor(result, request)
        },
      }
    },
  }
}
