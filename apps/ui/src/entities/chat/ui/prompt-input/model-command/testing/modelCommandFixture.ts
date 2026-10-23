import type { CatalogModel } from '@localixai/agent/catalog'
import type { ParticipantRow } from '../../model-select/ModelTaskColumn'
import type { ModelCommandContext } from '../modelCommandTarget'

const model = (id: string, extra: Partial<CatalogModel> = {}): CatalogModel =>
  ({
    id,
    name: id.split('/')[1]!.toUpperCase(),
    providerId: id.split('/')[0]!,
    providerName: id.split('/')[0]!,
    supportsTools: true,
    supportsReasoning: true,
    inputModalities: ['text'],
    ...extra,
  }) as CatalogModel

/**
 * Two connections, a reasoner without Off, one with it, and one that does not reason. Windows:
 * 200k (Auto is the whole window), 1M (offers context-limit steps), none.
 */
export const MODELS = [
  model('anthropic/opus', {
    reasoningEfforts: ['low', 'medium', 'high', 'max'],
    contextLength: 200_000,
  }),
  model('openai/gpt', {
    reasoningEfforts: ['off', 'minimal', 'low', 'medium', 'high'],
    contextLength: 1_000_000,
  }),
  model('openai/plain', { supportsReasoning: false, reasoningEfforts: [] }),
]

export const CONNECTIONS = [
  { id: 'conn-anthropic', providerId: 'anthropic', label: 'Anthropic' },
  { id: 'conn-openai', providerId: 'openai', label: 'OpenAI' },
]

export const member = (
  handle: string,
  modelId: string,
  reasoningEffort: ParticipantRow['route'] extends infer R
    ? R extends { reasoningEffort?: infer E }
      ? E
      : never
    : never = 'medium',
  extra: Partial<ParticipantRow> = {},
): ParticipantRow => ({
  agentId: `id-${handle}`,
  handle,
  route: {
    providerConnectionId: modelId.startsWith('openai') ? 'conn-openai' : 'conn-anthropic',
    modelId,
    reasoningEffort,
  },
  ...extra,
})

export function context(
  participants: ParticipantRow[],
  extra: Partial<ModelCommandContext> = {},
): ModelCommandContext {
  return {
    participants,
    connections: CONNECTIONS,
    models: MODELS,
    sessionConnectionId: null,
    ...extra,
  }
}
