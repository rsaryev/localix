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
  HumanInLoopRequestBase,
  HumanInLoopResponseBase,
} from '@localixai/agent/agents'
import type { AgentRuntimeRunInput } from '@localixai/agent/runtime'

import { toPiPart, type PiContent } from './message-codec'

export { applyAfterToolCall, applyBeforeToolCall } from './tool-call-hooks'

/**
 * Undo a `parameters` wrapper the schema does not declare.
 *
 * A GPT-family model now and then emits it: empty beside the real arguments, or holding them
 * (LOCALIX-164: `{action: "steps", parameters: {preview_id, steps}}`, refused twice). The strict
 * schema refused the whole call either way. Two forms have one reading: an empty wrapper, which
 * is dropped, and one whose every key is a declared field that the call does not already set
 * differently, which is lifted. Anything else is left for the schema to judge.
 */
function unwrapParameters(args: unknown, schema: unknown): unknown {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return args
  if (!('parameters' in args)) return args
  const { parameters, ...rest } = args as Record<string, unknown>
  const declared = (schema as { properties?: Record<string, unknown> }).properties ?? {}
  if ('parameters' in declared) return args
  if (parameters === null) return rest
  if (typeof parameters !== 'object' || Array.isArray(parameters)) return args
  const inner = Object.entries(parameters as Record<string, unknown>)
  const liftable = inner.every(
    ([key, value]) =>
      key in declared &&
      (rest[key] === undefined || JSON.stringify(rest[key]) === JSON.stringify(value)),
  )
  return liftable ? { ...rest, ...Object.fromEntries(inner) } : args
}

export function toPiTool(
  tool: AgentTool,
  executionContext: AgentRuntimeRunInput['toolExecutionContext'],
  completedTools: Map<string, AgentToolResult>,
  emitEvent?: (event: AgentEvent) => Promise<void>,
  options: {
    /** Compact the model-facing copy only; dispatch copies retain the full validation schema. */
    modelSchema?: boolean
    /** This run's nested calls (`nested-tool-calls.ts`), bound to the call they are handed to. */
    callToolFor?: (toolCallId: string) => NonNullable<AgentToolExecutionContext['callTool']>
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
      const cleaned = unwrapParameters(args, fullSchema)
      return (tool.prepareArguments ? tool.prepareArguments(cleaned) : cleaned) as Record<
        string,
        unknown
      >
    },
    // Pi's mixed scheduler (vendor/pi/UPSTREAM.md): a sequential call is a barrier, parallel
    // calls overlap unless their scopes conflict. The scope's `writes` comes from `mutates`, so
    // two edits of one path, or a read of a path being edited, stay in source order.
    executionMode: tool.executionMode,
    ...(tool.executionModeFor ? { executionModeFor: tool.executionModeFor } : {}),
    ...(tool.parallelScopePaths
      ? {
          executionScope: (args: unknown) => ({
            paths: tool.parallelScopePaths!(args),
            writes: tool.mutates === true,
          }),
        }
      : {}),
    async execute(toolCallId, params, signal, onUpdate) {
      const runContext: AgentToolExecutionContext | undefined = options.callToolFor
        ? { ...executionContext, callTool: options.callToolFor(toolCallId) }
        : executionContext
      const toolContext: AgentToolExecutionContext | undefined = runContext?.humanInLoop
        ? {
            ...runContext,
            humanInLoop: {
              ...runContext.humanInLoop,
              async request<
                TRequest extends HumanInLoopRequestBase,
                TResponse extends HumanInLoopResponseBase,
              >(request: TRequest, requestSignal?: AbortSignal): Promise<TResponse> {
                const pending = runContext.humanInLoop!.request<TRequest, TResponse>(
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
        : runContext
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
