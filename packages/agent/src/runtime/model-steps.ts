/**
 * MODEL STEPS: a host's hand around each model request of a run.
 *
 * A step hook sees the request about to go out (its index in the run, the model, the effort,
 * how many messages it carries) and decides what is sent: `send()` makes it as it stands,
 * `send({ modelId, reasoningEffort })` makes it on another model of the run's provider or with
 * another effort, and a hook that never calls `send` answers in the model's place — the loop then
 * reads the message the hook returned. Whatever the sent requests stream reaches the loop as it
 * arrives; the message the hook resolves to is the one the loop records and acts on.
 */
import type { AgentMessageDelta } from '../agents'
import type { AssistantMessage, ReasoningEffort } from '../types'
import type { ModelSession, ModelTurn } from './model-session'

export interface ModelStep {
  /** The request's position in the run, from 0. */
  index: number
  modelId: string
  reasoningEffort?: ReasoningEffort
  /** How many messages the request carries. */
  messageCount: number
}

export interface ModelStepOverride {
  /** Another model of the run's provider. */
  modelId?: string
  reasoningEffort?: ReasoningEffort
}

export type ModelStepHook = (
  step: ModelStep,
  send: (override?: ModelStepOverride) => Promise<AssistantMessage>,
) => Promise<AssistantMessage>

/** Deltas pushed by whichever requests a step sends, read by the loop in arrival order. */
function deltaQueue() {
  const items: AgentMessageDelta[] = []
  let closed = false
  let wake: (() => void) | undefined
  const notify = () => {
    wake?.()
    wake = undefined
  }
  return {
    push(delta: AgentMessageDelta) {
      items.push(delta)
      notify()
    },
    close() {
      closed = true
      notify()
    },
    async *drain(): AsyncGenerator<AgentMessageDelta> {
      for (;;) {
        const next = items.shift()
        if (next) {
          yield next
          continue
        }
        if (closed) return
        await new Promise<void>((resolve) => (wake = resolve))
      }
    },
  }
}

/** The deltas a response streams, for one a hook answered without a request. */
function deltasOf(message: AssistantMessage): AgentMessageDelta[] {
  const origin = {
    model: message.model,
    ...(message.provider ? { provider: message.provider } : {}),
  }
  return message.content.flatMap((part, contentIndex): AgentMessageDelta[] => {
    if (part.type === 'text') {
      const text = { kind: 'text' as const, contentIndex, origin }
      return [
        { ...text, phase: 'start', delta: '' },
        { ...text, phase: 'delta', delta: part.text },
        { ...text, phase: 'end', delta: '' },
      ]
    }
    if (part.type !== 'tool_call') return []
    const call = { kind: 'tool_call' as const, contentIndex, origin, id: part.id, name: part.name }
    return [
      { ...call, phase: 'start', delta: '', input: {} },
      { ...call, phase: 'end', delta: '', input: part.arguments },
    ]
  })
}

/** `session` with `hook` around each of its requests; `sessionFor` opens another model's. */
export function withModelSteps(
  session: ModelSession,
  hook: ModelStepHook,
  sessionFor: (modelId: string) => ModelSession,
): ModelSession {
  let index = 0
  const others = new Map<string, ModelSession>()
  const target = (modelId: string | undefined) => {
    if (!modelId || modelId === session.ref.modelId) return session
    let other = others.get(modelId)
    if (!other) others.set(modelId, (other = sessionFor(modelId)))
    return other
  }
  return {
    ref: session.ref,
    turn(request): ModelTurn {
      const step: ModelStep = {
        index: index++,
        modelId: session.ref.modelId,
        ...(request.reasoningEffort ? { reasoningEffort: request.reasoningEffort } : {}),
        messageCount: request.messages.length,
      }
      const queue = deltaQueue()
      let failure: Error | undefined
      let sent = false
      const send = async (override: ModelStepOverride = {}) => {
        sent = true
        const effort = override.reasoningEffort ?? request.reasoningEffort
        const turn = target(override.modelId).turn({
          ...request,
          ...(effort ? { reasoningEffort: effort } : {}),
        })
        for await (const delta of turn) queue.push(delta)
        const message = await turn.message
        failure = turn.failure
        return message
      }
      const message = Promise.resolve()
        .then(() => hook(step, send))
        .catch(
          (error: unknown): AssistantMessage => ({
            role: 'assistant',
            content: [],
            provider: session.ref.providerId,
            model: session.ref.modelId,
            stopReason: 'error',
            errorMessage: error instanceof Error ? error.message : String(error),
            timestamp: Date.now(),
          }),
        )
        .then((answer) => {
          // An answer no request streamed reaches the loop's readers as the model's would.
          if (!sent) for (const delta of deltasOf(answer)) queue.push(delta)
          return answer
        })
        .finally(() => queue.close())
      return {
        message,
        get failure() {
          return failure
        },
        [Symbol.asyncIterator]: () => queue.drain(),
      }
    },
  }
}
