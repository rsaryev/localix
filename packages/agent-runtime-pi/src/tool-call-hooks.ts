/**
 * The host's before/after hooks around one Pi tool call: the tool's own guard and the
 * permission gate before it runs, and the post-hook that may rewrite its result after. Both
 * keep `completedTools` — the side channel the terminal event reads — in step with what Pi
 * sends the model.
 */
import type {
  AgentTool,
  AgentToolResult,
  AfterToolCallResult,
  BeforeToolCallResult,
} from '@localixai/agent/agents'
import type { AgentRuntimeRunInput } from '@localixai/agent/runtime'

import { toolResultFromPi, type PiContent } from './message-codec'

export async function applyBeforeToolCall(input: {
  tool: AgentTool | undefined
  toolCallId: string
  toolName: string
  args: unknown
  signal: AbortSignal
  beforeToolCall: AgentRuntimeRunInput['beforeToolCall']
  completedTools: Map<string, AgentToolResult>
  gateDecisions: Map<string, BeforeToolCallResult>
}): Promise<{ block: true; reason: string } | undefined> {
  const guard = await input.tool?.guard?.({
    toolCallId: input.toolCallId,
    input: input.args,
    signal: input.signal,
  })
  if (guard?.block) {
    input.completedTools.set(input.toolCallId, guard.result)
    return { block: true, reason: guard.result.content }
  }

  if (!input.beforeToolCall) return undefined
  const decision = await input.beforeToolCall(
    {
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      input: input.args,
    },
    input.signal,
  )
  if (decision) input.gateDecisions.set(input.toolCallId, decision)
  if (!decision?.block) return undefined

  const message = decision.blockedMessage ?? `Tool "${input.toolName}" was blocked`
  // The model's text and the person's text part here: `content`/`message` are what the model
  // is told and stay verbatim; `userMessage` is what a card shows, and showing the model's
  // instruction there addressed the reader as "the user".
  const personMessage = decision.personMessage ?? `${input.toolName} was not allowed`
  input.completedTools.set(input.toolCallId, {
    content: decision.blockedMessage ?? 'Tool blocked',
    isError: true,
    error: {
      kind: 'blocked',
      message,
      userMessage: personMessage,
      personMessage,
      ...(decision.refusal ? { refusal: decision.refusal } : {}),
      retryable: false,
      fatal: false,
    },
  })
  return { block: true, reason: message }
}

export async function applyAfterToolCall(input: {
  toolCallId: string
  toolName: string
  args: unknown
  result: { content: readonly PiContent[]; details?: unknown; terminate?: boolean }
  isError: boolean
  signal: AbortSignal
  afterToolCall: AgentRuntimeRunInput['afterToolCall']
  completedTools: Map<string, AgentToolResult>
  gateDecisions: Map<string, BeforeToolCallResult>
}): Promise<{
  content?: PiContent[]
  isError?: boolean
  terminate?: boolean
}> {
  const completed = input.completedTools.get(input.toolCallId)
  const gate = input.gateDecisions.get(input.toolCallId)
  const effectiveIsError = completed?.isError ?? input.isError
  const localResult = {
    ...toolResultFromPi(input.result),
    ...(input.result.terminate !== undefined ? { terminate: input.result.terminate } : {}),
    // Pi only transports model-facing content + details. Presentation
    // provenance stays in Localix's completed-result side channel and must be
    // reattached before the post-hook replaces that snapshot. Otherwise tools
    // such as `research` return sources correctly, but the terminal event and
    // persisted item lose them before the UI can render them.
    ...(completed?.sources ? { sources: completed.sources } : {}),
    ...(completed?.error ? { error: completed.error } : {}),
    ...(completed?.supersedeKey ? { supersedeKey: completed.supersedeKey } : {}),
    ...(completed?.gateProvenance
      ? { gateProvenance: completed.gateProvenance }
      : gate?.provenance
        ? { gateProvenance: gate.provenance }
        : {}),
    isError: effectiveIsError,
  }
  let patch: AfterToolCallResult | undefined
  try {
    patch = input.afterToolCall
      ? await input.afterToolCall(
          {
            toolCallId: input.toolCallId,
            toolName: input.toolName,
            input: input.args,
            result: localResult,
          },
          input.signal,
        )
      : undefined
  } catch (error) {
    // Pi replaces the result with the hook failure. Drop the pre-hook snapshot
    // so the terminal event cannot resurrect a successful result.
    input.completedTools.delete(input.toolCallId)
    throw error
  }
  const patchedResult: AgentToolResult = {
    ...localResult,
    ...(patch?.content !== undefined ? { content: patch.content } : {}),
    ...(patch?.isError !== undefined ? { isError: patch.isError } : {}),
    ...(patch?.terminate !== undefined ? { terminate: patch.terminate } : {}),
  }
  const finalResult =
    gate?.note && !patchedResult.isError
      ? { ...patchedResult, content: `${gate.note}\n\n${patchedResult.content}` }
      : patchedResult

  const content =
    gate?.note && !patchedResult.isError
      ? [
          { type: 'text' as const, text: `${gate.note}\n\n` },
          ...(patch?.content !== undefined
            ? [{ type: 'text' as const, text: patch.content }]
            : input.result.content),
        ]
      : patch?.content === undefined
        ? undefined
        : [{ type: 'text' as const, text: patch.content }]
  // Persist the same effective parts that Pi sends to the next request. Keeping the
  // original parts here resurrects pre-hook output after redaction or compaction.
  input.completedTools.set(input.toolCallId, {
    ...finalResult,
    ...toolResultFromPi({
      content: content ?? input.result.content,
      details: input.result.details,
    }),
  })
  return {
    content,
    isError: finalResult.isError,
    terminate: finalResult.terminate,
  }
}
