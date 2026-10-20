import type {
  AgentToolExecutionContext,
  HumanInLoopRequestBase,
  HumanInLoopResponseBase,
} from '@localixai/agent/agents'

import type { EmitEvent } from '../run-handle'

/**
 * The execution context a running tool sees, with its questions to a person announced on the
 * run's event stream: a `human_in_loop_request` as the question is asked and a
 * `human_in_loop_response` once it is answered. The question is bound to the call's signal, so
 * a stopped call withdraws it.
 */
export function withHumanInLoopEvents(
  context: AgentToolExecutionContext,
  call: { id: string; name: string },
  signal: AbortSignal,
  emit: EmitEvent,
): AgentToolExecutionContext {
  const controller = context.humanInLoop
  if (!controller) return context
  return {
    ...context,
    humanInLoop: {
      ...controller,
      async request<
        TRequest extends HumanInLoopRequestBase,
        TResponse extends HumanInLoopResponseBase,
      >(request: TRequest, requestSignal?: AbortSignal): Promise<TResponse> {
        const pending = controller.request<TRequest, TResponse>(
          request,
          requestSignal ? AbortSignal.any([signal, requestSignal]) : signal,
        )
        // Backpressure on the event below can outlive a cancelled request; the await still rethrows.
        void pending.catch(() => {})
        await emit({
          type: 'human_in_loop_request',
          toolCallId: call.id,
          toolName: call.name,
          request,
        })
        const response = await pending
        await emit({
          type: 'human_in_loop_response',
          toolCallId: call.id,
          toolName: call.name,
          response,
        })
        return response
      },
    },
  }
}
