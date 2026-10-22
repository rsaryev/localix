import { AsyncLocalStorage } from 'node:async_hooks'
import type { AgentTool, AgentToolResult, BeforeToolCallResult } from '@localixai/agent/agents'

import type { PermissionGateFn } from '../../../agent-core/permission-gate'
import { PermissionGateBlockedError } from '../../../agent-core/tools/tool-error-result'

/**
 * THE GATE INSIDE THE TOOL-CALL CHAIN, for a run whose Claude Code mods hear `tool.call` or
 * `tool.check`.
 *
 * Claude Code decides a call in this order: the mods' `tool.call` hooks, whose `next(e)` runs the
 * `PreToolUse` hooks, then `tool.check`, then the permission mode — the rules, a card for the
 * person, a PermissionRequest hook — and then the tool. A `tool.call` that refuses or rewrites a
 * call does so before anyone is asked, and the gate judges the call as the hooks left it. The
 * loop's `beforeToolCall` runs before any tool wrapper, so for such a run the gate moves here,
 * innermost in the chain (`tool-wrapper-chain.ts`), and the loop's gate passes these tools by.
 *
 * What the loop did with the gate's verdict it still does: for a tool gated here the loop's
 * `beforeToolCall` hands the loop an empty verdict for the call, and the chain writes the gate's
 * note and provenance into it once the gate allows the call. The loop then leads the result with
 * the note as it always did — after every wrapper, so a `PostToolUse` redaction or a `tool.call`
 * rewrite of the output is what the model reads, and never for a call a tool makes on its own
 * behalf (`callTool`), whose output goes back to that tool. The loop's verdict also carries the
 * call's parent, which the gate is told here as it was at the loop. A refusal is the gate's own
 * result, thrown as a block (`PermissionGateBlockedError`) so no post hook reads a call that
 * never ran. Decisions are taken one at a time, in the order calls reach the gate, so cards
 * arrive one after another as they do at the loop; a decision a gate review makes inside another
 * (a mod's `tool.check` that runs a tool) does not wait behind itself.
 */
export interface ChainGate {
  /** Whether calls meet the gate inside the chain; false leaves it the loop's alone. */
  readonly inChain: boolean
  /**
   * Hand the chain the run's gate, once intake builds it, and get the loop's `beforeToolCall`:
   * the same gate for every tool the chain does not gate itself (stubs, the activator).
   */
  bind(gate: PermissionGateFn): PermissionGateFn
  /** Gate each call inside the chain; the same tools when the gate stays at the loop. */
  wrap(tools: readonly AgentTool[]): AgentTool[]
}

export interface ChainGateOptions {
  /** A PermissionRequest hook's rewrite of the call it allowed, taken once the gate decided. */
  approvedInput?: (tool: AgentTool, toolCallId: string) => { input: unknown } | undefined
}

/** The loop's refusal, as the loop words it when the gate gives no sentence of its own. */
function refusalOf(name: string, gate: BeforeToolCallResult): AgentToolResult {
  const message = gate.blockedMessage ?? `Tool "${name}" was blocked`
  const personMessage = gate.personMessage ?? `${name} was not allowed`
  return {
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
  }
}

const stopped = () =>
  Object.assign(new Error('Cancelled: the run was stopped'), { name: 'AbortError' })

type GateCall = Parameters<PermissionGateFn>[0] & { parentToolCallId?: string }

/** The loop's verdict on a call the chain gates, filled in when the gate allows it. */
interface Pending {
  verdict: BeforeToolCallResult
  parentToolCallId?: string
}

export function createChainGate(inChain: boolean, options: ChainGateOptions = {}): ChainGate {
  let bound: PermissionGateFn | undefined
  const gated = new Set<string>()
  const pending = new Map<string, Pending>()
  // One decision at a time; a decision taken inside another one is not queued behind it.
  const deciding = new AsyncLocalStorage<true>()
  let queue: Promise<unknown> = Promise.resolve()
  const decide: PermissionGateFn = (ctx, signal) => {
    const gate = bound
    if (!gate) return Promise.reject(new Error('The permission gate is not ready'))
    if (deciding.getStore()) return gate(ctx, signal)
    const turn = queue.then(() => deciding.run(true, () => gate(ctx, signal)))
    queue = turn.catch(() => {})
    return turn
  }
  return {
    inChain,
    bind(gate) {
      bound = gate
      if (!inChain) return gate
      return async (ctx: GateCall, signal) => {
        if (!gated.has(ctx.toolName)) return gate(ctx, signal)
        const verdict: BeforeToolCallResult = {}
        const parent = ctx.parentToolCallId
        pending.set(ctx.toolCallId, { verdict, ...(parent ? { parentToolCallId: parent } : {}) })
        return verdict
      }
    },
    wrap(tools) {
      if (!inChain) return [...tools]
      return tools.map((tool) => {
        gated.add(tool.name)
        return {
          ...tool,
          async execute(toolCallId, input, signal, onUpdate, context) {
            // A call that did not come through the loop has no verdict for the note to ride on.
            const loop = pending.get(toolCallId)
            pending.delete(toolCallId)
            const parent = loop?.parentToolCallId
            const call: GateCall = {
              toolCallId,
              toolName: tool.name,
              input,
              ...(parent ? { parentToolCallId: parent } : {}),
            }
            const verdict = await decide(call, signal)
            if (signal?.aborted) throw stopped()
            if (verdict?.block) throw new PermissionGateBlockedError(refusalOf(tool.name, verdict))
            if (loop && verdict?.note) loop.verdict.note = verdict.note
            if (loop && verdict?.provenance) loop.verdict.provenance = verdict.provenance
            const approved = options.approvedInput?.(tool, toolCallId)
            const ran = await tool.execute(
              toolCallId,
              approved ? approved.input : input,
              signal,
              onUpdate,
              context,
            )
            const provenance = ran.gateProvenance ?? verdict?.provenance
            return provenance ? { ...ran, gateProvenance: provenance } : ran
          },
        }
      })
    },
  }
}

/** The chain's wrapper for {@link ChainGate.wrap}, named as the wrapper chain names its own. */
export function wrapToolsWithPermissionGate(
  tools: readonly AgentTool[],
  gate: ChainGate | undefined,
): AgentTool[] {
  return gate ? gate.wrap(tools) : [...tools]
}
