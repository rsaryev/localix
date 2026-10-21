/**
 * THE AGENT LOOP: request a response, run its tools, repeat until the model is done.
 *
 * Turn by turn: messages waiting for the model (steering, follow-ups) join the conversation, the
 * model answers through the session, the answer's tool calls run as one batch, and the turn
 * boundary decides whether another request follows. A run ends when a response has no tool
 * calls and nothing is waiting, when every call of a batch asks to stop, when a stop rule fires,
 * or when the response fails or is cancelled.
 */
import type { AssistantMessage } from '@localixai/agent'
import {
  validateToolRegistry,
  type AgentMessage,
  type AgentStopReason,
  type AgentToolResult,
} from '@localixai/agent/agents'
import type {
  AgentRuntimeResult,
  AgentRuntimeRunInput,
  ModelSession,
  SteeringBoundary,
} from '@localixai/agent/runtime'

import { isConversational, modelMessages, toolCallsOf, toolResultMessage } from './messages'
import type { RunContext } from './run-handle'
import { judgeTurnBoundary } from './stop'
import { streamTurn } from './turn'
import { toRunTool, type CallEnvironment, type RunTool } from './tools/call'
import { createNestedCalls } from './tools/nested'
import { createToolRoster } from './tools/roster'
import { refuseTruncatedCalls, runToolBatch, type SettledCall } from './tools/schedule'

/** What one run of the loop needs: the host's run input, with the model already bound. */
export interface LoopInput extends Omit<
  AgentRuntimeRunInput,
  'model' | 'credential' | 'credentialStore' | 'promptCacheIdleMs'
> {
  session: ModelSession
  /** Reports a tool whose schema had to be shortened for the model. */
  onSchemaCompacted?: (toolName: string, diagnostic: unknown) => void
}

export async function runLoop(input: LoopInput, run: RunContext): Promise<AgentRuntimeResult> {
  const { emit, signal, transcript } = run
  const dispatchTools = input.dispatchTools ?? input.tools
  validateToolRegistry(input.tools, dispatchTools)
  const tools = new Map<string, RunTool>(dispatchTools.map((tool) => [tool.name, toRunTool(tool)]))
  const roster = createToolRoster(input.tools, tools, input.onSchemaCompacted)
  const env: CallEnvironment = {
    tools,
    context: input.toolExecutionContext,
    beforeToolCall: input.beforeToolCall,
    afterToolCall: input.afterToolCall,
    callToolFor: createNestedCalls(() => env, signal, emit, input.shouldDeferToolCalls),
  }
  const conversation: AgentMessage[] = [...input.messages]
  const boundary: SteeringBoundary = {}
  let turnsStarted = 0
  let terminated = false
  let budgetExhausted = false
  let stoppedBy: string | undefined
  /** Stopped between responses: the next one is never requested. */
  let stoppedBetweenTurns = false
  let last: { message: AssistantMessage; failure?: Error } | undefined

  const append = async (message: AgentMessage, announce = true) => {
    conversation.push(message)
    transcript.messages.push(message)
    if (!announce) return
    await emit({ type: 'message_start', message })
    await emit({ type: 'message_end', message })
  }
  // The host builds its steering state from the events it has handled, so its queue is read only
  // once it has caught up — however long its persistence takes. The loop owns that ordering, so a
  // host needs no gate of its own. A stop ends the wait: a stopped run takes nothing.
  const stopped = new Promise<void>((resolve) => {
    if (signal.aborted) resolve()
    else signal.addEventListener('abort', () => resolve(), { once: true })
  })
  const caughtUp = async (): Promise<boolean> => {
    await Promise.race([run.handled(), stopped])
    return !signal.aborted
  }
  const steering = async (): Promise<AgentMessage[]> => {
    if (!input.takeSteering || !(await caughtUp())) return []
    return (await input.takeSteering({ ...boundary })).filter(isConversational)
  }
  // Same ordering as steering: the protocol a host checks reads state its handlers build.
  const followUps = async (): Promise<AgentMessage[]> => {
    if (!input.takeFollowUp || !(await caughtUp())) return []
    return (await input.takeFollowUp()).filter(isConversational)
  }
  const startTurn = async () => {
    await emit({ type: 'turn_start', turnIndex: turnsStarted })
    turnsStarted += 1
  }
  const end = async (reason: AgentStopReason) => {
    await emit({ type: 'agent_end', timestamp: Date.now(), stopReason: reason })
  }

  await emit({ type: 'agent_start', timestamp: Date.now() })
  await startTurn()
  let pending = await steering()

  outer: while (true) {
    let moreToolCalls = true
    while (moreToolCalls || pending.length > 0) {
      if (last) {
        if (signal.aborted) {
          stoppedBetweenTurns = true
          break outer
        }
        // Steering was read at the boundary that led here; nothing has run since.
        await startTurn()
      }
      for (const message of pending) await append(message)
      pending = []

      const view = input.contextPolicy
        ? await input.contextPolicy.transform(conversation, signal)
        : conversation
      last = await streamTurn(
        input.session,
        {
          systemPrompt: input.systemPrompt,
          messages: modelMessages(view),
          tools: roster.declarations(),
          ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
          ...(input.maxOutputTokens ? { maxOutputTokens: input.maxOutputTokens } : {}),
          signal,
        },
        emit,
      )
      const { message } = last
      await append(message, false)
      const turnIndex = turnsStarted - 1

      if (message.stopReason === 'error' || message.stopReason === 'aborted') {
        await emit({ type: 'turn_end', turnIndex, message, toolResults: [] })
        transcript.settled = transcript.messages.length
        await end(message.stopReason === 'aborted' ? 'aborted' : 'stream_error')
        break outer
      }

      const calls = toolCallsOf(message)
      const settled: SettledCall[] = []
      const onSettled = async (entry: SettledCall) => {
        settled.push(entry)
        roster.reveal(tools.get(entry.call.name)?.tool, entry.outcome.result)
        await append(toolResultMessage(entry))
      }
      if (calls.length > 0) {
        if (message.stopReason === 'max_tokens') await refuseTruncatedCalls(calls, emit, onSettled)
        else
          await runToolBatch({
            env,
            calls,
            signal,
            emit,
            onSettled,
            shouldDefer: input.shouldDeferToolCalls,
          })
      }
      terminated =
        settled.length > 0 && settled.every((entry) => entry.outcome.result.terminate === true)
      moreToolCalls = calls.length > 0 && !terminated

      const verdict = await judgeTurnBoundary({
        turnsStarted,
        maxTurns: input.maxTurns,
        hadToolCalls: calls.length > 0,
        terminated,
        host: input.stopWhen,
      })
      budgetExhausted = verdict.budgetExhausted
      const toolResults: AgentToolResult[] = settled.map((entry) => entry.outcome.result)
      await emit({ type: 'turn_end', turnIndex, message, toolResults })
      transcript.settled = transcript.messages.length
      boundary.completedTurnIndex = turnIndex
      boundary.completedToolTurnIndex = settled.length > 0 ? turnIndex : undefined
      if (verdict.stop) {
        stoppedBy = verdict.name
        break outer
      }
      pending = await steering()
    }
    // The model is done. A host protocol may still require messages before the run may finish.
    const required = await followUps()
    if (required.length === 0) break
    pending = required
  }

  const stopReason = last?.message.stopReason
  // A stop wins, wherever it landed: the event and the result agree that the run was stopped.
  if (stoppedBetweenTurns || (signal.aborted && stopReason !== 'error' && stopReason !== 'aborted'))
    await end('aborted')
  else if (stopReason !== 'error' && stopReason !== 'aborted') {
    await end(terminated ? 'tool_terminate' : budgetExhausted ? 'max_turns' : 'completed')
  }
  const failed = stopReason === 'error'
  const error = failed
    ? (last?.failure ?? new Error(last?.message.errorMessage ?? 'Provider stream failed'))
    : undefined
  return {
    messages: transcript.messages,
    terminal:
      signal.aborted || stopReason === 'aborted' ? 'aborted' : failed ? 'failed' : 'completed',
    ...(stoppedBy !== undefined ? { stoppedBy } : {}),
    ...(error ? { error } : {}),
  }
}
