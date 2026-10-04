import { z } from 'zod'

/** Safe root-relative prefix. This shared leaf intentionally imports neither user
 * nor project contracts, avoiding a settings-schema dependency cycle. */
export const contextExclusionPathSchema = z
  .string()
  .min(1)
  .max(240)
  .refine(
    (value) => !value.startsWith('/') && !value.includes('\\') && !value.split('/').includes('..'),
    'must be a safe relative path',
  )
