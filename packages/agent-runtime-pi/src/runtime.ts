import { createRequire } from 'node:module'

import { runAgentLoop } from '@earendil-works/pi-agent-core'
import { cleanupSessionResources } from '@earendil-works/pi-ai'
import type {
  AssistantMessage as PiAssistantMessage,
  Model as PiModel,
} from '@earendil-works/pi-ai'

import {
  attachProviderResponse,
  normalizeToolCallHistory,
  providerResponseOf,
  validateToolRegistry,
  type AgentEvent,
} from '@localixai/agent/agents'
import type {
  AgentRuntime,
  AgentRuntimeResult,
  AgentRuntimeRun,
  AgentRuntimeRunInput,
} from '@localixai/agent/runtime'

import type { AgentMessage } from '@localixai/agent/agents'

import { normalizeEventBufferCapacity, enqueueRuntimeEvent } from './runtime-event-buffer'
import { mergeSignals } from './runtime-signal'
import { BoundedEventBuffer } from './bounded-event-buffer'
import { mapEvent, type PiTurnState } from './event-codec'
import { fromPiMessage, toPiMessage } from './message-codec'
import { isConversationalPiMessage, isPiMessage, toPiSystemMessage } from './pi-transcript'
import { wrapPiModel, type PiModelMiddleware } from './middleware'
import { createPiModels } from './models'
import {
  assembleStopConditions,
  composeStopConditions,
  type StopCondition,
} from './stop-conditions'
import { assertRequestServable, resolveReasoningEffort } from './preflight'
import { withPiRunStreamOptions, type PiRequestTuning } from './stream-options'
import { createRunTools } from './run-tools'

// The budget predicate moved with the stop-condition seam; re-exported so existing
// imports of the runtime module keep resolving.
export { shouldStopForTurnBudget } from './stop-conditions'

/** Localix conversation messages → pi wire messages (system/other roles dropped). */
export function toPiMessages(messages: readonly AgentMessage[]) {
  return normalizeToolCallHistory(messages).flatMap((message) =>
    'role' in message &&
    (message.role === 'user' || message.role === 'assistant' || message.role === 'tool')
      ? toPiMessage(message)
      : [],
  )
}

export interface PiRuntimeOptions extends PiRequestTuning {
  maxBufferedEvents?: number
  /**
   * Deployment-wide middleware, applied OUTSIDE any per-run entry. A watchdog or a
   * provider-quirk shim is a property of the deployment, not of one run, so it must not
   * depend on every call site remembering to pass it — and being outermost means a per-run
   * entry cannot bypass it.
   */
  middleware?: readonly PiModelMiddleware[]
}

export { normalizeEventBufferCapacity, enqueueRuntimeEvent } from './runtime-event-buffer'

/**
 * Pi-adapter extension of the agnostic run input. The hook types are pi-shaped (they see
 * pi's stream params and turn ledger), so they live here rather than in the agnostic
 * runtime port — a host that wants them imports this adapter's types explicitly. Every
 * field is optional: a plain {@link AgentRuntimeRunInput} runs byte-identically.
 */
export interface PiAgentRuntimeRunInput extends AgentRuntimeRunInput {
  /** Composed around the resolved model's stream call; absent or `[]` leaves it untouched. */
  middleware?: readonly PiModelMiddleware[]
  /** Extra turn-boundary stop rules, evaluated after the built-in turn budget. */
  stopConditions?: readonly StopCondition[]
}

/**
 * Re-attach the provider response to the error the host will classify. Without this the
 * whole run reduces to a message string: `Retry-After` is gone, and every rate-limit
 * cooldown falls back to an invented constant however precisely the server stated its
 * window. An error that already carries its own response (an SDK error that reached us
 * unflattened) is left alone — that one is closer to the failure than our last-seen refusal.
 */
function failedWithProviderFacts(
  error: Error,
  refusal: { status: number; headers: Record<string, string> } | undefined,
): Error {
  if (!refusal || providerResponseOf(error)) return error
  return attachProviderResponse(error, refusal)
}

// Resolved from the vendored pi package itself so a re-vendor can't silently
// leave a lying hardcode behind; 'unknown' only if the exports map ever hides it.
const requireFromHere = createRequire(import.meta.url)
function piVersion(): string {
  try {
    return (requireFromHere('@earendil-works/pi-agent-core/package.json') as { version: string })
      .version
  } catch {
    return 'unknown'
  }
}

class PiAgentRuntime implements AgentRuntime {
  readonly adapter = { id: 'pi', version: piVersion() } as const
  private readonly options: PiRuntimeOptions

  constructor(options: PiRuntimeOptions) {
    this.options = options
  }

  disposeSession(sessionId: string): void {
    cleanupSessionResources(sessionId)
  }

  run(input: PiAgentRuntimeRunInput): AgentRuntimeRun {
    const controller = new AbortController()
    const { signal, cleanup: cleanupSignal } = mergeSignals(controller, input.signal)
    const bufferConfig = normalizeEventBufferCapacity(this.options.maxBufferedEvents)
    const queue = new BoundedEventBuffer<AgentEvent>(bufferConfig.capacity)
    // The last provider REFUSAL of this run, so the error we hand back can still carry the
    // response's own rate-limit timing (see captureProviderRefusal).
    const providerRefusal: { last?: { status: number; headers: Record<string, string> } } = {}
    let done = false
    let consumerStarted = false
    let consumerClosed = signal.aborted
    let terminalError: Error | undefined
    const observedMessages: AgentMessage[] = []
    let settledMessageCount = 0
    let resolveResult!: (result: AgentRuntimeResult) => void
    const result = new Promise<AgentRuntimeResult>((resolve) => {
      resolveResult = resolve
    })
    const closeQueueOnAbort = () => {
      consumerClosed = true
      // Stop must release blocked producers even if the consumer paused mid-stream.
      // An attached consumer may still drain the events already accepted by the queue.
      queue.close(!consumerStarted)
    }
    signal.addEventListener('abort', closeQueueOnAbort)
    const push = async (event: AgentEvent) => {
      if (consumerClosed) return
      await enqueueRuntimeEvent(queue, event, consumerStarted)
    }

    void (async () => {
      try {
        if (bufferConfig.error) throw bufferConfig.error
        const dispatchInputTools = input.dispatchTools ?? input.tools
        validateToolRegistry(input.tools, dispatchInputTools)
        const models = createPiModels(input.model, input.credential, input.credentialStore)
        const model = models.getModel(input.model.providerId, input.model.modelId)
        if (!model) {
          throw new Error(`Unknown pi model ${input.model.providerId}/${input.model.modelId}`)
        }
        // Ask the model what it can serve before spending a round trip finding out: an image
        // bound for a text-only model is a fact pi's metadata already carries, and terminal by
        // construction — no retry makes it servable.
        assertRequestServable({ model: model as PiModel<string>, messages: input.messages })
        // A reasoning level the model does not offer is NOT terminal: it is clamped to the
        // nearest one it declares, the way pi itself does. A setting chosen against another
        // model used to end the run instead.
        const reasoning = resolveReasoningEffort(model as PiModel<string>, input.reasoningEffort)
        const contextMessages = toPiMessages(input.messages)
        const runTools = createRunTools(input, signal, push)
        const { tools, modelTools, completedTools } = runTools
        const turn: PiTurnState = { index: 0, terminated: false, maxTurns: input.maxTurns }
        let completedToolTurnIndex: number | undefined
        let completedTurnIndex: number | undefined
        // Order is the contract — see assembleStopConditions. The firing condition's name
        // survives into the result for diagnostics.
        const stopConditions = assembleStopConditions({
          maxTurns: input.maxTurns,
          adapter: input.stopConditions,
          host: input.stopWhen,
        })
        let stoppedBy: string | undefined
        const piMessages = await runAgentLoop(
          [],
          // The system prompt is the transcript's LEADING MESSAGE now, not a context field:
          // upstream moved both the prompt and the tool roster into the message list, where
          // a turn can amend them (`declareToolChanges` writes the tool delta onto a system
          // message). `tools` stays the runtime dispatch list and `modelTools` the schemas
          // the model may see — the split the fork keeps.
          {
            messages: [toPiSystemMessage(input.systemPrompt), ...contextMessages],
            tools,
            modelTools,
          },
          {
            model: model as PiModel<string>,
            reasoning: reasoning.effort,
            maxTokens: input.maxOutputTokens,
            finishTurn: composeStopConditions(turn, stopConditions, (name) => {
              stoppedBy = name
            }),
            convertToLlm: (messages) => messages.filter(isPiMessage),
            transformContext: input.contextPolicy
              ? async (messages) => {
                  // pi's own system messages — the prompt and the tool loadout — are NOT the
                  // host's to compact, and losing the prompt would be silent. They ride
                  // through untouched, ahead of whatever the policy returns; a tool
                  // declaration that ends up out of position is re-derived next turn, but a
                  // dropped prompt never is.
                  const system = messages.filter((message) => message.role === 'system')
                  const local = messages.flatMap((message) =>
                    isConversationalPiMessage(message) ? [fromPiMessage(message)] : [],
                  )
                  const transformed = await input.contextPolicy!.transform(local, signal)
                  return [...system, ...toPiMessages(transformed)]
                }
              : undefined,
            getSteeringMessages: input.takeSteering
              ? async () =>
                  toPiMessages(
                    await input.takeSteering!({ completedTurnIndex, completedToolTurnIndex }),
                  )
              : undefined,
            getFollowUpMessages: input.takeFollowUp
              ? async () => toPiMessages(await input.takeFollowUp!())
              : undefined,
            beforeToolCall: runTools.beforeToolCall,
            afterToolCall: runTools.afterToolCall,
          },
          async (event) => {
            if (event.type === 'turn_start') {
              completedToolTurnIndex = undefined
              completedTurnIndex = undefined
            }
            if (event.type === 'turn_end') {
              completedTurnIndex = Math.max(0, turn.index - 1)
              completedToolTurnIndex =
                event.message.role === 'assistant' &&
                event.toolResults.length > 0 &&
                event.message.stopReason !== 'error' &&
                event.message.stopReason !== 'aborted'
                  ? Math.max(0, turn.index - 1)
                  : undefined
            }
            // A system message reaching this sink is pi declaring its own tool loadout, not a
            // turn the host observed — it has no engine-neutral counterpart and is re-derived
            // each turn, so it is not persisted.
            if (event.type === 'message_end' && isConversationalPiMessage(event.message)) {
              observedMessages.push(fromPiMessage(event.message))
            }
            if (
              event.type === 'turn_end' &&
              event.message.role === 'assistant' &&
              event.message.stopReason !== 'error' &&
              event.message.stopReason !== 'aborted'
            )
              settledMessageCount = observedMessages.length
            for (const mapped of mapEvent(event, turn, completedTools)) {
              // oxlint-disable-next-line react-doctor/async-await-in-loop -- mapped lifecycle frames must reach the bounded stream in source order and each push applies backpressure
              await push(mapped)
            }
            if (event.type === 'tool_execution_end') runTools.settled(event.toolCallId)
          },
          signal,
          // Host-owned request metadata is merged INSIDE the wrapped call: middleware may
          // reshape what the model sees but cannot strip the session id, retry policy, or
          // the refusal capture the error path depends on. `[]` returns the base function
          // itself, so an absent seam is byte-identical.
          wrapPiModel(
            (requestModel, context, options) =>
              models.streamSimple(
                requestModel,
                context,
                withPiRunStreamOptions(options, input, this.options, providerRefusal),
              ),
            [...(this.options.middleware ?? []), ...(input.middleware ?? [])],
          ),
        )
        const convertedMessages: AgentMessage[] = []
        for (const message of piMessages) {
          if (isConversationalPiMessage(message)) convertedMessages.push(fromPiMessage(message))
        }
        const lastAssistant = [...piMessages]
          .reverse()
          .find((message): message is PiAssistantMessage => message.role === 'assistant')
        if (lastAssistant?.stopReason === 'error') {
          terminalError = failedWithProviderFacts(
            new Error(lastAssistant.errorMessage ?? 'Provider stream failed'),
            providerRefusal.last,
          )
        }
        done = true
        queue.close()
        resolveResult({
          messages: convertedMessages,
          terminal:
            signal.aborted || lastAssistant?.stopReason === 'aborted'
              ? 'aborted'
              : terminalError
                ? 'failed'
                : 'completed',
          ...(stoppedBy !== undefined ? { stoppedBy } : {}),
          ...(terminalError ? { error: terminalError } : {}),
        })
      } catch (error) {
        terminalError = failedWithProviderFacts(
          error instanceof Error ? error : new Error(String(error)),
          providerRefusal.last,
        )
        await push({ type: 'error', error: terminalError })
        done = true
        queue.close()
        resolveResult({
          messages: observedMessages.slice(0, settledMessageCount),
          terminal: signal.aborted ? 'aborted' : 'failed',
          error: terminalError,
        })
      } finally {
        signal.removeEventListener('abort', closeQueueOnAbort)
        cleanupSignal()
        queue.close()
      }
    })()

    return {
      result,
      abort(reason?: string) {
        controller.abort(reason)
        closeQueueOnAbort()
      },
      async *[Symbol.asyncIterator]() {
        consumerStarted = true
        let exhausted = false
        try {
          while (!queue.closed || queue.length > 0) {
            const event = queue.shift()
            if (event) {
              yield event
              continue
            }
            await queue.waitForItem()
          }
          exhausted = true
        } finally {
          if (!exhausted) {
            consumerClosed = true
            queue.close(true)
            if (!done) controller.abort('Agent event consumer closed')
          }
        }
        if (terminalError && !signal.aborted) throw terminalError
      },
    }
  }
}

export function createPiAgentRuntime(options: PiRuntimeOptions = {}): AgentRuntime {
  return new PiAgentRuntime(options)
}
