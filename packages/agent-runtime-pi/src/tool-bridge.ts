import type { AgentTool as PiAgentTool } from '@earendil-works/pi-agent-core'
import { Type } from '@earendil-works/pi-ai'

import {
  prepareModelToolSchema,
  zodToJsonSchema,
  type ToolSchemaCompactionDiagnostic,
} from '@localixai/agent'
import type {
  AgentEvent,
  AgentTool,
  AgentToolExecutionContext,
  AgentToolResult,
  AfterToolCallResult,
  BeforeToolCallResult,
  HumanInLoopRequestBase,
  HumanInLoopResponseBase,
} from '@localixai/agent/agents'
import type { AgentRuntimeRunInput } from '@localixai/agent/runtime'

import { toPiPart, toolResultFromPi, type PiContent } from './message-codec'

/**
 * Drop an empty `parameters: {}` the schema does not declare.
 *
 * A GPT-family model now and then emits it beside the real arguments, and the strict schema
 * refuses the whole call for it ("parameters: schema is false"), costing a round trip for a
 * key that carries nothing. Only the empty, undeclared form has one reading; a non-empty
 * wrapper or a declared field is left for the schema to judge.
 */
function dropEmptyParametersWrapper(args: unknown, schema: unknown): unknown {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return args
  const { parameters, ...rest } = args as Record<string, unknown>
  if (!('parameters' in args)) return args
  const declared = (schema as { properties?: Record<string, unknown> }).properties ?? {}
  if ('parameters' in declared) return args
  const empty =
    parameters === null ||
    (typeof parameters === 'object' &&
      !Array.isArray(parameters) &&
      !Object.keys(parameters).length)
  return empty ? rest : args
}

export function toPiTool(
  tool: AgentTool,
  executionContext: AgentRuntimeRunInput['toolExecutionContext'],
  completedTools: Map<string, AgentToolResult>,
  emitEvent?: (event: AgentEvent) => Promise<void>,
  options: {
    /** Compact the model-facing copy only; dispatch copies retain the full validation schema. */
    modelSchema?: boolean
    onSchemaCompacted?: (diagnostic: ToolSchemaCompactionDiagnostic) => void
  } = {},
): PiAgentTool {
  const fullSchema = zodToJsonSchema(tool.inputSchema)
  const prepared = options.modelSchema ? prepareModelToolSchema(fullSchema) : undefined
  if (prepared?.diagnostic) options.onSchemaCompacted?.(prepared.diagnostic)
  const jsonSchema = prepared?.schema ?? fullSchema
  return {
    name: tool.name,
    label: tool.label ?? tool.name,
    description: tool.description,
    parameters: Type.Unsafe<Record<string, unknown>>(jsonSchema as never),
    // Pi runs this before its schema validation; see `AgentTool.prepareArguments`.
    prepareArguments: (args: unknown) => {
      const cleaned = dropEmptyParametersWrapper(args, fullSchema)
      return (tool.prepareArguments ? tool.prepareArguments(cleaned) : cleaned) as Record<
        string,
        unknown
      >
    },
    // Pi can serialize a whole tool, but it has no path-aware conflict waves.
    // A mutating tool that declares file scopes must therefore remain sequential;
    // otherwise two writes to the same path can race inside pi's parallel batch.
    executionMode: tool.mutates && tool.parallelScopePaths ? 'sequential' : tool.executionMode,
    async execute(toolCallId, params, signal, onUpdate) {
      const toolContext: AgentToolExecutionContext | undefined = executionContext?.humanInLoop
        ? {
            ...executionContext,
            humanInLoop: {
              ...executionContext.humanInLoop,
              async request<
                TRequest extends HumanInLoopRequestBase,
                TResponse extends HumanInLoopResponseBase,
              >(request: TRequest, requestSignal?: AbortSignal): Promise<TResponse> {
                const pending = executionContext.humanInLoop!.request<TRequest, TResponse>(
                  request,
                  signal && requestSignal
                    ? AbortSignal.any([signal, requestSignal])
                    : (signal ?? requestSignal),
                )
                // Event backpressure can outlive cancellation of the pending request.
                // Observe rejection now; the await below still propagates the failure.
                void pending.catch(() => {})
                await emitEvent?.({
                  type: 'human_in_loop_request',
                  toolCallId,
                  toolName: tool.name,
                  request,
                })
                const response = await pending
                await emitEvent?.({
                  type: 'human_in_loop_response',
                  toolCallId,
                  toolName: tool.name,
                  response,
                })
                return response
              },
            },
          }
        : executionContext
      let rawResult: AgentToolResult
      try {
        rawResult = await tool.execute(
          toolCallId,
          params,
          signal,
          (details: unknown) => {
            onUpdate?.({ content: [], details })
          },
          toolContext,
        )
      } catch (error) {
        throw toolContext?.sanitizeError?.(error) ?? error
      }
      const result = toolContext?.sanitizeResult?.(rawResult) ?? rawResult
      completedTools.set(toolCallId, result)
      return {
        content: piContentOf(result),
        details: result.details,
        terminate: result.terminate,
      }
    },
  }
}

/**
 * The parts Pi sends for one result. `contentParts` used to REPLACE `content` outright, which is
 * right for a tool whose parts already carry its text (MCP) and wrong for one whose parts are
 * only the picture: a screenshot reached the model as a bare image with its "Screenshot of
 * button (4×4)" label dropped, and the persisted text degraded to the `[image]` placeholder. The
 * text leads whenever the parts do not say it themselves.
 */
export function piContentOf(result: AgentToolResult): PiContent[] {
  const parts = result.contentParts?.map(toPiPart)
  if (!parts) return [{ type: 'text', text: result.content }]
  if (!result.content || parts.some((part) => part.type === 'text')) return parts
  return [{ type: 'text', text: result.content }, ...parts]
}

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
    ...(completed?.mutated !== undefined ? { mutated: completed.mutated } : {}),
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
