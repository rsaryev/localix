/**
 * THE GATE — the agent loop's `beforeToolCall`.
 *
 * Where `permission-engine.ts` owns the rule LANGUAGE (what a rule matches, how
 * rules compose, what the defaults are), this owns what happens to a call at
 * RUNTIME: the host-root guard no rule can lift (`host-root-guard.ts`), the one carve-out
 * that precedes the rule engine (the agent's own `~/.localix` tree), the optional async classifier, surfacing an `ask` to a human,
 * session-wide grants, the unattended-run answer when no human is reachable, and the
 * provenance stamped on the decision.
 *
 * Two reasons to change, so two modules: "the rule grammar grew a pattern" is not
 * "the confirm flow gained an outcome".
 */
import {
  classifyToolCall,
  type AgentTool,
  type BeforeToolCallResult,
  type GateRefusalTracker,
} from '@localixai/agent/agents'
import { localixHome } from '../../lib/env'
import { isPathBelow } from '../../lib/path-containment'
import { extractCallFacts, writeTargets } from './permission-facts'
import { hostRootDenial } from './host-root-guard'
import { scopeToOwnPlan } from './tools/file/file-call-class'
import { RESERVED_NON_TOOL_NAMES } from './tool-names-reserved'
import { withRefusalBreaker } from './permission-gate-breaker'
import { describeRule, evaluate, type PermissionRule, type ToolFacts } from './permission-engine'
import { confirmSubject } from './permission-confirm-subject'
import type { GrantOption } from './permission-grant-scope'
import { UNANSWERED_CALL_TAIL, unansweredRefusal } from './tools/hitl/decision-deadline'
import * as person from './permission-refusal-person'

export interface RequestConfirmArgs {
  toolCallId: string
  toolName: string
  /** The matched rule's own words. Absent when it had none — see `ConfirmToolPayload`. */
  message?: string
  command?: string
  /** What `command` is, so the card renders a path as a path. */
  subject?: 'command' | 'path' | 'resource'
  /** The subject's items — the paths or resources a later grant is matched against. */
  targets?: readonly string[]
  /** How far an approval may reach, narrowest first (`permission-confirm-subject.ts`). */
  grants?: readonly GrantOption[]
  cwd?: string
  sourceTitle?: string
}

/**
 * Result of surfacing an `ask` to the user. A bare boolean is the legacy shape
 * (approved yes/no); the object form additionally says HOW it was approved so
 * the gate can attribute the decision (`session-grant` = auto-approved by an
 * earlier session-wide "Always allow", without showing a card).
 *
 * `message` is what the person wrote back on the card. A refusal used to reach the agent as
 * the four words "User declined read." — so a sub-agent that had picked the wrong file had no
 * way to learn which one was right, and simply tried the next one, or gave up.
 */
export type ConfirmOutcome =
  | boolean
  | { approved: boolean; via?: 'user' | 'session-grant' | 'timeout'; message?: string }

/** The person's own words, quoted on their own line so the model cannot mistake whose they are. */
const withReply = (sentence: string, reply: string | undefined): string =>
  reply ? `${sentence}\nThe user replied: ${reply}` : sentence

export interface PermissionGateOptions {
  rules: readonly PermissionRule[]
  toolsByName: Map<string, AgentTool>
  root?: string
  /** Surfaces an 'ask' to the user; resolves approved/denied (see {@link ConfirmOutcome}). Omitted → 'ask' denies. */
  requestConfirm?: (args: RequestConfirmArgs) => Promise<ConfirmOutcome>
  /** Run-scoped memory of refusals; absent leaves the gate exactly as it was. */
  refusalTracker?: GateRefusalTracker
  /** Test seam for the host application's roots; production uses `lib/host-roots.ts`. */
  hostRoots?: readonly string[]
  /**
   * The run's own conversation plan directory (`plans/plan-paths.ts`). A file tool classes any
   * plan-shaped write as `session`; only one inside this directory stays so (`scopeToOwnPlan`).
   * Absent → no plan file is the run's own.
   */
  ownPlanDir?: string
}

/** The tools whose `session` class rests on a plan-file path test (`file-call-class.ts`). */
const PLAN_FILE_WRITERS: ReadonlySet<string> = new Set(['write', 'edit', 'apply_patch'])

interface GateContext {
  toolCallId: string
  toolName: string
  input: unknown
  sourceTitle?: string
}
/**
 * The loop's own verdict shape rather than a local restatement of it: this value is handed
 * straight to `beforeToolCall`, and a second spelling of the same fields is free to fall
 * behind the one that is actually read (it already had, missing `refusal`).
 */
type GateResult = BeforeToolCallResult | undefined

/** The gate closure {@link createPermissionGate} returns — the run's `beforeToolCall`. */
export type PermissionGateFn = (ctx: GateContext) => Promise<GateResult>

/**
 * Single, centralized permission gate used as the agent loop's `beforeToolCall`.
 * Replaces the scattered ask-mode / workspace / dangerous-command checks.
 */
export function createPermissionGate(opts: PermissionGateOptions): PermissionGateFn {
  const decide = async (ctx: GateContext): Promise<GateResult> => {
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
    // about capabilities. Observed live: a member holding `agents` called the
    // activator to reach it and was told "Blocked: activate_tools is not permitted here", which
    // made an allowed tool unreachable. It grants nothing either way — every name it can reveal
    // is already in this run's registry, past the rules, and each revealed call is checked here
    // on its own.
    //
    // A set, not a name, and owned by the module that owns tool-name policy: the gate holds no
    // list of specific tools.
    if (RESERVED_NON_TOOL_NAMES.includes(ctx.toolName)) return undefined

    // The host application is not a permission question: no rule, preset or mode reaches
    // past this line into Localix's own source or install tree (`host-root-guard.ts`).
    const hostDenial = hostRootDenial(ctx.input, call, opts.root, opts.hostRoots)
    if (hostDenial) {
      return {
        block: true,
        blockedMessage: hostDenial,
        personMessage: person.hostRootByPerson(ctx.toolName),
      }
    }

    // ONE evaluation, because there is one list. A session mode that stops asking does it by
    // rewriting that list before the run (`capabilities/permission-mode.ts`), never by a flag
    // here: a gate that knows about modes is a second answer to the question the rules answer.
    const decision = evaluate(opts.rules, facts, call)
    const allowed = decision.action === 'allow'

    // The agent's own system directories (workspace, scratch, etc.) are always
    // writable without approval, regardless of workspace boundary rules. The dir
    // comes from the ONE `~/.localix` owner (`lib/env.ts`) — the same root
    // `tools/workspace.ts` actually writes to. Deriving it
    // here from `process.env.HOME` (as this once did) let a scrubbed or spoofed
    // HOME point the carve-out at a directory the agent never writes to.
    if (ctx.toolName === 'write' || ctx.toolName === 'edit' || ctx.toolName === 'apply_patch') {
      const targets = writeTargets(ctx.toolName, ctx.input, opts.root)
      // Containment via the ONE owner (`lib/path-containment.ts`) — never a sibling like
      // `~/.localix-evil`, which a bare `startsWith` would wrongly admit, auto-writing
      // outside the protected dir with no approval.
      //
      // STRICTLY BELOW (`isPathBelow`, not `isPathWithin`): this carve-out GRANTS an
      // unprompted mutation, so it must ask the membership question — "is this target a
      // FILE the agent owns inside its state dir" — not the containment question, which
      // also answers yes to the directory itself. `writeTargets` only ever yields file
      // paths (write's `path`, apply_patch's patch targets), so the two agree on every
      // reachable input; they part company exactly where a future destructive caller
      // would want them to.
      const localixDir = localixHome()
      if (targets.length > 0 && targets.every((t) => isPathBelow(localixDir, t))) {
        if (allowed) return undefined
      }
    }

    const { action, message } = decision

    if (action === 'allow') {
      // Attribute non-default allows so the UI can explain why no confirm was
      // shown. A plain default allow (no matching rule) stays silent.
      if (decision.rule) {
        return {
          provenance: { decision: 'rule-allow', detail: describeRule(decision.rule) },
        }
      }
      return undefined
    }
    if (action === 'deny') {
      return {
        block: true,
        blockedMessage: message ?? `Blocked: ${ctx.toolName} is not permitted here.`,
        personMessage: person.deniedByPolicy(ctx.toolName, decision.rule),
      }
    }

    // action === 'ask'
    if (!opts.requestConfirm) {
      // No human is reachable on this run (unattended worker / scheduled job).
      // Tell it plainly + how to surface the need, instead of letting it retry a
      // permanently-unapprovable action.
      const why = message ?? `${ctx.toolName} needs approval`
      return {
        block: true,
        blockedMessage:
          `${why} — but this is an unattended run with no human to approve it. ` +
          `Do NOT retry it. If the task genuinely requires this, end with {action:"block", note:"Needs human approval: <what + why>"} so a human can decide; otherwise find an approach that stays inside the workspace.`,
        personMessage: person.needsAbsentPerson(ctx.toolName),
      }
    }
    const outcome = await opts.requestConfirm({
      toolCallId: ctx.toolCallId,
      toolName: ctx.toolName,
      // Only when the rule said something. The card's title already reads "Approve write?";
      // a `Allow write?` under it was the same sentence twice.
      ...(message ? { message } : {}),
      ...confirmSubject(call, ctx.toolName, facts),
      cwd: opts.root,
      sourceTitle: ctx.sourceTitle ?? call.sourceTitle,
    })
    const approved = typeof outcome === 'boolean' ? outcome : outcome.approved
    const reply = typeof outcome === 'object' ? outcome.message : undefined
    // The one refusal a person made. Tagged so the refusal breaker does not count a human
    // steering their own run — see permission-gate-breaker.ts. An expired card carries the
    // same tag for the same reason (the model did nothing wrong) and a different sentence:
    // "nobody answered" is not "the user said no", and a model that conflates them either
    // abandons work over an empty room or re-asks after a real refusal.
    if (!approved) {
      const timedOut = typeof outcome === 'object' && outcome.via === 'timeout'
      return {
        block: true,
        refusal: 'human',
        blockedMessage: timedOut
          ? unansweredRefusal(UNANSWERED_CALL_TAIL)
          : withReply(`User declined ${ctx.toolName}.`, reply),
        personMessage: timedOut
          ? person.unansweredByPerson()
          : person.declinedByPerson(ctx.toolName, reply),
      }
    }
    // A session-wide grant auto-approves without a card — say so, both to the
    // model (accurate note) and to the UI (gate provenance on the tool item).
    if (typeof outcome === 'object' && outcome.via === 'session-grant') {
      return {
        note: `[Auto-approved: the user previously granted session-wide approval for this tool.]`,
        provenance: { decision: 'session-grant' },
      }
    }
    return {
      note: withReply(
        `[The user reviewed this request and explicitly APPROVED it — proceed as approved.]`,
        reply,
      ),
      provenance: { decision: 'user-approved' },
    }
  }
  return opts.refusalTracker ? withRefusalBreaker(decide, opts.refusalTracker) : decide
}
