/**
 * ONE TOOL CALL, from the model's arguments to the result the model reads next.
 *
 * Four stages, each its own function because the scheduler interleaves them across a batch:
 * `resolveCall` finds the tool and parses its input (no side effects, so the scheduler can
 * claim a footprint first); `admitCall` runs the tool's guard and the host's permission gate;
 * `executeCall` runs the tool with its context and finishes it through the after-hook. A model's
 * call and a nested one (`callTool`) go through the very same stages.
 */
import type { TextContent, ImageContent, FileContent } from '@localixai/agent'
import { zodToJsonSchema } from '@localixai/agent'
import type {
  AgentTool,
  AgentToolExecutionContext,
  AgentToolResult,
  BeforeToolCallResult,
  ToolGateProvenance,
} from '@localixai/agent/agents'
import type { AgentRuntimeRunInput } from '@localixai/agent/runtime'

import type { EmitEvent } from '../run-handle'
import { parseToolArguments } from './arguments'
import type { JsonSchema } from './coerce'
import { withHumanInLoopEvents } from './human-in-loop'
import { createProgressPump } from './progress'

export interface ToolCallRequest {
  id: string
  name: string
  arguments: unknown
}

/** A tool with its full JSON Schema, computed once per run. */
export interface RunTool {
  tool: AgentTool
  jsonSchema: JsonSchema
}

export function toRunTool(tool: AgentTool): RunTool {
  return { tool, jsonSchema: zodToJsonSchema(tool.inputSchema) as JsonSchema }
}

/** What every call of one run shares. */
export interface CallEnvironment {
  tools: ReadonlyMap<string, RunTool>
  context: AgentToolExecutionContext | undefined
  beforeToolCall: AgentRuntimeRunInput['beforeToolCall']
  afterToolCall: AgentRuntimeRunInput['afterToolCall']
  /** Binds `callTool` to the call it is handed to; absent where tools may not call tools. */
  callToolFor?: (toolCallId: string) => NonNullable<AgentToolExecutionContext['callTool']>
}

/** How a call ended: the result, and how the gate allowed it when it did so explicitly. */
export interface CallOutcome {
  result: AgentToolResult
  provenance?: ToolGateProvenance
}

export type ResolvedCall =
  | { kind: 'parsed'; call: ToolCallRequest; runTool: RunTool; args: unknown }
  | { kind: 'settled'; call: ToolCallRequest; runTool?: RunTool; outcome: CallOutcome }

export type AdmittedCall =
  | {
      kind: 'ready'
      call: ToolCallRequest
      runTool: RunTool
      args: unknown
      gate?: BeforeToolCallResult
    }
  | { kind: 'settled'; call: ToolCallRequest; outcome: CallOutcome }

export function errorResult(message: string): AgentToolResult {
  return { content: message, isError: true }
}

export function resolveCall(env: CallEnvironment, call: ToolCallRequest): ResolvedCall {
  const runTool = env.tools.get(call.name)
  if (!runTool)
    return {
      kind: 'settled',
      call,
      outcome: { result: errorResult(`Tool ${call.name} not found`) },
    }
  const parsed = parseToolArguments({
    toolName: call.name,
    raw: call.arguments,
    schema: runTool.tool.inputSchema,
    jsonSchema: runTool.jsonSchema,
    ...(runTool.tool.prepareArguments ? { prepare: runTool.tool.prepareArguments } : {}),
  })
  return parsed.ok
    ? { kind: 'parsed', call, runTool, args: parsed.value }
    : { kind: 'settled', call, runTool, outcome: { result: errorResult(parsed.message) } }
}

const ABORTED = 'Operation aborted'

/**
 * The tool's own guard, then the host's gate. A blocked call never runs and never reaches the
 * after-hook; a guard or gate that throws settles the call with its error instead of the run.
 */
export async function admitCall(
  env: CallEnvironment,
  resolved: ResolvedCall,
  signal: AbortSignal,
): Promise<AdmittedCall> {
  if (resolved.kind === 'settled') return resolved
  try {
    return await admitParsed(env, resolved, signal)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { kind: 'settled', call: resolved.call, outcome: { result: errorResult(message) } }
  }
}

async function admitParsed(
  env: CallEnvironment,
  resolved: Extract<ResolvedCall, { kind: 'parsed' }>,
  signal: AbortSignal,
): Promise<AdmittedCall> {
  const { call, runTool, args } = resolved
  const guard = await runTool.tool.guard?.({ toolCallId: call.id, input: args, signal })
  if (guard?.block)
    return { kind: 'settled', call, outcome: { result: { ...guard.result, isError: true } } }

  const gate = env.beforeToolCall
    ? await env.beforeToolCall({ toolCallId: call.id, toolName: call.name, input: args }, signal)
    : undefined
  if (signal.aborted) return { kind: 'settled', call, outcome: { result: errorResult(ABORTED) } }
  if (gate?.block) {
    // The model is told the gate's instruction verbatim; the card shows the sentence for the person.
    const message = gate.blockedMessage ?? `Tool "${call.name}" was blocked`
    const personMessage = gate.personMessage ?? `${call.name} was not allowed`
    return {
      kind: 'settled',
      call,
      outcome: {
        result: {
          content: message,
          isError: true,
          error: {
            kind: 'blocked',
            message,
            userMessage: personMessage,
            personMessage,
            ...(gate.refusal ? { refusal: gate.refusal } : {}),
            retryable: false,
            fatal: false,
          },
        },
      },
    }
  }
  return { kind: 'ready', call, runTool, args, ...(gate ? { gate } : {}) }
}

/** The parts the model reads: the media a tool returned, led by its text when they lack one. */
export function modelParts(
  result: AgentToolResult,
): Array<TextContent | ImageContent | FileContent> {
  const parts = result.contentParts
  if (!parts) return [{ type: 'text', text: result.content }]
  if (!result.content || parts.some((part) => part.type === 'text')) return parts
  return [{ type: 'text', text: result.content }, ...parts]
}

function textOf(parts: ReadonlyArray<TextContent | ImageContent | FileContent>): string {
  return parts
    .map((part) =>
      part.type === 'text' ? part.text : part.type === 'image' ? '[image]' : '[file]',
    )
    .join('')
}

/** How long a stopped tool may take to wind down (a killed process reporting its output) before its call is closed for it. */
const STOP_GRACE_MS = 2_000

/**
 * The tool's own result, unless the run stops and the tool does not finish within the grace
 * period: then the call is closed as cancelled, so no call outlives its run. The tool may still
 * finish in the background; its late result has nowhere to go.
 */
function settleOrCancel<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const cancel = () => {
      timer = setTimeout(() => reject(new Error('Cancelled: the run was stopped')), STOP_GRACE_MS)
    }
    if (signal.aborted) cancel()
    else signal.addEventListener('abort', cancel, { once: true })
    work.then(resolve, reject).finally(() => {
      clearTimeout(timer)
      signal.removeEventListener('abort', cancel)
    })
  })
}

/** Run an admitted call and finish it through the after-hook and the gate's note. Never rejects. */
export async function executeCall(
  env: CallEnvironment,
  admitted: Extract<AdmittedCall, { kind: 'ready' }>,
  signal: AbortSignal,
  emit?: EmitEvent,
): Promise<CallOutcome> {
  const { call, runTool, args, gate } = admitted
  const tool = runTool.tool
  const progress = createProgressPump(async (details) => {
    await emit?.({ type: 'tool_execution_update', toolCallId: call.id, details })
  })
  const base: AgentToolExecutionContext | undefined = env.callToolFor
    ? { ...env.context, callTool: env.callToolFor(call.id) }
    : env.context
  const context = emit && base ? withHumanInLoopEvents(base, call, signal, emit) : base

  let result: AgentToolResult
  try {
    const raw = await settleOrCancel(
      Promise.resolve(
        tool.execute(call.id, args, signal, (details) => progress.report(details), context),
      ),
      signal,
    )
    await progress.settle()
    result = context?.sanitizeResult?.(raw) ?? raw
  } catch (error) {
    await progress.settle().catch(() => {})
    const shown = context?.sanitizeError?.(error) ?? error
    result = errorResult(shown instanceof Error ? shown.message : String(shown))
  }

  const provenance = result.gateProvenance ?? gate?.provenance
  let finished: AgentToolResult = provenance ? { ...result, gateProvenance: provenance } : result
  if (env.afterToolCall) {
    try {
      const patch = await env.afterToolCall(
        { toolCallId: call.id, toolName: call.name, input: args, result: finished },
        signal,
      )
      if (patch) {
        finished = {
          ...finished,
          ...(patch.content !== undefined
            ? { content: patch.content, contentParts: undefined }
            : {}),
          ...(patch.isError !== undefined ? { isError: patch.isError } : {}),
          ...(patch.terminate !== undefined ? { terminate: patch.terminate } : {}),
        }
      }
    } catch (error) {
      finished = errorResult(error instanceof Error ? error.message : String(error))
    }
  }
  // A call the run was stopped during ended because of the stop, whatever the tool made of it
  // (a killed command still returns its output): the output stays, and the call is marked
  // cancelled so no surface reports it as done.
  if (signal.aborted && !finished.error) {
    finished = {
      ...finished,
      isError: true,
      error: { kind: 'aborted', message: 'The run was stopped', userMessage: 'Stopped' },
    }
  }
  // The gate's note tells the model what it could not otherwise see ("the person approved this").
  let parts = modelParts(finished)
  if (gate?.note && !finished.isError)
    parts = [{ type: 'text', text: `${gate.note}\n\n` }, ...parts]
  const settled: AgentToolResult = { ...finished, content: textOf(parts), contentParts: parts }
  return provenance ? { result: settled, provenance } : { result: settled }
}

/** A whole call — resolve, admit, execute — for a tool calling a tool. Never rejects. */
export async function runCall(
  env: CallEnvironment,
  call: ToolCallRequest,
  signal: AbortSignal,
): Promise<CallOutcome> {
  const admitted = await admitCall(env, resolveCall(env, call), signal)
  if (admitted.kind === 'settled') return admitted.outcome
  return executeCall(env, admitted, signal)
}
