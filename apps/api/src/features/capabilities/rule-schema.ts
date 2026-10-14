import { z } from 'zod'

/** Shared boundary for native permission rules, independent of catalogs and wire responses. */
export const capabilityRuleSchema = z.strictObject({
  action: z.string().min(1).max(200),
  resource: z.string().min(1).max(400).default('*'),
  effect: z.enum(['allow', 'ask', 'deny']),
  message: z.string().max(400).optional(),
  origin: z
    .strictObject({
      kind: z.literal('agent-proposal'),
      sessionId: z.string().min(1),
      proposalId: z.string().min(1),
      at: z.string().min(1),
    })
    .optional(),
})
