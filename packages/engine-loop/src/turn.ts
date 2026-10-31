import type { AssistantMessage } from '@localixai/agent'
import type { ModelSession, ModelTurnRequest } from '@localixai/agent/runtime'

import type { EmitEvent } from './run-handle'
import type { ToolNaming } from './tools/naming'

export interface StreamedTurn {
  message: AssistantMessage
  /** The provider failure behind a `stopReason: 'error'` message, facts attached. */
  failure?: Error
}

/**
 * One assistant response, as events: `message_start` with an empty message, one
 * `message_update` per part delta, `message_end` with the settled message. A tool call is announced
 * under the tool's own name, whatever name the model called it by (`naming`).
 *
 * The session never rejects for the provider's sake, so this never does either: a failed or
 * cancelled request still closes with its `message_end`, and the loop reads the stop reason.
 */
export async function streamTurn(
  session: ModelSession,
  request: ModelTurnRequest,
  emit: EmitEvent,
  naming: Pick<ToolNaming, 'delta' | 'inbound'>,
): Promise<StreamedTurn> {
  const turn = session.turn(request)
  await emit({
    type: 'message_start',
    message: {
      role: 'assistant',
      content: [],
      provider: session.ref.providerId,
      model: session.ref.modelId,
      timestamp: Date.now(),
    },
  })
  try {
    for await (const delta of turn) {
      // oxlint-disable-next-line react-doctor/async-await-in-loop -- deltas must reach the bounded stream in order, and each push applies backpressure
      await emit({ type: 'message_update', delta: naming.delta(delta) })
    }
  } catch {
    // A session that breaks its contract mid-stream still settles `message`; that is what counts.
  }
  const settled = await turn.message
  const message = naming.inbound(settled)
  await emit({ type: 'message_end', message })
  const failure = turn.failure
  return failure ? { message, failure } : { message }
}
