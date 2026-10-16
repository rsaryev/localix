import { z } from 'zod'

/** Install state of the `localix` shell command (see plan.ts / service.ts). */
export const shellCommandStatusSchema = z.object({
  state: z.enum(['installed', 'stale', 'not-installed']),
  targetPath: z.string(),
  binDir: z.string(),
  onPath: z.boolean(),
  available: z.boolean(),
})

export type ShellCommandStatusDto = z.infer<typeof shellCommandStatusSchema>
