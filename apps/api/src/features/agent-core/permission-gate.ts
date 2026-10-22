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
import type { BeforeToolCallResult, GateRefusalTracker } from '@localixai/agent/agents'
import { withRefusalBreaker } from './permission-gate-breaker'
import { describeRule } from './permission-engine'
import {
  decisionOf,
  judgeCall,
  verdictOfDecision,
  type ReviewVerdict,
  type VerdictOptions,
} from './permission-verdict'
import { confirmSubject } from './permission-confirm-subject'
import type { GrantOption } from './permission-grant-scope'
import { UNANSWERED_CALL_TAIL, unansweredRefusal } from './tools/hitl/decision-deadline'
import * as person from './permission-refusal-person'
import { withHookVerdict, type PreToolUseVerdict } from './permission-hook-decision'
import {
  hookConfirmVerdict,
  reviewedRefusal,
  type ReviewAutomaticDenial,
} from './permission-hook-verdicts'

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
  /**
   * The CALL's own signal. A script's nested call ends with its script, before the run does: the
   * card is withdrawn then, and an answer that comes later approves nothing and records nothing.
   */
  signal?: AbortSignal
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
  | { approved: boolean; via?: 'user' | 'session-grant' | 'timeout' | 'hook'; message?: string }

/** The person's own words, quoted on their own line so the model cannot mistake whose they are. */
const withReply = (sentence: string, reply: string | undefined): string =>
  reply ? `${sentence}\nThe user replied: ${reply}` : sentence

export interface PermissionGateOptions extends VerdictOptions {
  /**
   * Surfaces an 'ask' to the user; resolves approved/denied (see {@link ConfirmOutcome}). Omitted
   * → 'ask' denies. `call` is the raw call, for a host approval hook that judges the call itself;
   * it never reaches the card, which is built from `args` alone.
   */
  requestConfirm?: (args: RequestConfirmArgs, call?: { input: unknown }) => Promise<ConfirmOutcome>
  /** Run-scoped memory of refusals; absent leaves the gate exactly as it was. */
  refusalTracker?: GateRefusalTracker
  /** Reviews each verdict before the gate acts on it (Claude Code mods' `tool.check`). */
  reviewVerdict?: ReviewVerdict
  /** Sees each refusal a permission mode made on its own (`permission-hook-verdicts.ts`). */
  reviewAutomaticDenial?: ReviewAutomaticDenial
}

interface GateContext {
  toolCallId: string
  toolName: string
  input: unknown
  sourceTitle?: string
  /** A Claude Code PreToolUse hook's allow/ask on this call (`permission-hook-decision.ts`). */
  hookVerdict?: PreToolUseVerdict
}
/**
 * The loop's own verdict shape rather than a local restatement of it: this value is handed
 * straight to `beforeToolCall`, and a second spelling of the same fields is free to fall
 * behind the one that is actually read (it already had, missing `refusal`).
 */
type GateResult = BeforeToolCallResult | undefined

/** The gate closure {@link createPermissionGate} returns — the run's `beforeToolCall`. */
export type PermissionGateFn = (ctx: GateContext, signal?: AbortSignal) => Promise<GateResult>

/**
 * Single, centralized permission gate used as the agent loop's `beforeToolCall`.
 * Replaces the scattered ask-mode / workspace / dangerous-command checks.
 */
export function createPermissionGate(opts: PermissionGateOptions): PermissionGateFn {
  const decide = async (ctx: GateContext, signal?: AbortSignal): Promise<GateResult> => {
    const judged = judgeCall(opts, ctx)
    if (judged.kind === 'exempt') return undefined
    if (judged.kind === 'host') {
      return {
        block: true,
        blockedMessage: judged.message,
        personMessage: person.hostRootByPerson(ctx.toolName),
      }
    }
    const { facts, call } = judged
    // A PreToolUse hook's allow lifts the mode's own questions; its ask forces a card.
    const hooked = withHookVerdict(opts, judged, ctx.hookVerdict)
    // A host's review (Claude Code mods' `tool.check`) may answer any verdict, either way; the
    // gate then acts on what it answered, as on a rule's.
    const decision = opts.reviewVerdict
      ? decisionOf(
          await opts.reviewVerdict(ctx, verdictOfDecision(hooked.decision)),
          hooked.decision,
        )
      : hooked.decision
    // The agent's own files in `~/.localix` are written without asking (`permission-verdict.ts`).
    if (judged.ownTree && decision === judged.decision && decision.action === 'allow')
      return undefined

    const { action, message } = decision

    if (action === 'allow') {
      // Attribute non-default allows so the UI can explain why no confirm was
      // shown. A plain default allow (no matching rule) stays silent.
      if (hooked.byHook && decision === hooked.decision)
        return { provenance: { decision: 'rule-allow', detail: 'PreToolUse hook' } }
      if (decision.rule) {
        return {
          provenance: { decision: 'rule-allow', detail: describeRule(decision.rule) },
        }
      }
      return undefined
    }
    if (action === 'deny') {
      const reason = message ?? `Blocked: ${ctx.toolName} is not permitted here.`
      return {
        block: true,
        // Only a built-in (mode) rule carries its own person sentence; the user's own deny is
        // their decision, not one made on their behalf.
        blockedMessage: decision.rule?.personMessage
          ? await reviewedRefusal(opts.reviewAutomaticDenial, ctx, reason)
          : reason,
        personMessage: person.deniedByPolicy(ctx.toolName, decision.rule),
      }
    }

    // action === 'ask'
    if (!opts.requestConfirm) {
      // No human is reachable on this run (unattended worker / scheduled job): say so, so the
      // refusal reads as permanent for this run. Repeated refusals stop it (permission-gate-breaker).
      const why = message ?? `${ctx.toolName} needs approval`
      return {
        block: true,
        blockedMessage: await reviewedRefusal(
          opts.reviewAutomaticDenial,
          ctx,
          `${why} — this is an unattended run with no human to approve it.`,
        ),
        personMessage: person.needsAbsentPerson(ctx.toolName),
      }
    }
    const outcome = await opts.requestConfirm(
      {
        toolCallId: ctx.toolCallId,
        toolName: ctx.toolName,
        // Only when the rule said something. The card's title already reads "Approve write?";
        // a `Allow write?` under it was the same sentence twice.
        ...(message ? { message } : {}),
        ...confirmSubject(call, ctx.toolName, facts),
        cwd: opts.root,
        sourceTitle: ctx.sourceTitle ?? call.sourceTitle,
        ...(signal ? { signal } : {}),
      },
      { input: ctx.input },
    )
    const approved = typeof outcome === 'boolean' ? outcome : outcome.approved
    const reply = typeof outcome === 'object' ? outcome.message : undefined
    if (typeof outcome === 'object' && outcome.via === 'hook')
      return hookConfirmVerdict(ctx.toolName, approved, reply)
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
