import { z } from 'zod'
import { applySwitches } from '../../capabilities/availability'
import type { Remedy } from '../contracts'

/**
 * The availability remedy: a built-in or plugin TOOL.
 *
 * `tool.enable` writes the rule itself (through the repository's transactional `mutate` and
 * the same `applySwitches` the Settings screen's switch produces), so the row an approved
 * proposal writes carries `origin`. Plugins, mini apps and MCP servers are the Store's: the
 * agent switches them with `store`, where the person sees what each one runs.
 */

/**
 * No `scope` field, in any of these.
 *
 * A remedy used to ask WHERE the switch should land — the session's project, `global`, or the
 * scope the ledger's denial named — and the card offered the choice. There is one list now,
 * the proposing agent's, so the question has no second answer to offer. It also removes a
 * class of proposal that read as reasonable and was not: a model asking for an
 * installation-wide grant because its own role denied it something.
 */
const toolEnableSchema = z.object({
  kind: z.literal('tool.enable'),
  name: z.string().min(1).describe('Tool name as listed in "# Unavailable tools".'),
  // `.optional()`, never `.default()`: zod's default lands as REQUIRED in the JSON schema the
  // model must satisfy, so a "defaulted" field silently became mandatory. The default is applied
  // where the value is read instead.
  enabled: z.boolean().optional(),
})

/** The default for an omitted `enabled`, applied on READ — see the schema comment. */
const switchedOn = (change: { enabled?: boolean }): boolean => change.enabled ?? true

export const toolEnableRemedy: Remedy<z.infer<typeof toolEnableSchema>> = {
  id: 'tool.enable',
  schema: toolEnableSchema,
  async describe(ctx, change) {
    const on = switchedOn(change)
    return {
      key: `tool.enable:${change.name}`,
      remedyId: 'tool.enable',
      // No rule syntax and no `+`/`-` marker. A disable proposal rendered as `- tool:x · deny`
      // reads as REMOVING a denial, which is the opposite of what it does; the subject and its
      // new state say it once, in the direction a person reads.
      title: `${on ? 'Enable' : 'Disable'} the ${change.name} tool`,
      detail: on
        ? "Adds the tool to this agent's roster."
        : "Removes the tool from this agent's roster.",
      diff: [`${change.name} → ${on ? 'on' : 'off'}`],
      agentId: ctx.agentId,
      reload: 'next-run',
    }
  },
  async apply(ctx, change) {
    const on = switchedOn(change)
    const origin = ctx.origin()
    await ctx.ports.rules.mutate(ctx.userId, ctx.agentId, (rules) =>
      applySwitches(rules, 'tool', [{ name: change.name, enabled: on }]).map((rule) =>
        rule.action === `tool:${change.name}` && rule.resource === '*' ? { ...rule, origin } : rule,
      ),
    )
    ctx.ports.bumpCapabilityRevision()
    return { summary: `${change.name} is now ${on ? 'enabled' : 'disabled'} for this agent.` }
  },
}
