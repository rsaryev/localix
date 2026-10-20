/**
 * ONE RESPONSE'S TOOL CALLS, run as concurrently as their footprints allow.
 *
 * Calls are admitted in source order: the steering probe, `tool_execution_start`, then admission
 * (guard and permission gate, so approval prompts arrive one at a time and in order). A call that
 * shares the batch starts as soon as every earlier call it conflicts with has finished; an
 * exclusive call waits for everything before it and finishes before anything after it is
 * admitted. `tool_execution_end` follows completion order; settled calls are handed on in source
 * order whenever the batch drains — around an exclusive call, and at the end.
 */
import type { CallEnvironment, CallOutcome, ResolvedCall, ToolCallRequest } from './call'
import { admitCall, errorResult, executeCall, resolveCall } from './call'
import type { EmitEvent } from '../run-handle'

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
    const scope = tool!.parallelScopePaths?.(resolved.args)
    if (!scope) return { exclusive: false, writes: false }
    const paths = scope.length > 0 ? scope : undefined
    const writes = tool!.mutates === true
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

const DEFERRED_TEXT =
  'Not run: the user sent a message before this call started. Read it first, then re-issue this call if it still applies.'

/** A host probe that throws must never fail the batch. */
async function probe(shouldDefer: BatchInput['shouldDefer']): Promise<boolean> {
  try {
    return (await shouldDefer?.()) === true
  } catch {
    return false
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

export async function runToolBatch(input: BatchInput): Promise<SettledCall[]> {
  const { env, calls, signal, emit } = input
  const outcomes: Promise<SettledCall>[] = []
  const settled: SettledCall[] = []
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
    // A waiting message outranks calls the model chose before it could read it. Calls already
    // admitted keep running; the rest wait behind the message.
    if (await probe(input.shouldDefer)) {
      for (const later of calls.slice(index)) {
        const outcome: CallOutcome = { result: { content: DEFERRED_TEXT, details: {} } }
        await announce(emit, later)
        await finish(emit, later, outcome)
        outcomes.push(Promise.resolve({ call: later, outcome }))
      }
      break
    }
    await announce(emit, call)
    const admitted = await admitCall(env, resolved, signal)
    if (admitted.kind === 'settled') {
      await finish(emit, call, admitted.outcome)
      outcomes.push(Promise.resolve({ call, outcome: admitted.outcome }))
    } else {
      const blockers = running
        .filter((entry) => conflicts(entry.claim, claim))
        .map((entry) => entry.done)
      const done = (async (): Promise<SettledCall> => {
        if (blockers.length > 0) await Promise.allSettled(blockers)
        const outcome: CallOutcome = signal.aborted
          ? { result: errorResult('Operation aborted') }
          : await executeCall(env, admitted, signal, emit)
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
  await drain()
  return settled
}

/**
 * A response cut off by the output limit may carry truncated arguments that still parse. None
 * of its calls is safe to run: each is answered with an error the model can act on.
 */
export async function refuseTruncatedCalls(
  calls: readonly ToolCallRequest[],
  emit: EmitEvent,
  onSettled: BatchInput['onSettled'],
): Promise<SettledCall[]> {
  const settled: SettledCall[] = []
  for (const call of calls) {
    const outcome: CallOutcome = {
      result: errorResult(
        `Tool call "${call.name}" was not executed: the response hit the output token limit, so its arguments may be truncated. Re-issue the tool call with complete arguments.`,
      ),
    }
    await announce(emit, call)
    await finish(emit, call, outcome)
    await onSettled({ call, outcome })
    settled.push({ call, outcome })
  }
  return settled
}
