/**
 * THE VERDICT a call meets before anyone is asked: the host-root guard, the rule list, and the
 * agent's own `~/.localix` tree.
 *
 * `permission-gate.ts` acts on it — refuses, asks a person, lets the call through. Split out so a
 * host can review the verdict between the two (`PermissionGateOptions.reviewVerdict`: Claude Code
 * mods' `tool.check`), and answer it for a call that is only a question and runs nothing
 * (`verdictOf`: a mod's `$.tool.check`).
 */
import { classifyToolCall, type AgentTool } from '@localixai/agent/agents'
import { localixHome } from '../../lib/env'
import { isPathBelow } from '../../lib/path-containment'
import { extractCallFacts, writeTargets } from './permission-facts'
import { hostRootDenial } from './host-root-guard'
import { scopeToOwnPlan } from './tools/file/file-call-class'
import { RESERVED_NON_TOOL_NAMES } from './tool-names-reserved'
import { isProtocolTool } from './tool-names'
import { describeRule, evaluate, type PermissionRule, type ToolFacts } from './permission-engine'

export interface VerdictOptions {
  rules: readonly PermissionRule[]
  /** Task-local skill grants may preapprove named questions, never class guards or denials. */
  preapprovedRules?: readonly PermissionRule[]
  toolsByName: Map<string, AgentTool>
  root?: string
  /** Test seam for the host application's roots; production uses `lib/host-roots.ts`. */
  hostRoots?: readonly string[]
  /**
   * The run's own conversation plan directory (`plans/plan-paths.ts`). A file tool classes any
   * plan-shaped write as `session`; only one inside this directory stays so (`scopeToOwnPlan`).
   * Absent → no plan file is the run's own.
   */
  ownPlanDir?: string
}

export type RuleDecision = ReturnType<typeof evaluate>

export type CallJudgement =
  /** A mechanism, not a capability: never a permission question. */
  | { kind: 'exempt' }
  /** Localix's own source or install tree: no rule, mode or review reaches past it. */
  | { kind: 'host'; message: string }
  | {
      kind: 'rule'
      decision: RuleDecision
      facts: ToolFacts
      call: ReturnType<typeof extractCallFacts>
      /** Every target is a file inside the agent's own `~/.localix` tree. */
      ownTree: boolean
    }

/** The tools whose `session` class rests on a plan-file path test (`file-call-class.ts`). */
const PLAN_FILE_WRITERS: ReadonlySet<string> = new Set(['write', 'edit'])

export function judgeCall(
  opts: VerdictOptions,
  ctx: { toolName: string; input: unknown },
): CallJudgement {
  // A call is judged on the tool's own verdict about THIS input (`AgentTool.classify`), not on
  // a static flag: a dual-purpose tool declaring `mutates: true` would otherwise have every
  // rule about writes confirm or refuse its reads too. A tool that declares nothing is
  // `external` — fail-closed, because this class is a permission input.
  const tool = opts.toolsByName.get(ctx.toolName)
  const declared = classifyToolCall(tool, ctx.input)
  // A file tool cannot tell its conversation's plan from another's; the gate can.
  const callClass = PLAN_FILE_WRITERS.has(ctx.toolName)
    ? scopeToOwnPlan(declared, writeTargets(ctx.toolName, ctx.input, opts.root), opts.ownPlanDir)
    : declared
  const facts: ToolFacts = { name: ctx.toolName, ...callClass }
  const call = extractCallFacts(ctx.toolName, ctx.input, opts.root, tool)

  // THE RULES ARBITRATE CAPABILITIES, AND A CAPABILITY IS A CATALOG ENTRY.
  //
  // A denied tool is REMOVED — the projection subtracts it from the roster and the registry
  // never builds it, so it is not on the wire and no call can reach this gate. That is the
  // whole enforcement path for anything the catalog names.
  //
  // `RESERVED_NON_TOOL_NAMES` is the set the catalog deliberately does NOT name: core-owned
  // names that are mechanisms rather than capabilities, built from the run's own deferred set
  // after assembly. The roster never offers them, so the projection can never deny them —
  // yet evaluating them HERE answered anyway, from a blanket `tool:*` deny that was written
  // about capabilities. Observed live: a member holding a deferred core tool called the
  // activator to reach it and was told "Blocked: activate_tools is not permitted here", which
  // made an allowed tool unreachable. It grants nothing either way — every name it can reveal
  // is already in this run's registry, past the rules, and each revealed call is checked here
  // on its own.
  //
  // A set, not a name, and owned by the module that owns tool-name policy: the gate holds no
  // list of specific tools.
  if (RESERVED_NON_TOOL_NAMES.includes(ctx.toolName) || isProtocolTool(ctx.toolName))
    return { kind: 'exempt' }

  // The host application is not a permission question: no rule, preset or mode reaches
  // past this line into Localix's own source or install tree (`host-root-guard.ts`).
  const hostDenial = hostRootDenial(ctx.input, call, opts.root, opts.hostRoots)
  if (hostDenial) return { kind: 'host', message: hostDenial }

  // ONE evaluation, because there is one list. A session mode that stops asking does it by
  // rewriting that list before the run (`capabilities/permission-mode.ts`), never by a flag
  // here: a gate that knows about modes is a second answer to the question the rules answer.
  const decision = evaluate(opts.rules, facts, call, opts.preapprovedRules)

  // The agent's own system directories (workspace, scratch, etc.) are always writable without
  // approval, regardless of workspace boundary rules. The dir comes from the ONE `~/.localix`
  // owner (`lib/env.ts`) — the same root `tools/workspace.ts` actually writes to. Deriving it
  // from `process.env.HOME` (as this once did) let a scrubbed or spoofed HOME point the
  // carve-out at a directory the agent never writes to.
  //
  // Containment via the ONE owner (`lib/path-containment.ts`) — never a sibling like
  // `~/.localix-evil`, which a bare `startsWith` would wrongly admit. STRICTLY BELOW
  // (`isPathBelow`, not `isPathWithin`): this carve-out GRANTS an unprompted mutation, so it must
  // ask the membership question — "is this target a FILE the agent owns inside its state dir" —
  // not the containment question, which also answers yes to the directory itself.
  const targets =
    ctx.toolName === 'write' || ctx.toolName === 'edit'
      ? writeTargets(ctx.toolName, ctx.input, opts.root)
      : []
  const ownTree = targets.length > 0 && targets.every((t) => isPathBelow(localixHome(), t))
  return { kind: 'rule', decision, facts, call, ownTree }
}

/** A verdict as Claude Code's `tool.check` reads and answers it. */
export interface CallVerdict {
  decision: 'allow' | 'ask' | 'deny'
  reason?: string
  /** The rule that decided, as written (`bash(git *)`). */
  rule?: string
}

/** Reviews the verdict on a real call before the gate acts on it. */
export type ReviewVerdict = (
  call: { toolCallId: string; toolName: string; input: unknown },
  verdict: CallVerdict,
) => Promise<CallVerdict>

export const verdictOfDecision = (decision: RuleDecision): CallVerdict => ({
  decision: decision.action,
  ...(decision.message ? { reason: decision.message } : {}),
  ...(decision.rule ? { rule: describeRule(decision.rule) } : {}),
})

/** The decision a reviewed verdict stands for: the rule's own when the review kept it. */
export function decisionOf(reviewed: CallVerdict, original: RuleDecision): RuleDecision {
  if (reviewed.decision === original.action && reviewed.reason === original.message) return original
  return { action: reviewed.decision, ...(reviewed.reason ? { message: reviewed.reason } : {}) }
}

/** The verdict on a call nobody makes: what the gate would decide before asking anyone. */
export function verdictOf(opts: VerdictOptions) {
  return (toolName: string, input: unknown): CallVerdict => {
    const judged = judgeCall(opts, { toolName, input })
    if (judged.kind === 'exempt') return { decision: 'allow' }
    if (judged.kind === 'host') return { decision: 'deny', reason: judged.message }
    if (judged.ownTree && judged.decision.action === 'allow') return { decision: 'allow' }
    return verdictOfDecision(judged.decision)
  }
}
