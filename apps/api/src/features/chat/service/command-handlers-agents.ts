import { localixUiUri } from '@localixai/mini-app-sdk/navigation'
import type { AgentSummary } from '../../agents/contracts'
import type { SessionRecord } from '../repository'
import type { CommandHandlerContext, DirectReply } from './command-handlers-context'

const SHELF = localixUiUri('work-item', ['store', 'agents'])

const HELP = [
  '**Agents** — Claude Code agent files, managed in the Store.',
  '',
  `[Open the Agents shelf](${SHELF}) to add, edit, copy, enable or remove one.`,
  '`/agents list` — the agents this registry holds, by name.',
  '',
  'A conversation has one agent, chosen when it is created; parallel work goes to subagents.',
].join('\n')

function describe(agent: AgentSummary, current: string | undefined): string {
  const link = localixUiUri('work-item', ['store'], { kind: 'agent', id: agent.record.id })
  const state = agent.enabled ? 'available' : 'disabled'
  return `- [${agent.record.name}](${link}) · ${state}${current === agent.record.id ? ' · this chat' : ''} — ${agent.record.description || 'No description'}`
}

/** `/agents` lists agents by name and points at the Store, where they are managed. */
export async function handleAgentsControlCommand(
  ctx: CommandHandlerContext,
  userId: string,
  session: SessionRecord,
  prompt: string,
  directReply: DirectReply,
) {
  const service = ctx.deps.agentManagement
  if (!service) return directReply('Agent management is unavailable on this host.')
  const action =
    prompt
      .replace(/^\s*\/agents\b/, '')
      .trim()
      .split(/\s+/)[0] ?? ''
  if (action !== 'list') return directReply(HELP)
  const all = await service.listAgents(userId, { projectId: session.projectId })
  const lines = all.map((agent) => describe(agent, session.agent?.agentId))
  return directReply(
    [
      `**Agent registry (${session.projectId ? 'project' : 'global'})**`,
      '',
      ...lines,
      ...(!lines.length ? ['No agents found.'] : []),
    ].join('\n'),
  )
}
