import type { ChannelRunEvent } from '@localixai/mini-app-sdk/backend'
import type { SessionStreamRegistry } from '../runtime/session-stream-registry'

/**
 * Mirror one session's run live to a channel (streamed drafts, tool activity, HITL asks): the
 * session's stream mapped onto the small `ChannelRunEvent` surface a platform bridge renders.
 *
 * Subscribe BEFORE the turn starts (`runExternalTurn`), or `run.started` is missed and no later
 * event can be matched to the run. A throwing channel callback is swallowed: a platform bridge
 * must never break the agent run it is watching. Returns the unsubscribe.
 */
export function mirrorRunToChannel(
  streamRegistry: Pick<SessionStreamRegistry, 'subscribe'>,
  sessionId: string,
  onEvent: (event: ChannelRunEvent) => void,
): () => void {
  let runMessageId: string | undefined
  return streamRegistry.subscribe(sessionId, ({ event }) => {
    try {
      if (event.type === 'run.started') {
        runMessageId = event.messageId
        onEvent({ type: 'status', status: 'running' })
      } else if (event.type === 'message.updated' && event.message.id === runMessageId) {
        const items = event.message.payload.items ?? []
        const text = items.map((item) => (item.type === 'text' ? item.text : '')).join('')
        const active = [...items]
          .reverse()
          .find(
            (item) =>
              item.status === 'running' && item.type !== 'text' && item.type !== 'reasoning',
          )
        const activity = active && 'name' in active ? active.name : undefined
        onEvent({ type: 'progress', text, activity })
      } else if (event.type === 'run.completed' && event.messageId === runMessageId) {
        onEvent({ type: 'status', status: 'completed' })
      } else if (event.type === 'run.failed') {
        onEvent({ type: 'status', status: 'failed' })
      } else if (event.type === 'hitl.requested') {
        // The run is now blocked on a human answer — let the channel surface it
        // natively (the workspace UI races on the same request).
        onEvent({
          type: 'hitl',
          requestId: event.request.requestId,
          kind: event.request.kind,
          title: event.request.title,
          toolName: event.toolName,
          payload: event.request.payload,
        })
      }
    } catch {
      // a throwing channel callback must never break the agent run
    }
  })
}
