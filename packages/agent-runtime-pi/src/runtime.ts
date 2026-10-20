import { createRequire } from 'node:module'

import { runAgentLoop } from '@earendil-works/pi-agent-core'
import { cleanupSessionResources } from '@earendil-works/pi-ai'
import type {
  AssistantMessage as PiAssistantMessage,
  Model as PiModel,
} from '@earendil-works/pi-ai'

import { validateToolRegistry, type AgentEvent } from '@localixai/agent/agents'
import type { AgentRuntime, AgentRuntimeResult, AgentRuntimeRun } from '@localixai/agent/runtime'

import type { AgentMessage } from '@localixai/agent/agents'

import { normalizeEventBufferCapacity, enqueueRuntimeEvent } from './runtime-event-buffer'
import { createContextTransform, toPiMessages } from './runtime-context'
import type { PiRuntimeOptions, PiAgentRuntimeRunInput } from './runtime-contract'
import { failedWithProviderFacts } from './runtime-provider-facts'
import { mergeSignals } from './runtime-signal'
import { BoundedEventBuffer } from './bounded-event-buffer'
import { mapEvent, type PiTurnState } from './event-codec'
import { fromPiMessage } from './message-codec'
import { isConversationalPiMessage, isPiMessage, toPiSystemMessage } from './pi-transcript'
import { wrapPiModel } from './middleware'
import { createPiModels } from './models'
import { assembleStopConditions, composeStopConditions } from './stop-conditions'
import { assertRequestServable, resolveReasoningEffort } from './preflight'
import { withPiRunStreamOptions } from './stream-options'
import { createRunTools } from './run-tools'

// The budget predicate moved with the stop-condition seam; re-exported so existing
// imports of the runtime module keep resolving.
export { shouldStopForTurnBudget } from './stop-conditions'

export { toPiMessages } from './runtime-context'

export type { PiRuntimeOptions, PiAgentRuntimeRunInput } from './runtime-contract'

export { normalizeEventBufferCapacity, enqueueRuntimeEvent } from './runtime-event-buffer'

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
            transformContext: createContextTransform(input, signal),
            getSteeringMessages: input.takeSteering
              ? async () =>
                  toPiMessages(
                    await input.takeSteering!({ completedTurnIndex, completedToolTurnIndex }),
                  )
              : undefined,
            shouldDeferToolCalls: input.shouldDeferToolCalls,
            getFollowUpMessages: input.takeFollowUp
              ? async () => toPiMessages(await input.takeFollowUp!())
              : undefined,
            beforeToolCall: runTools.beforeToolCall,
            afterToolCall: runTools.afterToolCall,
          },
          async (event) => {
            runTools.observe(event)
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
