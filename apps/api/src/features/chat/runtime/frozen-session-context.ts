import { z } from 'zod'

/** Persisted prompt inputs: validate on read so corruption cannot silently change a prefix. */
export const frozenSessionContextSchema = z.object({
  memoryContext: z.string().optional(),
  memoryUsage: z.object({ chars: z.number(), limit: z.number(), pct: z.number() }).optional(),
  skillsContext: z.string().optional(),
  projectInstructions: z.string().optional(),
  skillOverridesRevision: z.string().optional(),
  memoryScopesRevision: z.string().optional(),
})

export type FrozenSessionContext = z.infer<typeof frozenSessionContextSchema>
