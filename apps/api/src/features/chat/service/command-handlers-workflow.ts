import type { MessageBinding } from '@localixai/agent'
import { TOOL } from '../../agent-core/tool-names'
import { findSessionSkill } from '../../plugins/kit'
import { workflowInstruction } from '../../plugins/workflow-commands'
import { nextActivatedTools } from '../runtime/run/tool-deferral'
import type { SessionRecord } from '../repository'
import type { MessageMutationResponse } from '../contracts'
import type { CommandHandlerContext } from './command-handlers-context'
import { resolveMessageBindings } from './message-bindings'

/**
 * `/<name> <input>` for a saved workflow (`.claude/workflows`, `~/.claude/workflows`) or
 * `/<plugin>:<name>` for a plugin's: asks the agent to run it with the `Workflow` tool, which it
 * activates for the chat, the input as its `args`. A skill or command of the name is what runs
 * (the kit lists it; Claude Code keeps a workflow's name off a command's). Returns null when the
 * first word names no workflow of the session.
 */
export async function handleWorkflowCommand(
  ctx: CommandHandlerContext,
  userId: string,
  sessionId: string,
  session: SessionRecord,
  prompt: string,
  bindings?: MessageBinding[],
): Promise<MessageMutationResponse | null> {
  const { repo, now, runMacroCommand } = ctx
  const token = prompt.trim().split(/\s+/)[0] ?? ''
  if (!token.startsWith('/')) return null
  const wanted = token.slice(1).toLowerCase()
  const workflows = await ctx.enabledWorkflows(userId, session)
  const workflow = workflows.find((entry) => entry.fullName.toLowerCase() === wanted)
  if (!workflow) return null
  const kitSession = await ctx.chatPluginSession?.(userId, session)
  if (kitSession && findSessionSkill(kitSession, workflow.fullName)) return null
  const input = prompt.trim().slice(token.length).trim()
  const stored = await repo.changeActivatedTools(userId, sessionId, (current) =>
    nextActivatedTools(current, [TOOL.Workflow]),
  )
  if (stored) session.activatedTools = stored.next
  const resolvedBindings = await resolveMessageBindings(ctx.deps, userId, session, bindings)
  return runMacroCommand(
    userId,
    sessionId,
    session,
    () => repo.listMessages(userId, sessionId),
    prompt,
    workflowInstruction(workflow.fullName, input),
    now(),
    {
      ...(resolvedBindings?.length ? { bindings: resolvedBindings } : {}),
      invocation: {
        source: 'plugin',
        invocation: {
          kind: 'plugin-command',
          name: workflow.fullName,
          ...(input ? { arguments: input } : {}),
          lifetime: 'turn',
        },
        presentation: { label: `/${workflow.fullName}`, token: `/${workflow.fullName}` },
      },
    },
  )
}
