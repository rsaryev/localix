import { z } from 'zod'
import { routeValidator } from '@localixai/mini-app-sdk/backend'
import type { RestErrorResponse } from './contracts'

/**
 * A rejected request answers in the typed `RestErrorResponse` body (`{ error, code, detail }`)
 * every other failure here uses — the SDK's validator in its `flat` envelope. A validation failure
 * never reaches the error funnel (the validator answers rather than throwing).
 */
export const validated = routeValidator({
  envelope: 'flat',
  code: 'bad_request' satisfies RestErrorResponse['code'],
})

export const pairSchema = z.object({
  name: z.string(),
  value: z.string(),
  disabled: z.boolean().optional(),
})

export const bodySchema = z
  .object({
    mimeType: z.string().optional(),
    text: z.string().optional(),
    form: pairSchema.array().optional(),
  })
  .optional()
