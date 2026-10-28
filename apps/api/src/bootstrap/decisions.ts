/**
 * Composition of decisions: the decision service over the listed models (`decisions/models.ts`),
 * each reached through the user's provider connections, the usage ledger and the API log. Needs only infra, so it is built beside semantic search and handed to
 * every consumer — chat and mini app hosts (`host.decisions`).
 */
import type { Kysely } from 'kysely'
import type { AppDatabase } from '../db/types'
import { resolveLanguageModel } from '../features/chat/runtime/model-resolution'
import { recordAuxCallUsage } from '../features/chat/runtime/usage-normalize'
import { DECISION_MODELS, type DecisionBackend } from '../features/decisions/models'
import { createDecisionService } from '../features/decisions/service'
import { createUsageRepository } from '../features/usage/repository'
import type { RunnerDeps } from '../features/chat/runtime/agent-runner-types'
import type { createLogger } from '../lib/logger'

export function buildDecisionService(
  deps: Pick<
    RunnerDeps,
    'providerConnectionsService' | 'catalogService' | 'languageModelFactory'
  > & {
    db: Kysely<AppDatabase>
    logger: ReturnType<typeof createLogger>
    /** Test seam. */
    usageRepo?: Pick<ReturnType<typeof createUsageRepository>, 'accumulateEvent'>
  },
) {
  const usageRepo = deps.usageRepo ?? createUsageRepository(deps.db)
  // One backend per listed model, each reached through the user's provider connections.
  const backends: DecisionBackend[] = DECISION_MODELS.map((model) => ({
    model,
    async resolve(userId) {
      // Decision models live in the full catalog only, and are looked up among their own kind: a
      // decision model may share its id with a chat model of the same provider (OpenAI's).
      const full = await deps.catalogService.getFullCatalog()
      const resolved = await resolveLanguageModel({
        deps,
        userId,
        modelId: model,
        catalog: { ...full, models: full.models.filter((entry) => entry.kind === 'decision') },
      })
      const decide = resolved?.model.decide?.bind(resolved.model)
      if (!resolved || !decide) return null
      return {
        decide,
        providerConnectionId: resolved.providerConnectionId,
        providerId: resolved.entry.id,
      }
    },
  }))
  return createDecisionService({
    backends,
    recordUsage: (entry) =>
      recordAuxCallUsage({
        usageRepo,
        userId: entry.userId,
        sessionId: entry.sessionId,
        modelId: entry.model,
        providerConnectionId: entry.providerConnectionId,
        providerId: entry.providerId,
        kind: entry.kind,
        usage: entry.usage,
      }),
    log: (record) => deps.logger.info({ event: 'decision', ...record }),
  })
}
