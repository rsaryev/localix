import { z } from 'zod'
import { applySwitches } from '../../capabilities/availability'
import { actionFor } from '../../capabilities/resolve'
import type { Remedy } from '../contracts'

/**
 * Availability remedies: a built-in/plugin TOOL, a PLUGIN, an MCP SERVER.
 *
 * `tool.enable` writes the rule itself (through the repository's transactional `mutate` and
 * the same `applySwitches` the Settings screen's switch produces) rather than through the
 * capability apply path, for one reason: PROVENANCE. The row an approved proposal writes
 * carries `origin`, and the apply path has no slot for that — it is the user's own click.
 * Plugins and MCP servers have consequences their owning services must run (host re-wire,
 * cache invalidation), so they go through the apply service and their provenance lives only
 * in the proposals table.
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

const pluginEnableSchema = z.object({
  kind: z.literal('plugin.enable'),
  name: z.string().min(1),
  // `.optional()`, never `.default()`: zod's default lands as REQUIRED in the JSON schema the
  // model must satisfy, so a "defaulted" field silently became mandatory. The default is applied
  // where the value is read instead.
  enabled: z.boolean().optional(),
})

export const pluginEnableRemedy: Remedy<z.infer<typeof pluginEnableSchema>> = {
  id: 'plugin.enable',
  schema: pluginEnableSchema,
  async describe(ctx, change) {
    const on = switchedOn(change)
    return {
      key: `plugin.enable:${change.name}`,
      remedyId: 'plugin.enable',
      title: `${on ? 'Enable' : 'Disable'} the ${change.name} plugin`,
      detail: `Switches the plugin and every tool it contributes ${on ? 'on' : 'off'}.`,
      diff: [`${change.name} → ${on ? 'on' : 'off'}`],
      agentId: ctx.agentId,
      reload: 'next-run',
    }
  },
  async apply(ctx, change) {
    const on = switchedOn(change)
    await ctx.ports.capabilities.apply(ctx.userId, {
      agentId: ctx.agentId,
      changes: [
        { action: actionFor('plugin', change.name), resource: '*', effect: on ? 'allow' : 'deny' },
      ],
    })
    return { summary: `Plugin "${change.name}" is now ${on ? 'enabled' : 'disabled'}.` }
  },
}

const miniAppEnableSchema = z.object({
  kind: z.literal('mini-app.enable'),
  name: z.string().min(1),
  // `.optional()`, never `.default()` (see `pluginEnableSchema`).
  enabled: z.boolean().optional(),
})

export const miniAppEnableRemedy: Remedy<z.infer<typeof miniAppEnableSchema>> = {
  id: 'mini-app.enable',
  schema: miniAppEnableSchema,
  async describe(ctx, change) {
    const on = switchedOn(change)
    return {
      key: `mini-app.enable:${change.name}`,
      remedyId: 'mini-app.enable',
      title: `${on ? 'Enable' : 'Disable'} the ${change.name} mini app`,
      detail: `Switches the mini app, its screens and every tool its backend gives ${on ? 'on' : 'off'}.`,
      diff: [`${change.name} → ${on ? 'on' : 'off'}`],
      agentId: ctx.agentId,
      reload: 'next-run',
    }
  },
  async apply(ctx, change) {
    const on = switchedOn(change)
    await ctx.ports.capabilities.apply(ctx.userId, {
      agentId: ctx.agentId,
      changes: [
        {
          action: actionFor('mini-app', change.name),
          resource: '*',
          effect: on ? 'allow' : 'deny',
        },
      ],
    })
    return { summary: `Mini app "${change.name}" is now ${on ? 'enabled' : 'disabled'}.` }
  },
}

const mcpServerEnableSchema = z.object({
  kind: z.literal('mcp.server.enable'),
  // The NAME, not the row id: capability rules address every kind by name, and the name is
  // what `inspect` shows the model. An id here meant one kind spoke a different language.
  name: z.string().min(1).describe('As listed by inspect.'),
  // `.optional()`, never `.default()`: zod's default lands as REQUIRED in the JSON schema the
  // model must satisfy, so a "defaulted" field silently became mandatory. The default is applied
  // where the value is read instead.
  enabled: z.boolean().optional(),
})

export const mcpServerEnableRemedy: Remedy<z.infer<typeof mcpServerEnableSchema>> = {
  id: 'mcp.server.enable',
  schema: mcpServerEnableSchema,
  async describe(ctx, change) {
    const on = switchedOn(change)
    return {
      key: `mcp.server.enable:${change.name}`,
      remedyId: 'mcp.server.enable',
      title: `${on ? 'Enable' : 'Disable'} MCP server ${change.name}`,
      detail: `Its tools ${on ? 'join' : 'leave'} the run's deferred catalog.`,
      diff: [`${change.name} → ${on ? 'on' : 'off'}`],
      agentId: ctx.agentId,
      reload: 'next-run',
    }
  },
  async apply(ctx, change) {
    const on = switchedOn(change)
    await ctx.ports.capabilities.apply(ctx.userId, {
      agentId: ctx.agentId,
      changes: [
        { action: actionFor('mcp', change.name), resource: '*', effect: on ? 'allow' : 'deny' },
      ],
    })
    return { summary: `MCP server "${change.name}" is now ${on ? 'enabled' : 'disabled'}.` }
  },
}
