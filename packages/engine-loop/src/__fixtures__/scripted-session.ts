/**
 * A model that answers from a script, for loop tests: every request is recorded, every response
 * streams its parts as deltas and settles like a real session (never rejecting; a failure is a
 * `stopReason: 'error'` message, a cancelled request an `'aborted'` one).
 */
import type { AssistantMessage, StopReason, TextContent, ToolCall } from '@localixai/agent'
import type { AgentMessageDelta, AgentEvent } from '@localixai/agent/agents'
import type { ModelSession, ModelTurn, ModelTurnRequest } from '@localixai/agent/runtime'

export interface ScriptedResponse {
  text?: string
  calls?: Array<{ name: string; arguments?: unknown; id?: string }>
  stopReason?: StopReason
  /** Fail the request: the message carries this as `errorMessage`, `failure` as an Error. */
  error?: string
  /** Wait before answering (honours cancellation). */
  delayMs?: number
  /** Never answer on its own: wait until the request is cancelled. */
  hold?: boolean
}

export type ScriptStep =
  | ScriptedResponse
  | ((request: ModelTurnRequest) => ScriptedResponse | Promise<ScriptedResponse>)

export const say = (text: string): ScriptedResponse => ({ text })
export const call = (name: string, args: unknown = {}, id?: string): ScriptedResponse => ({
  calls: [{ name, arguments: args, ...(id ? { id } : {}) }],
})

const ORIGIN = { provider: 'scripted', model: 'scripted-1' }

let nextCallId = 0

export function scriptedSession(steps: readonly ScriptStep[]) {
  const requests: ModelTurnRequest[] = []
  let index = 0
  const session: ModelSession = {
    ref: { providerId: 'scripted', modelId: 'scripted-1' },
    turn(request): ModelTurn {
      requests.push({ ...request, messages: [...request.messages], tools: [...request.tools] })
      const step = steps[index++] ?? say('(script exhausted)')
      let failure: Error | undefined
      const deltas: AgentMessageDelta[] = []
      const message = (async (): Promise<AssistantMessage> => {
        const response = typeof step === 'function' ? await step(request) : step
        if (response.hold) {
          await new Promise<void>((resolve) => {
            if (request.signal.aborted) return resolve()
            request.signal.addEventListener('abort', () => resolve(), { once: true })
          })
        } else if (response.delayMs) {
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, response.delayMs)
            request.signal.addEventListener('abort', () => (clearTimeout(timer), resolve()), {
              once: true,
            })
          })
        }
        const base = { role: 'assistant' as const, ...ORIGIN, timestamp: Date.now() }
        if (request.signal.aborted) return { ...base, content: [], stopReason: 'aborted' }
        if (response.error) {
          failure = new Error(response.error)
          return { ...base, content: [], stopReason: 'error', errorMessage: response.error }
        }
        const content: Array<TextContent | ToolCall> = []
        if (response.text) {
          content.push({ type: 'text', text: response.text })
          deltas.push({
            kind: 'text',
            phase: 'delta',
            contentIndex: 0,
            delta: response.text,
            origin: ORIGIN,
          })
        }
        for (const planned of response.calls ?? []) {
          const id = planned.id ?? `call_${++nextCallId}`
          content.push({
            type: 'tool_call',
            id,
            name: planned.name,
            arguments: planned.arguments ?? {},
          })
          deltas.push({
            kind: 'tool_call',
            phase: 'end',
            contentIndex: content.length - 1,
            delta: '',
            id,
            name: planned.name,
            input: planned.arguments ?? {},
            origin: ORIGIN,
          })
        }
        const stopReason = response.stopReason ?? (response.calls?.length ? 'tool_use' : 'end_turn')
        return { ...base, content, stopReason, usage: { inputTokens: 10, outputTokens: 5 } }
      })()
      return {
        message,
        get failure() {
          return failure
        },
        async *[Symbol.asyncIterator]() {
          await message
          yield* deltas
        },
      }
    },
  }
  return { session, requests }
}

/** Drain a run's events while it settles; returns both. */
export async function collect(run: AsyncIterable<AgentEvent> & { result: Promise<unknown> }) {
  const events: AgentEvent[] = []
  try {
    for await (const event of run) events.push(event)
  } catch {
    // A failed run rethrows from the iterator after its events; the result says the rest.
  }
  return { events, result: await run.result }
}

export const types = (events: readonly AgentEvent[]) => events.map((event) => event.type)

/** The last item of a list (the repository targets ES2020, which has no `Array.prototype.at`). */
export const last = <T>(items: readonly T[]): T | undefined => items[items.length - 1]
