import { NotFoundError } from '../../../lib/domain-errors'
import { agentAuthoredBlueprintSchema, agentHandleSchema } from '@localixai/agent/agents'
import { localixUiUri } from '@localixai/mini-app-sdk/navigation'
import { errorMessage } from '../../../lib/errors'
import { agentRecordInputSchema, type AgentSummary } from '../../agents/contracts'
import { agentPolicy, canJoinConversation } from '../../agents/policy'
import type { SessionRecord } from '../repository'
import type { CommandHandlerContext, DirectReply } from './command-handlers-context'
import { parseAgentsCommand } from './agents-command-input'
import { agentCreateRequest, runAgentCreateRequest } from './command-handlers-agents-create'

const HELP = [
  '**Agents** — persistent specialists in this conversation’s registry.',
  '',
  '`/agents list` · `/agents members` · `/agents show @handle`',
  '`/agents create [handle]` — open the definition form.',
  '`/agents create <what it should do>` — have the agent draft and save a specialist.',
  '`/agents create <handle> --description "…" --instructions "…" --priority 0` — save directly.',
  '`/agents edit @handle [--handle new-name] [--description "…"] [--instructions "…"] [--priority 0]`',
  '`/agents copy @handle <new-handle>`',
  '`/agents enable @handle` · `/agents disable @handle`',
  '`/agents permissions @handle` — open the permission editor.',
  '`/agents add @handle` · `/agents remove @handle` — change this chat’s membership.',
  '`/agents delete @handle [--confirm]` — preview, then delete an unused local agent.',
  '',
  'Creation and invitations do not start work. Address a participant with @handle to give it a task. Parallel copies are managed by `fork`.',
].join('\n')

/** An agent is managed on its Store page; a new one is made on the Agents shelf's Create. */
function profileLink(agent: string): string {
  return agent
    ? localixUiUri('work-item', ['store'], { kind: 'agent', id: agent })
    : localixUiUri('work-item', ['store', 'agents'])
}

function describe(agent: AgentSummary, members: ReadonlySet<string>): string {
  const state = !agent.enabled
    ? 'disabled'
    : canJoinConversation(agent)
      ? 'available'
      : 'chat unavailable'
  return `- [@${agent.record.handle}](${profileLink(agent.record.id)}) · priority ${agent.record.leadershipPriority} · ${state}${members.has(agent.record.id) ? ' · in this chat' : ''} — ${agent.record.description || 'No description'}`
}

/** User-owned CRUD, never an agent policy-writing channel. All membership uses chat's writer. */
export async function handleAgentsControlCommand(
  ctx: CommandHandlerContext,
  userId: string,
  session: SessionRecord,
  prompt: string,
  directReply: DirectReply,
) {
  const service = ctx.deps.agentManagement
  if (!service) return directReply('Agent management is unavailable on this host.')
  try {
    const request = agentCreateRequest(prompt)
    if (request) return await runAgentCreateRequest(ctx, userId, session, prompt, request)
    const { action, args, fields, confirm } = parseAgentsCommand(prompt)
    const scope = session.projectId ?? ''
    const hasFields = Object.keys(fields).length > 0
    if (confirm && action !== 'delete') throw new Error('--confirm is only valid for delete')
    if (hasFields && action !== 'create' && action !== 'edit')
      throw new Error('Definition options are only valid for create or edit')
    if (!action || action === 'help') {
      if (args.length) throw new Error('Usage: /agents help')
      return directReply(HELP)
    }
    const members = new Set(session.agents.map((member) => member.agentId))
    if (action === 'list' || action === 'members') {
      if (args.length) throw new Error(`Usage: /agents ${action}`)
      const all = await service.listAgents(userId, { projectId: session.projectId })
      const byId = new Map(all.map((agent) => [agent.record.id, agent]))
      const lines =
        action === 'members'
          ? session.agents.map((member) => {
              const agent = byId.get(member.agentId)
              return agent
                ? describe(agent, members)
                : `- @${member.handle} · definition unavailable · ID: \`${member.agentId}\``
            })
          : all.map((agent) => describe(agent, members))
      return directReply(
        [
          `**${action === 'members' ? 'Chat participants' : 'Agent registry'} (${scope ? 'project' : 'global'})**`,
          '',
          ...lines,
          ...(!lines.length ? ['No agents found.'] : []),
        ].join('\n'),
      )
    }
    if (action === 'create') {
      if (args.length > 1 || fields.handle)
        throw new Error(
          'Usage: /agents create [handle] --description "…" --instructions "…" --priority 0',
        )
      const handle = args[0]
      if (!hasFields) {
        if (handle) agentHandleSchema.parse(handle)
        return directReply(
          `[Create ${handle ? `@${handle}` : 'an agent'}](${profileLink('')}) — on the Agents shelf choose Create, then fill in its definition and save.`,
        )
      }
      const input = agentAuthoredBlueprintSchema.parse({ handle, ...fields })
      const created = await service.createAgent(
        userId,
        agentRecordInputSchema.parse({ ...input, projectId: scope }),
      )
      announce(ctx)
      return directReply(
        `Created @${created.record.handle}. [Open profile](${profileLink(created.record.id)}). Add it with \`/agents add @${created.record.handle}\`.`,
      )
    }
    if (
      ![
        'show',
        'edit',
        'copy',
        'enable',
        'disable',
        'permissions',
        'add',
        'remove',
        'delete',
      ].includes(action)
    ) {
      throw new Error(`Unknown agents action "${action}". Run /agents help.`)
    }
    if (args.length !== (action === 'copy' ? 2 : 1))
      throw new Error(`Usage: /agents ${action} @handle${action === 'copy' ? ' <new-handle>' : ''}`)
    if (action === 'remove') {
      const member = session.agents.find(
        (entry) => entry.agentId === args[0] || entry.handle === args[0],
      )
      const saved = member ? null : await service.getAgent(userId, args[0]!, session.projectId)
      const id = member?.agentId ?? saved?.record.id
      if (!id)
        throw new NotFoundError('agent_not_found', 'Agent not found in this chat or registry')
      await ctx.changeAgentMembership(userId, session.id, { remove: [id] })
      return directReply(
        `Removed @${member?.handle ?? saved!.record.handle} from this chat. Its definition is kept.`,
      )
    }
    const agent = await service.getAgent(userId, args[0]!, session.projectId)
    if (!agent) throw new NotFoundError('agent_not_found', 'Agent not found in this registry')
    const id = agent.record.id
    if (action === 'show') {
      return directReply(
        [
          describe(agent, members),
          '',
          `ID: \`${id}\` · source: ${agent.source}`,
          '',
          '**Standing instructions**',
          '',
          agent.record.instructions,
          '',
          `[Permissions](${profileLink(id)})`,
        ].join('\n'),
      )
    }
    if (action === 'permissions' || (action === 'edit' && !hasFields)) {
      return directReply(
        `[Open ${action === 'permissions' ? 'permissions' : 'definition'} for @${agent.record.handle}](${profileLink(id)})`,
      )
    }
    if (action === 'add') {
      const changed = await ctx.changeAgentMembership(userId, session.id, { invite: [id] })
      return directReply(
        changed.invited.length
          ? `Added @${agent.record.handle}. Address it with @${agent.record.handle} to start work.`
          : `@${agent.record.handle} is already in this chat.`,
      )
    }
    if (action === 'delete') {
      if (!agentPolicy(agent).delete)
        throw new Error('This agent is system-owned or extension-owned and cannot be deleted')
      const uses = await ctx.deps.db
        .selectFrom('conversation_participants')
        .innerJoin('agent_sessions', 'agent_sessions.id', 'conversation_participants.session_id')
        .select(['agent_sessions.id', 'agent_sessions.title'])
        .where('agent_sessions.user_id', '=', userId)
        .where('conversation_participants.agent_id', '=', id)
        .execute()
      if (uses.length)
        return directReply(
          `@${agent.record.handle} is used in ${uses.length} conversation(s). Remove it from those conversations before deleting its definition.`,
        )
      if (!confirm)
        return directReply(
          `Delete @${agent.record.handle} and its saved permissions? Run \`/agents delete ${id} --confirm\` to delete this exact identity.`,
        )
      await service.deleteAgent(userId, id, session.projectId)
    } else if (action === 'edit') {
      const { id: _id, ...definition } = agent.record
      await service.updateAgent(
        userId,
        id,
        agentRecordInputSchema.parse({ ...definition, ...fields, projectId: scope }),
        session.projectId,
      )
    } else if (action === 'copy') {
      const copied = await service.duplicateAgent(userId, id, args[1]!, session.projectId)
      announce(ctx)
      return directReply(
        `Copied @${agent.record.handle} to @${copied.record.handle}, including its saved permissions and enabled choice.`,
      )
    } else {
      await service.setAgentEnabled(userId, id, action === 'enable', session.projectId)
    }
    announce(ctx)
    return directReply(
      `${action === 'edit' ? 'Updated' : action === 'delete' ? 'Deleted' : action === 'enable' ? 'Enabled' : 'Disabled'} @${agent.record.handle}.${action === 'disable' ? ' Existing work is not stopped; new runs are unavailable.' : ''}`,
    )
  } catch (error) {
    return directReply(`Agent command failed: ${errorMessage(error)}`)
  }
}

function announce(ctx: CommandHandlerContext) {
  try {
    ctx.deps.announceCapabilityChange?.()
  } catch {
    /* saved state survives a notification failure */
  }
}
