/**
 * ONE RESPONSE'S TOOL CALLS, run as concurrently as their footprints allow.
 *
 * Calls are admitted in source order: the steering probe, `tool_execution_start`, then admission
 * (guard and permission gate, so approval prompts arrive one at a time and in order). A call that
 * shares the batch starts as soon as every earlier call it conflicts with has finished; an
 * exclusive call waits for everything before it and finishes before anything after it is
 * admitted. `tool_execution_end` follows completion order; settled calls are handed on in source
 * order whenever the batch drains — around an exclusive call, and at the end.
 *
 * NOT RUN AFTER A FAILURE. The calls of one response were planned together, each assuming the
 * ones before it worked (edit, then run the tests; write, then publish). So once a call that may
 * have changed state fails, no later call that has not started runs: each is answered "Not run"
 * naming the failed call, and the model plans again from that result. Calls already running
 * finish normally, and every skipped call still has its start and end, so the order of
 * `onSettled` and the events is unchanged.
 *
 * "May have changed state" is the call's class (`classifyToolCall`): anything past `read` and
 * `view`, with an undeclared tool counting as `external`. A failed read leaves the world as it
 * was, so later calls lose nothing and still run. A call the PERSON DENIED at the permission gate
 * counts like a failure: they refused a step the rest was built on, and the model must hear that
 * before acting further. A stop (abort) is not a failure; it ends the batch its own way. A call
 * that never reached its tool because its input was invalid also cascades when its tool writes:
 * the plan is just as broken.
 */
import { classifyToolCall, NON_MUTATING_EFFECTS } from '@localixai/agent/agents'
import type { CallEnvironment, CallOutcome, ResolvedCall, ToolCallRequest } from './call'
import { admitCall, executeCall, resolveCall } from './call'
import type { EmitEvent } from '../run-handle'
import {
  abortedResult,
  DEFERRED_TEXT,
  errorResult,
  messageWaits,
  notRunAfterFailure,
} from './results'

export interface SettledCall {
  call: ToolCallRequest
  outcome: CallOutcome
}

export interface BatchInput {
  env: CallEnvironment
  calls: readonly ToolCallRequest[]
  signal: AbortSignal
  emit: EmitEvent
  /** Is a person's message waiting? Asked before each call starts; true leaves the rest unrun. */
  shouldDefer?: () => boolean | Promise<boolean>
  /** Receives each call once its result is final, in source order. */
  onSettled: (settled: SettledCall) => Promise<void>
}

/** What a call holds while it runs: the whole batch, or a footprint other calls may share. */
type Claim = { exclusive: true } | { exclusive: false; writes: boolean; paths?: readonly string[] }

const EXCLUSIVE: Claim = { exclusive: true }
/** A call answered without running (unknown tool, invalid input) touches nothing. */
const INERT: Claim = { exclusive: false, writes: false, paths: [] }

function claimOf(resolved: ResolvedCall): Claim {
  const tool = resolved.runTool?.tool
  if (resolved.kind === 'settled') return tool?.executionMode === 'sequential' ? EXCLUSIVE : INERT
  try {
    const mode = tool!.executionModeFor?.(resolved.args) ?? tool!.executionMode
    if (mode === 'sequential') return EXCLUSIVE
    const writes = tool!.mutates === true
    const scope = tool!.parallelScopePaths?.(resolved.args)
    // Overlapping is opt-in for a writer: one that never said it may run beside other calls —
    // an unannotated MCP tool — runs alone. One that did (per tool or per call) keeps its word.
    if (!scope)
      return writes && mode === undefined ? EXCLUSIVE : { exclusive: false, writes: false }
    const paths = scope.length > 0 ? scope : undefined
    // A writer that cannot say what it writes must not overlap anything.
    if (writes && !paths) return EXCLUSIVE
    return paths ? { exclusive: false, writes, paths } : { exclusive: false, writes }
  } catch {
    return EXCLUSIVE
  }
}

const isSeparator = (char: string | undefined) => char === '/' || char === '\\'

function trimSeparators(path: string): string {
  let end = path.length
  while (end > 1 && isSeparator(path[end - 1])) end--
  return path.slice(0, end)
}

/** The same path, or one an ancestor of the other. */
function overlaps(left: string, right: string): boolean {
  const a = trimSeparators(left)
  const b = trimSeparators(right)
  if (a === b) return true
  const [shorter, longer] = a.length < b.length ? [a, b] : [b, a]
  if (!longer.startsWith(shorter)) return false
  return isSeparator(longer[shorter.length]) || isSeparator(shorter[shorter.length - 1])
}

function conflicts(a: Claim, b: Claim): boolean {
  if (a.exclusive || b.exclusive) return true
  if (!a.writes && !b.writes) return false
  // A writer beside a call whose footprint is unknown keeps source order.
  if (!a.paths || !b.paths) return true
  const right = b.paths
  return a.paths.some((left) => right.some((path) => overlaps(left, path)))
}

/** Did this call fail, and could it have changed state? (A denial is a failure here.) */
function failedWriter(resolved: ResolvedCall, outcome: CallOutcome): boolean {
  const result = outcome.result
  if (!result.isError || result.error?.kind === 'aborted') return false
  const tool = resolved.runTool?.tool
  if (!tool) return false
  try {
    const args = resolved.kind === 'parsed' ? resolved.args : undefined
    return !NON_MUTATING_EFFECTS.includes(classifyToolCall(tool, args).effect)
  } catch {
    return true
  }
}

async function announce(emit: EmitEvent, call: ToolCallRequest): Promise<void> {
  await emit({
    type: 'tool_execution_start',
    toolCallId: call.id,
    toolName: call.name,
    input: call.arguments,
  })
}

async function finish(emit: EmitEvent, call: ToolCallRequest, outcome: CallOutcome): Promise<void> {
  await emit({
    type: 'tool_execution_end',
    toolCallId: call.id,
    toolName: call.name,
    result: outcome.result,
    ...(outcome.provenance ? { provenance: outcome.provenance } : {}),
  })
}

export async function runToolBatch(input: BatchInput): Promise<void> {
  const { env, calls, signal, emit } = input
  const outcomes: Promise<SettledCall>[] = []
  const settled: SettledCall[] = []
  /** The first call of this response that failed after possibly changing state. */
  let failed: string | undefined
  const notRun = (): CallOutcome => ({
    result: { content: notRunAfterFailure(failed!), details: {} },
  })
  let running: { claim: Claim; done: Promise<unknown> }[] = []

  // Wait for every admitted call, then hand the outcomes on in source order.
  const drain = async (): Promise<void> => {
    const ready = await Promise.all(outcomes.slice(settled.length))
    for (const entry of ready) {
      settled.push(entry)
      // oxlint-disable-next-line react-doctor/async-await-in-loop -- results are recorded in source order, one after another
      await input.onSettled(entry)
    }
    running = []
  }

  for (const [index, call] of calls.entries()) {
    const resolved = resolveCall(env, call)
    const claim = claimOf(resolved)
    if (claim.exclusive) await drain()
    // The stop may have come while the batch drained: nothing more is asked, announced or admitted.
    if (signal.aborted) break
    // A waiting message outranks calls the model chose before it could read it. Calls already
    // admitted keep running; the rest wait behind the message.
    if (await messageWaits(input.shouldDefer)) {
      for (const later of calls.slice(index)) {
        const outcome: CallOutcome = { result: { content: DEFERRED_TEXT, details: {} } }
        await announce(emit, later)
        await finish(emit, later, outcome)
        outcomes.push(Promise.resolve({ call: later, outcome }))
      }
      break
    }
    await announce(emit, call)
    if (failed) {
      const outcome = notRun()
      await finish(emit, call, outcome)
      outcomes.push(Promise.resolve({ call, outcome }))
      continue
    }
    const admitted = await admitCall(env, resolved, signal)
    if (admitted.kind === 'settled') {
      if (failedWriter(resolved, admitted.outcome)) failed ??= call.name
      await finish(emit, call, admitted.outcome)
      outcomes.push(Promise.resolve({ call, outcome: admitted.outcome }))
    } else {
      const blockers = running
        .filter((entry) => conflicts(entry.claim, claim))
        .map((entry) => entry.done)
      const done = (async (): Promise<SettledCall> => {
        if (blockers.length > 0) await Promise.allSettled(blockers)
        // A blocker that failed while this call waited: it has not started, so it does not.
        const outcome: CallOutcome = signal.aborted
          ? { result: abortedResult() }
          : failed
            ? notRun()
            : await executeCall(env, admitted, signal, emit)
        if (outcome.result.isError && failedWriter(resolved, outcome)) failed ??= call.name
        await finish(emit, call, outcome)
        return { call, outcome }
      })()
      // Observed here so a failing event sink surfaces once, from `drain`, never as unhandled.
      done.catch(() => {})
      outcomes.push(done)
      running.push({ claim, done })
      if (claim.exclusive) await drain()
    }
    if (signal.aborted) break
  }
  // A stopped batch still answers every call the model made: the ones it never reached end as
  // cancelled, start and end announced, so no item is left pending and every call has its result.
  for (const later of calls.slice(outcomes.length)) {
    const outcome: CallOutcome = { result: abortedResult() }
    await announce(emit, later)
    await finish(emit, later, outcome)
    outcomes.push(Promise.resolve({ call: later, outcome }))
  }
  await drain()
}

/**
 * A response cut off by the output limit may carry truncated arguments that still parse. None
 * of its calls is safe to run: each is answered with an error the model can act on.
 */
export async function refuseTruncatedCalls(
  calls: readonly ToolCallRequest[],
  emit: EmitEvent,
  onSettled: BatchInput['onSettled'],
): Promise<void> {
  for (const call of calls) {
    const outcome: CallOutcome = {
      result: errorResult(
        `Tool call "${call.name}" was not executed: the response hit the output token limit, so its arguments may be truncated. Re-issue the tool call with complete arguments.`,
      ),
    }
    await announce(emit, call)
    await finish(emit, call, outcome)
    await onSettled({ call, outcome })
  }
}
