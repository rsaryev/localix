import { z } from 'zod'
import { REASONING_EFFORTS } from '../../db/types'
import { modelIdSchema } from '../catalog/model-identity'

/** One entry per agent: the model and effort the person chose for it (`agentSettings`). */
export const agentModelChoicesSchema = z
  .array(
    z
      .object({
        agentId: z.string().min(1).max(200),
        providerConnectionId: z.string().min(1).max(200).nullable().optional(),
        modelId: modelIdSchema.optional(),
        effort: z.enum(REASONING_EFFORTS).optional(),
      })
      .strict()
      .refine((choice) => choice.modelId !== undefined || choice.effort !== undefined, {
        message: 'A choice names a model, an effort or both',
      }),
  )
  .max(200)
  .superRefine((choices, ctx) => {
    const seen = new Set<string>()
    choices.forEach((choice, index) => {
      if (seen.has(choice.agentId))
        ctx.addIssue({ code: 'custom', path: [index], message: 'One choice per agent' })
      seen.add(choice.agentId)
    })
  })
