import { z } from 'zod'
import { agentBlueprintSchema } from '@localixai/agent/agents'
import { capabilityRuleSchema } from '../capabilities/rule-schema'

/** Import proposals carry no identity or installation scope and grant no authority by themselves. */
export const agentContributionSchema = z.strictObject({
  definition: agentBlueprintSchema,
  policyProposals: z.array(capabilityRuleSchema).max(500),
})
export type AgentContribution = z.infer<typeof agentContributionSchema>
