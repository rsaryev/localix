import type { MessageMutationResponse } from '../contracts'
import type { CommandHandlerContext, DirectReply } from './command-handlers-context'

/**
 * `/recap`: one line on where the chat stands, written into the transcript like the automatic
 * recap. The recap replaces the typed command's bubble; only when none could be written does
 * the person get a plain reply saying why.
 */
export async function handleRecapCommand(
  ctx: Pick<CommandHandlerContext, 'recap'>,
  userId: string,
  sessionId: string,
  directReply: DirectReply,
): Promise<MessageMutationResponse> {
  const result = await ctx.recap(userId, sessionId, 'command', { settleOptimistic: true })
  if (result.status === 'created') return { sessionId, messageId: result.messageId }
  if (result.status === 'skipped' && result.reason === 'too-few-turns')
    return directReply('Nothing to recap yet — send a message and wait for the reply.')
  if (result.status === 'skipped' && result.reason === 'running')
    return directReply('A reply is still being written — run `/recap` again when it finishes.')
  return directReply(
    'Could not write a recap. Check the **Session recap** model in the model picker, then try again.',
  )
}
