import { z } from 'zod'
import type { ProposalCard, Remedy, RemedyContext } from './contracts'
import { mcpServerEnableRemedy, pluginEnableRemedy, toolEnableRemedy } from './remedies/toggles'

/**
 * Every remedy the agent may propose, in the order the model's schema lists them. The
 * `configure` tool's `change` input is the discriminated union of their schemas — the tool
 * never spells a kind, so a new remedy is a new entry here and nothing else.
 *
 * THREE, and they answer one question: "this run does not hold X, may it". Seven others used
 * to sit here — writing an agent record, its tool list, its invocation hosts, duplicating and
 * deleting roles, choosing a model for a workload. They were a second way to author
 * configuration, reachable only by asking the model to do it, and the screen that owns each
 * of those does the job better. Authoring is the user's; asking for access is the agent's.
 */
export const REMEDIES: readonly Remedy[] = [
  toolEnableRemedy,
  pluginEnableRemedy,
  mcpServerEnableRemedy,
] as readonly Remedy[]

export interface RemedyRegistry {
  changeSchema: z.ZodType<unknown>
  describe(ctx: RemedyContext, change: unknown): Promise<ProposalCard>
  apply(ctx: RemedyContext, change: unknown): Promise<{ summary: string }>
  remedyIdOf(change: unknown): string
}

export function createRemedyRegistry(remedies: readonly Remedy[] = REMEDIES): RemedyRegistry {
  const byId = new Map(remedies.map((remedy) => [remedy.id, remedy]))
  // Each remedy's schema is a `z.object` with a literal `kind`; the union type is widened
  // here because the registry is generic over remedies it does not know at compile time.
  const schemas = remedies.map((remedy) => remedy.schema) as unknown as [
    z.ZodObject<{ kind: z.ZodLiteral<string> }>,
    ...z.ZodObject<{ kind: z.ZodLiteral<string> }>[],
  ]
  const changeSchema = z.discriminatedUnion('kind', schemas)
  const resolve = (change: unknown) => {
    const parsed = changeSchema.parse(change)
    const remedy = byId.get(parsed.kind)
    if (!remedy) throw new Error(`Unknown change kind "${parsed.kind}".`)
    return { remedy, parsed }
  }
  return {
    changeSchema,
    remedyIdOf: (change) => resolve(change).remedy.id,
    describe: (ctx, change) => {
      const { remedy, parsed } = resolve(change)
      return remedy.describe(ctx, parsed)
    },
    apply: (ctx, change) => {
      const { remedy, parsed } = resolve(change)
      return remedy.apply(ctx, parsed)
    },
  }
}
