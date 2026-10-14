import type { MessageToolDetails } from './contracts'
import { client, unwrap } from './internal'

/** Point-resolve card-only fields for one persisted message. */
export async function getMessageToolDetails(
  sessionId: string,
  messageId: string,
  signal?: AbortSignal,
): Promise<MessageToolDetails> {
  return unwrap(
    await client.rpc.sessions[':id'].messages[':messageId']['tool-details'].$get(
      { param: { id: sessionId, messageId } },
      { init: { signal } },
    ),
  )
}
