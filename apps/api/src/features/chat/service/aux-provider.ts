import type { Kysely } from 'kysely'
import type { LanguageModelFactory } from '@localixai/agent/runtime'

import { resolveLanguageModel } from '../runtime/model-resolution'
import type { AppDatabase } from '../../../db'
import type { AgentSettings } from '../../user/contracts'
import { readAgentSettings as readStoredAgentSettings } from './agent-settings'
import type { CatalogService } from '../../catalog/service'
import type { ProviderConnectionsService } from '../../provider-connections/service'

export function createAuxProviderHelpers(deps: {
  db: Kysely<AppDatabase>
  catalogService: CatalogService
  providerConnectionsService: ProviderConnectionsService
  languageModelFactory: LanguageModelFactory
}) {
  /**
   * Build a provider for a model by its OWNING PROVIDER, not a specific
   * connection — the agnostic resolver for the inline-AI model slots. A slot
   * stores only provider+model; at use time any live connection for that provider
   * serves it, so deleting and re-adding a provider (new connection id) keeps the
   * slot working. `preferredConnectionId` (the id we stored) is tried first as a
   * hint. Delegates to the shared `resolveLanguageModel` primitive — no
   * duplicated resolution logic.
   */
  const buildLanguageModel = async (
    userId: string,
    modelId: string,
    preferredConnectionId?: string | null,
    identity?: { providerId: string },
  ): Promise<{
    model: ReturnType<LanguageModelFactory['create']>
    providerConnectionId: string
    providerId: string
  } | null> => {
    const resolved = await resolveLanguageModel({
      deps,
      userId,
      modelId,
      preferredConnectionId,
      providerId: identity?.providerId,
    })
    return resolved?.model
      ? {
          model: resolved.model,
          providerConnectionId: resolved.providerConnectionId,
          providerId: resolved.entry.id,
        }
      : null
  }

  /** Full canonical routing state for every non-session model workload. */
  const readAgentSettings = (userId: string): Promise<AgentSettings | null> =>
    readStoredAgentSettings(deps.db, userId)

  return { buildLanguageModel, readAgentSettings }
}
