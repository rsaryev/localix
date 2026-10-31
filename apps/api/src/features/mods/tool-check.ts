import { classifyToolCall, type AgentTool } from '@localixai/agent/agents'
import { agentOf, fieldOf, fireIn, hearsIn, type ModEventScope } from './event-scope'
import { toolCallEvent } from '../ext/cc-tool-shapes'

/**
 * `tool.check`: whether a tool call may run, decided before the call does. Core answers Localix's
 * permission verdict — the rules and the mode, before anyone is asked (`permission-verdict.ts`) —
 * and a hook may answer any verdict, either way: `allow` runs the call, `ask` puts it to the
 * person on a card, `deny` refuses it, its reason what the model reads. `$.tool.check` runs the
 * same chain over a call nobody makes. As in Claude Code, a call meets `tool.check` after the
 * `tool.call` hooks and the `PreToolUse` hooks they reach through `next(e)`, and before the mode
 * decides or anyone is asked: while a mod hears either event, the run's permission gate sits
 * inside the tool-call chain (`chat/runtime/run/chain-gate.ts`).
 */

export interface ModVerdict {
  decision: 'allow' | 'ask' | 'deny'
  reason?: string
  rule?: string
}

const DECISIONS: ReadonlySet<unknown> = new Set(['allow', 'ask', 'deny'])

/** A hook's verdict, or undefined when it answered none. */
export function verdictOf(answer: unknown): ModVerdict | undefined {
  const decision = fieldOf(answer, 'decision')
  if (!DECISIONS.has(decision)) return undefined
  const reason = fieldOf(answer, 'reason')
  const rule = fieldOf(answer, 'rule')
  return {
    decision: decision as ModVerdict['decision'],
    ...(typeof reason === 'string' ? { reason } : {}),
    ...(typeof rule === 'string' ? { rule } : {}),
  }
}

/** What the engine knows of a call beyond the tool and its arguments (`ToolCheckInput`). */
export interface ToolCheckFacts {
  /** The loop the call is decided in: a delegated child's id; none in the main loop. */
  agentId?: string
  /** Who answers the evaluation's asks; absent where nobody can be asked. */
  approver?: 'host' | 'person'
  /** The tool says this input changes nothing. */
  isReadOnly?: boolean
}

/** `tool.check`'s input: the tool and its arguments in Claude Code's names, and the call. */
export function toolCheckInput(
  tool: { name: string; aliases?: readonly string[] },
  args: unknown,
  toolUseId?: string,
  facts: ToolCheckFacts = {},
) {
  const { tool: name, tool_use_id: _id, ...input } = toolCallEvent(tool, args, toolUseId ?? '')
  return {
    tool: name,
    input,
    ...(toolUseId ? { tool_use_id: toolUseId } : {}),
    ...(facts.agentId ? { agentId: facts.agentId } : {}),
    ...(facts.approver ? { approver: facts.approver } : {}),
    ...(facts.isReadOnly ? { isReadOnly: true as const } : {}),
  }
}

/** A tool that declares this input a read: only its own word counts, never a guess. */
const readsOnly = (tool: AgentTool | undefined, input: unknown) =>
  tool !== undefined && classifyToolCall(tool, input).effect === 'read'

/** The run's `tool.check` port for the permission gate, or undefined when no mod hears it. */
export function toolCheckPort(
  scope: ModEventScope,
  tools: () => readonly AgentTool[],
  lend: (verdict: (toolName: string, input: unknown) => ModVerdict) => void,
  /** Who answers the asks of this run, when someone can. */
  approver?: ToolCheckFacts['approver'],
) {
  if (!hearsIn(scope, 'tool.check')) return { review: undefined, lend }
  return {
    lend,
    async review(
      call: { toolCallId: string; toolName: string; input: unknown },
      verdict: ModVerdict,
    ): Promise<ModVerdict> {
      const tool = tools().find((candidate) => candidate.name === call.toolName)
      const input = toolCheckInput(tool ?? { name: call.toolName }, call.input, call.toolCallId, {
        ...agentOf(scope),
        ...(approver ? { approver } : {}),
        isReadOnly: readsOnly(tool, call.input),
      })
      return verdictOf(await fireIn(scope, 'tool.check', input, () => verdict)) ?? verdict
    },
  }
}
