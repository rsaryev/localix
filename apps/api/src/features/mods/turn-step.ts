import { randomUUID } from 'node:crypto'
import type { AssistantMessage, ModelStepHook, ReasoningEffort } from '@localixai/agent'
import { fieldOf, fireIn, hearsIn, type ModEventScope } from './event-scope'
import { claudeCodeToolName, localToolName, toolCallEvent, toolInputOf } from './tool-shapes'

/**
 * `turn.step`: each model request of a turn, before it is sent. The event streams: a hook is an
 * async generator, and `next(e)` sends the request and is the stream of the response, whose
 * result (`yield* next(e)`, or `await next(e)` in a plain hook) is the whole response
 * (`{ turnId, index, answer, toolUses, stopReason, usage }`); the engine drives the generators
 * (`@localixai/claude-plugin/mods` `stream.ts`), and the chunks a hook yields without `next` make
 * its answer. `next` with
 * another `model` (of the conversation's provider) or `effort` sends that instead, and a hook
 * that answers without `next` sends nothing — its answer is the response the turn goes on with.
 * Once a request was sent, what it streamed stands: a hook's own value changes only what the
 * hooks above it read.
 */

/** The efforts Claude Code names; Localix's `off` and `minimal` read as none. */
const EFFORTS: ReadonlySet<unknown> = new Set(['low', 'medium', 'high', 'xhigh', 'max'])
const STOPS: ReadonlySet<unknown> = new Set(['end_turn', 'tool_use', 'max_tokens', 'stop_sequence'])

type Fields = Record<string, unknown>

/** A response as `turn.step` answers it. */
export function stepResult(turnId: string, index: number, message: AssistantMessage) {
  const usage = message.usage
  return {
    turnId,
    index,
    answer: message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join(''),
    toolUses: message.content.flatMap((part) => {
      if (part.type !== 'tool_call') return []
      const { tool: _tool, tool_use_id: _id, ...input } = toolCallEvent(part, part.arguments, '')
      return [{ name: claudeCodeToolName(part), input }]
    }),
    stopReason: STOPS.has(message.stopReason) ? message.stopReason : null,
    usage: usage
      ? {
          input_tokens: usage.inputTokens,
          output_tokens: usage.outputTokens,
          cache_read_input_tokens: usage.cacheReadTokens ?? 0,
          cache_creation_input_tokens: usage.cacheWriteTokens ?? 0,
          model: message.responseModel ?? message.model,
        }
      : null,
  }
}

/** The response a hook answered in the model's place. */
function answeredMessage(answer: unknown, model: string): AssistantMessage {
  const text = fieldOf(answer, 'answer')
  const uses = fieldOf(answer, 'toolUses')
  const calls = (Array.isArray(uses) ? uses : []).flatMap((use) => {
    const name = fieldOf(use, 'name')
    if (typeof name !== 'string') return []
    const local = localToolName(name)
    const input = fieldOf(use, 'input')
    return [
      {
        type: 'tool_call' as const,
        id: `mod-${randomUUID()}`,
        name: local,
        arguments: toolInputOf(local, input && typeof input === 'object' ? (input as Fields) : {}),
      },
    ]
  })
  return {
    role: 'assistant',
    content: [
      ...(typeof text === 'string' && text ? [{ type: 'text' as const, text }] : []),
      ...calls,
    ],
    model,
    stopReason: calls.length > 0 ? 'tool_use' : 'end_turn',
    timestamp: Date.now(),
  }
}

/** The run's step hook for the model loop, or undefined when no mod hears `turn.step`. */
export function modelStepHook(scope: ModEventScope, turnId: string): ModelStepHook | undefined {
  if (!hearsIn(scope, 'turn.step')) return undefined
  return async (step, send) => {
    let sent: AssistantMessage | undefined
    const input = {
      turnId,
      index: step.index,
      model: step.modelId,
      ...(EFFORTS.has(step.reasoningEffort) ? { effort: step.reasoningEffort } : {}),
      messageCount: step.messageCount,
    }
    const answer = await fireIn(scope, 'turn.step', input, async (e) => {
      const model = fieldOf(e, 'model')
      const effort = fieldOf(e, 'effort')
      sent = await send({
        ...(typeof model === 'string' && model && model !== step.modelId ? { modelId: model } : {}),
        ...(EFFORTS.has(effort) ? { reasoningEffort: effort as ReasoningEffort } : {}),
      })
      return stepResult(turnId, step.index, sent)
    })
    return sent ?? answeredMessage(answer, step.modelId)
  }
}
