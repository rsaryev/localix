/**
 * ONE TOOL CALL, from the model's arguments to the result the model reads next.
 *
 * Four stages, each its own function because the scheduler interleaves them across a batch:
 * `resolveCall` finds the tool and parses its input (no side effects, so the scheduler can
 * claim a footprint first); `admitCall` runs the tool's guard and the host's permission gate;
 * `executeCall` runs the tool with its context and finishes it through the after-hook. A model's
 * call and a nested one (`callTool`) go through the very same stages.
 */
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
import type { ToolNaming } from './naming'
import { createProgressPump } from './progress'
import {
  abortedResult,
  applyAfterPatch,
  errorResult,
  markAborted,
  modelParts,
  textOf,
} from './results'

export { abortedResult, errorResult } from './results'

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
  callToolFor?: (parent: ToolCallRequest) => NonNullable<AgentToolExecutionContext['callTool']>
  /** How long a stopped tool may wind down before its call is closed; defaults to `STOP_GRACE_MS`. */
  stopGraceMs?: number
  /** A call may name a tool as the model knows it; it is resolved under the tool's own name. */
  naming?: Pick<ToolNaming, 'internal'>
}

/**
 * A call a tool makes on its own behalf. Its result goes back to that tool, not to the model, so
 * nothing addressed to the model reaches it: no gate note, no after-hook (the host's output
 * externalization and mid-run reminders are for the model's reading). A question it asks a
 * person is announced under its parent, the call the person sees.
 */
export interface NestedCaller {
  parent: { id: string; name: string }
  emit?: EmitEvent
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

export function resolveCall(env: CallEnvironment, requested: ToolCallRequest): ResolvedCall {
  const name = env.naming?.internal(requested.name) ?? requested.name
  const call = name === requested.name ? requested : { ...requested, name }
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

/**
 * The tool's own guard, then the host's gate. A blocked call never runs and never reaches the
 * after-hook; a guard or gate that throws settles the call with its error instead of the run.
 */
export async function admitCall(
  env: CallEnvironment,
  resolved: ResolvedCall,
  signal: AbortSignal,
  parentToolCallId?: string,
): Promise<AdmittedCall> {
  if (resolved.kind === 'settled') return resolved
  try {
    return await admitParsed(env, resolved, signal, parentToolCallId)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { kind: 'settled', call: resolved.call, outcome: { result: errorResult(message) } }
  }
}

async function admitParsed(
  env: CallEnvironment,
  resolved: Extract<ResolvedCall, { kind: 'parsed' }>,
  signal: AbortSignal,
  parentToolCallId: string | undefined,
): Promise<AdmittedCall> {
  const { call, runTool, args } = resolved
  const guard = await runTool.tool.guard?.({ toolCallId: call.id, input: args, signal })
  if (guard?.block)
    return { kind: 'settled', call, outcome: { result: { ...guard.result, isError: true } } }

  const gate = env.beforeToolCall
    ? await env.beforeToolCall(
        {
          toolCallId: call.id,
          toolName: call.name,
          input: args,
          ...(parentToolCallId ? { parentToolCallId } : {}),
        },
        signal,
      )
    : undefined
  if (signal.aborted) return { kind: 'settled', call, outcome: { result: abortedResult() } }
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

/** How long a stopped tool may take to wind down (a killed process reporting its output) before its call is closed for it. */
const STOP_GRACE_MS = 2_000

/**
 * The tool's own result, unless the run stops and the tool does not finish within the grace
 * period: then the call is closed as cancelled, so no call outlives its run. The tool may still
 * finish in the background; its late result has nowhere to go.
 */
function settleOrCancel<T>(work: Promise<T>, signal: AbortSignal, graceMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const cancel = () => {
      timer = setTimeout(() => reject(new Error('Cancelled: the run was stopped')), graceMs)
    }
    if (signal.aborted) cancel()
    else signal.addEventListener('abort', cancel, { once: true })
    work.then(resolve, reject).finally(() => {
      clearTimeout(timer)
      signal.removeEventListener('abort', cancel)
    })
  })
}

/** A thrown error as the text the model reads, through the host's shield; never rethrows. */
function shownError(context: AgentToolExecutionContext | undefined, error: unknown): string {
  try {
    const shown = context?.sanitizeError?.(error) ?? error
    return shown instanceof Error ? shown.message : String(shown)
  } catch {
    // The shield failed: the raw error may carry what it was meant to hide.
    return 'The tool failed, and its error could not be shown safely.'
  }
}

/** Run an admitted call and finish it through the after-hook and the gate's note. Never rejects. */
export async function executeCall(
  env: CallEnvironment,
  admitted: Extract<AdmittedCall, { kind: 'ready' }>,
  signal: AbortSignal,
  emit?: EmitEvent,
  nested?: NestedCaller,
): Promise<CallOutcome> {
  const { call, runTool, args, gate } = admitted
  const tool = runTool.tool
  const progress = createProgressPump(async (details) => {
    await emit?.({ type: 'tool_execution_update', toolCallId: call.id, details })
  })
  const base: AgentToolExecutionContext | undefined = env.callToolFor
    ? { ...env.context, callTool: env.callToolFor(call) }
    : env.context
  const announcer = nested ? nested.emit : emit
  const context =
    announcer && base
      ? withHumanInLoopEvents(base, nested ? nested.parent : call, signal, announcer)
      : base

  let result: AgentToolResult
  try {
    const raw = await settleOrCancel(
      Promise.resolve(
        tool.execute(call.id, args, signal, (details) => progress.report(details), context),
      ),
      signal,
      env.stopGraceMs ?? STOP_GRACE_MS,
    )
    await progress.settle()
    result = context?.sanitizeResult?.(raw) ?? raw
  } catch (error) {
    await progress.settle().catch(() => {})
    result = errorResult(shownError(context, error))
  }
  // Read before the after-hook: a tool that finished before the stop did its work, however long
  // the hook takes after it, and must not be reported as cancelled (the model would redo it).
  const stoppedDuringTool = signal.aborted

  const provenance = result.gateProvenance ?? gate?.provenance
  let finished: AgentToolResult = provenance ? { ...result, gateProvenance: provenance } : result
  if (env.afterToolCall && !nested) {
    try {
      const patch = await env.afterToolCall(
        { toolCallId: call.id, toolName: call.name, input: args, result: finished },
        signal,
      )
      finished = applyAfterPatch(finished, patch)
    } catch (error) {
      finished = errorResult(error instanceof Error ? error.message : String(error))
    }
  }
  // A call the run was stopped during ended because of the stop, whatever the tool made of it
  // (a killed command still returns its output): the output stays, and the call is marked
  // cancelled so no surface reports it as done.
  if (stoppedDuringTool) finished = markAborted(finished)
  // The gate's note tells the model what it could not otherwise see ("the person approved this").
  let parts = modelParts(finished)
  if (gate?.note && !finished.isError && !nested)
    parts = [{ type: 'text', text: `${gate.note}\n\n` }, ...parts]
  const settled: AgentToolResult = { ...finished, content: textOf(parts), contentParts: parts }
  return provenance ? { result: settled, provenance } : { result: settled }
}

/** A whole call — resolve, admit, execute — for a tool calling a tool. Never rejects. */
export async function runNestedCall(
  env: CallEnvironment,
  call: ToolCallRequest,
  signal: AbortSignal,
  nested: NestedCaller,
): Promise<CallOutcome> {
  const admitted = await admitCall(env, resolveCall(env, call), signal, nested.parent.id)
  if (admitted.kind === 'settled') return admitted.outcome
  return executeCall(env, admitted, signal, undefined, nested)
}
