/**
 * The models Localix keeps on this computer (`REQUIRED_MODELS`): what makes them so, apart from
 * the service that stores them. Wanted always, by local models itself — no consumer owns their
 * download — and never dropped: a person can neither cancel their download nor remove them.
 */
import { ApiError } from '../../lib/errors'
import type { LocalModelSpec } from './contracts'

export function requiredModels(models: readonly LocalModelSpec[]) {
  const isRequired = (modelId: string) => models.some((spec) => spec.id === modelId)
  return {
    models,
    /** The flag, also on a manifest written before it existed. */
    mark: (spec: LocalModelSpec): LocalModelSpec =>
      isRequired(spec.id) ? { ...spec, required: true } : spec,
    /** Refuse to cancel or remove a kept model. */
    keep(modelId: string) {
      if (isRequired(modelId))
        throw new ApiError(409, 'model_required', 'Localix keeps this model on this computer')
    },
  }
}
