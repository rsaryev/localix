import { z } from 'zod'

/** Source-local declaration. Registry identity and authority are assigned outside the payload. */
export const contributionInputSchema = z.strictObject({
  kind: z.string().min(1).max(100),
  key: z.string().min(1).max(200),
  value: z.unknown(),
})
export type ContributionInput = z.infer<typeof contributionInputSchema>
