/**
 * Embedding models in the one model catalog: what semantic search can be set to, listed beside
 * chat models with `kind: 'embedding'`, so the picker shows them in the same provider and model
 * columns. Ids follow the catalog's convention: `local/<id>` on this computer, `<provider>/<model>`
 * for a provider's (the choice id already is).
 */
import type { CatalogModel } from '@localixai/agent/catalog'
import type { CatalogModelSource } from '../catalog/service'
import { LOCAL_PROVIDER_ID } from './choices'
import type { EmbeddingChoice } from './contracts'

/** The catalog namespace of models on this computer (`local/<id>`). */
const LOCAL_PREFIX = LOCAL_PROVIDER_ID.concat('/')

export const catalogIdOf = (choice: Pick<EmbeddingChoice, 'id' | 'providerId'>) =>
  choice.providerId === LOCAL_PROVIDER_ID ? LOCAL_PREFIX.concat(choice.id) : choice.id

/** The semantic-search model id a catalog id names. */
export const choiceIdOf = (catalogId: string) =>
  catalogId.startsWith(LOCAL_PREFIX) ? catalogId.slice(LOCAL_PREFIX.length) : catalogId

export function toCatalogModel(choice: EmbeddingChoice): CatalogModel {
  return {
    id: catalogIdOf(choice),
    name: choice.label,
    kind: 'embedding',
    providerId: choice.providerId,
    providerName: choice.providerId,
    ...(choice.releasedAt ? { releaseDate: choice.releasedAt } : {}),
    supportsTools: false,
    supportsReasoning: false,
    supportsAttachment: false,
    inputModalities: ['text'],
    outputModalities: ['embedding'],
    family: choice.attribution,
    embedding: { dimensions: choice.dimensions, storedDimensions: choice.indexDimensions },
  }
}

/** The catalog source: the owner's choices (their connections decide the cloud ones). */
export function embeddingCatalogSource(
  list: () => Promise<readonly EmbeddingChoice[]>,
): CatalogModelSource {
  return { id: 'embeddings', list: async () => (await list()).map(toCatalogModel) }
}
