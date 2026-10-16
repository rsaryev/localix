import { z } from 'zod'
import { agentBlueprintSchema } from '@localixai/agent/agents'
import { capabilityRuleSchema } from '../capabilities/rule-schema'

/** Import proposals carry no identity or installation scope and grant no authority by themselves. */
export const agentContributionSchema = z.strictObject({
  // Only the shipped `human` record describes the person; an extension contributes agents.
  definition: agentBlueprintSchema.refine((definition) => definition.kind !== 'human', {
    message: 'An extension cannot contribute the human record',
  }),
  policyProposals: z.array(capabilityRuleSchema).max(500),
})
export type AgentContribution = z.infer<typeof agentContributionSchema>
