import type { MessageBinding } from '@localixai/agent'
import { isPluginCommand } from '../../plugins/kit'
import type { SessionRecord } from '../repository'
import type { MessageMutationResponse } from '../contracts'
import type { CommandHandlerContext } from './command-handlers-context'
import { handleSkillCommand } from './command-handlers-skill'
import { handleWorkflowCommand } from './command-handlers-workflow'

/**
 * A plugin's typed command (`/<plugin>:<name>`, its `commands/*.md`) and a workflow typed as a
 * command, claimed before the mods' commands. The command runs as the skill it is in the chat's kit
 * session (`handleSkillCommand`): its arguments, `${CLAUDE_*}` and `${user_config.*}` values, `!`
 * commands against the agent's rules and `@` files, as Claude Code runs it. A plugin's skill, or a
 * folder's command, is left for the skill handler. Context the person attached to the send reaches
 * the turn as every message's does (`resolveMessageBindings`). Returns null when the prompt names
 * neither.
 */
export async function handlePluginCommand(
  ctx: CommandHandlerContext,
  userId: string,
  sessionId: string,
  session: SessionRecord,
  prompt: string,
  bindings?: MessageBinding[],
): Promise<MessageMutationResponse | null> {
  return (
    (await handleSkillCommand(
      ctx,
      userId,
      sessionId,
      session,
      prompt,
      bindings,
      isPluginCommand,
    )) ?? handleWorkflowCommand(ctx, userId, sessionId, session, prompt, bindings)
  )
}
