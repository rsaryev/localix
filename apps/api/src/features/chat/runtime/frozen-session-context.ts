import { z } from 'zod'

/** Persisted prompt inputs: validate on read so corruption cannot silently change a prefix. */
export const frozenSessionContextSchema = z.object({
  /** The run's auto memory folder (`features/memory/auto-memory.ts`); absent when it keeps none. */
  memoryDir: z.string().optional(),
  /** Its MEMORY.md as loaded, or what a mini app's memory provider put in its place. */
  memoryContext: z.string().optional(),
  memoryClipped: z.boolean().optional(),
  skillsContext: z.string().optional(),
  projectInstructions: z.string().optional(),
  skillOverridesRevision: z.string().optional(),
})

export type FrozenSessionContext = z.infer<typeof frozenSessionContextSchema>
