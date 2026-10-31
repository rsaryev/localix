import type { InspectTarget } from '../agent-core/tools/configure/configure-contracts'
import {
  describeWithholdReason,
  remediableWithholds,
  type ToolLedger,
} from '../agent-core/tool-ledger'
import { MODEL_ROUTING_TASKS, isModelRoutingTaskEnabled } from '../../contracts/model-task-catalog'
import type { RemedyContext } from './contracts'

/**
 * `configure action:"inspect"` — the run's configuration, in the ledger's own words.
 *
 * Reads the LEDGER for tools (never the rule store: one resolve per run is the invariant),
 * the agents catalog for roles, and the user's routing settings. A withheld TOOL ends in the
 * change kind that would restore it, because that is the one thing the agent may ask for; the
 * roster and the routes are context, and say where a person edits them.
 */
export async function renderInspection(
  ctx: RemedyContext,
  target: InspectTarget,
  ledger: ToolLedger | undefined,
): Promise<string> {
  switch (target.kind) {
    case 'tool':
      return renderTool(target.name, ledger)
    case 'agent':
      return renderAgent(ctx, target.name)
    case 'setting':
      return renderSetting(ctx, target.name)
    case 'summary':
      return [
        await renderWithheld(ledger),
        await renderRoster(ctx),
        await renderSetting(ctx, 'modelRouting'),
      ].join('\n\n')
  }
}

/** A tool asked for by its name. */
function renderTool(asked: string, ledger: ToolLedger | undefined): string {
  const name = asked
  const verdict = ledger?.get(name)
  if (!verdict) return `\`${asked}\` is not a tool this installation knows.`
  if (verdict.state === 'live') return `\`${name}\` is available in this run.`
  if (verdict.state === 'deferred')
    return `\`${name}\` is available behind \`ToolSearch\` (source: ${verdict.source}).`
  const remedy = verdict.remedy
    ? ` Remedy: propose {kind:"${verdict.remedy.remedyId}", name:"${verdict.remedy.target}"}.`
    : ' No remedy: this cannot be changed from a conversation.'
  return `\`${name}\` is unavailable — ${describeWithholdReason(verdict.reason)}.${remedy}`
}

async function renderWithheld(ledger: ToolLedger | undefined): Promise<string> {
  const rows = ledger ? remediableWithholds(ledger) : []
  if (rows.length === 0) return 'Unavailable tools: none that a configuration change could restore.'
  return [
    'Unavailable tools (remediable):',
    ...rows.map(
      (row) =>
        `- ${row.name} — ${describeWithholdReason(row.reason)} → {kind:"${row.remedy.remedyId}", name:"${row.remedy.target}"}`,
    ),
  ].join('\n')
}

async function renderRoster(ctx: RemedyContext): Promise<string> {
  const agents = await ctx.ports.agents.listAgents(ctx.userId, { projectId: ctx.projectId })
  if (agents.length === 0) return 'Agents: none.'
  return [
    'Agents (name · enabled · hosts allowed):',
    ...agents.map((agent) => {
      const hosts = Object.entries(agent.invocations)
        .filter(([, effect]) => effect === 'allow')
        .map(([host]) => host)
      return `- @${agent.record.name} · ${agent.enabled ? 'on' : 'off'} · ${hosts.join(', ') || 'none'}${agent.source === 'builtin' ? ' · shipped' : ''}`
    }),
    'Read-only here: agents are files; edit them on their Store page.',
  ].join('\n')
}

async function renderAgent(ctx: RemedyContext, name: string): Promise<string> {
  const agent = await ctx.ports.agents.getAgent(ctx.userId, name, ctx.projectId)
  if (!agent) return `No agent named "${name}" in this scope.`
  const snapshot = await ctx.ports.rules.readSnapshot(ctx.userId, `agent:${agent.record.id}`)
  const tools = snapshot.rules
    .filter(
      (rule) => rule.action.startsWith('tool:') && rule.resource === '*' && rule.effect === 'allow',
    )
    .map((rule) => rule.action.slice('tool:'.length))
  const hosts = Object.entries(agent.invocations).map(([host, effect]) => `${host}=${effect}`)
  return [
    `@${agent.record.name} (${agent.record.id})${agent.source === 'builtin' ? ' · shipped' : ''} · ${agent.enabled ? 'enabled' : 'disabled'}`,
    `description: ${agent.record.description || '—'}`,
    `maxTurns: ${agent.record.maxTurns ?? 'default'}`,
    `tools: ${tools.length ? tools.join(', ') : 'inherits the scope (no closed list)'}`,
    `hosts: ${hosts.join(', ')}`,
    `instructions: ${agent.record.instructions.slice(0, 300)}${agent.record.instructions.length > 300 ? '…' : ''}`,
  ].join('\n')
}

async function renderSetting(ctx: RemedyContext, name: string): Promise<string> {
  if (name !== 'modelRouting')
    return `Setting "${name}" is not inspectable here; only "modelRouting" is.`
  const settings = await ctx.ports.user.getAgentSettings(ctx.userId)
  return [
    'Model routes (task · enabled · model):',
    ...MODEL_ROUTING_TASKS.filter((task) => task.key !== 'session').map((task) => {
      const route = settings?.modelRouting?.[task.key]
      const enabled = isModelRoutingTaskEnabled(settings ?? undefined, task.key)
      return `- ${task.key} · ${enabled ? 'on' : 'off'} · ${route?.modelId ?? 'session model'}`
    }),
    'Read-only here: routes are chosen in Settings → Models.',
  ].join('\n')
}
