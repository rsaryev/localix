import { z } from 'zod'
import { REASONING_EFFORTS } from '../../db/types'
import { MODEL_ROUTING_TASKS, type ModelRoutingTaskKey } from '../../contracts/model-task-catalog'
import { modelIdSchema, providerConnectionIdSchema } from '../catalog/model-identity'

const modelRoutingTaskKeys = MODEL_ROUTING_TASKS.map((task) => task.key) as [
  ModelRoutingTaskKey,
  ...ModelRoutingTaskKey[],
]
const modelRoutingTaskKeySchema = z.enum(modelRoutingTaskKeys)
const modelReasoningPreferenceSchema = z.object({
  providerId: z.string().min(1),
  modelId: modelIdSchema,
  effort: z.enum(REASONING_EFFORTS),
})
const modelReasoningPreferencesSchema = z
  .array(modelReasoningPreferenceSchema)
  .max(50)
  .superRefine((preferences, ctx) => {
    const pairs = new Set<string>()
    for (const [index, preference] of preferences.entries()) {
      const pair = `${preference.providerId}\u0000${preference.modelId}`
      if (pairs.has(pair)) {
        ctx.addIssue({
          code: 'custom',
          path: [index],
          message: 'reasoning preference provider/model pairs must be unique',
        })
      }
      pairs.add(pair)
    }
  })
const modelRouteSchema = z
  .object({
    enabled: z.boolean().optional(),
    providerConnectionId: providerConnectionIdSchema.optional(),
    modelId: modelIdSchema.optional(),
    reasoningEffort: z.enum(REASONING_EFFORTS).optional(),
    /** Per-workload memory keyed by the durable provider/model pair. */
    reasoningPreferences: modelReasoningPreferencesSchema.optional(),
  })
  .superRefine((route, ctx) => {
    const hasProvider = route.providerConnectionId !== undefined
    const hasModel = route.modelId !== undefined
    if (hasProvider !== hasModel) {
      ctx.addIssue({
        code: 'custom',
        message: 'providerConnectionId and modelId must be set together',
      })
    }
    if (route.reasoningEffort !== undefined && !hasModel) {
      ctx.addIssue({
        code: 'custom',
        message: 'reasoningEffort requires a provider/model assignment',
      })
    }
  })
export const modelRoutingSchema = z.partialRecord(modelRoutingTaskKeySchema, modelRouteSchema)
