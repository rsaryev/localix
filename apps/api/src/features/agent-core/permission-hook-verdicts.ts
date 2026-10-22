import type { BeforeToolCallResult } from '@localixai/agent/agents'

import * as person from './permission-refusal-person'

/**
 * The gate's two verdicts that come from a host hook rather than a rule or a person.
 *
 * A refusal the rules made without asking anyone — a permission mode's own denial (plan,
 * bypass's catastrophic guard, autonomous) or an `ask` on a run nobody can answer — handed to a
 * reviewer before the model reads it. The reviewer (Claude Code's PermissionDenied hooks) may add
 * a note, such as that the call may be retried; the refusal itself stands.
 */
export type ReviewAutomaticDenial = (
  call: { toolCallId: string; toolName: string; input: unknown },
  reason: string,
) => Promise<string | undefined>

export async function reviewedRefusal(
  review: ReviewAutomaticDenial | undefined,
  call: { toolCallId: string; toolName: string; input: unknown },
  reason: string,
): Promise<string> {
  if (!review) return reason
  const note = await review(
    { toolCallId: call.toolCallId, toolName: call.toolName, input: call.input },
    reason,
  ).catch(() => undefined)
  return note ? `${reason}\n${note}` : reason
}

/** A host approval hook answered the card before the person did: its own words, not theirs. */
export function hookConfirmVerdict(
  toolName: string,
  approved: boolean,
  reply: string | undefined,
): BeforeToolCallResult {
  return approved
    ? {
        note: '[Approved by a permission hook.]',
        provenance: { decision: 'rule-allow', detail: 'permission hook' },
      }
    : {
        block: true,
        blockedMessage: reply ?? `A permission hook denied ${toolName}.`,
        personMessage: person.deniedByPolicy(toolName, { message: reply }),
      }
}
