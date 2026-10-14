/**
 * WHAT THE PERSON READS WHEN THE GATE SAYS NO — one owner for every refusal's second sentence.
 *
 * The gate's `blockedMessage` is written to the model: "User declined bash.", "AUTO-DENIED —
 * nobody answered…", "Do NOT retry it". The tool card showed that text verbatim, in red, so a
 * person who pressed Deny read about "the user" in the third person, and an instruction meant
 * for the agent ("end with {action:"block"…}") landed in the transcript as if it were advice to
 * them. The model's text stays exactly as it is; these sentences ride beside it
 * (`BeforeToolCallResult.personMessage`) and are what a card renders.
 *
 * Wording follows the feedback standard: a human decline is the person's own act ("You
 * declined bash"), a policy refusal names the tool and the rule's reason, and none of them end
 * in a full stop — they are a card's headline, not a paragraph.
 */
import { UNANSWERED_PERSON_MESSAGE } from './tools/hitl/decision-deadline'

const capitalized = (name: string): string => name.charAt(0).toUpperCase() + name.slice(1)

const withoutStop = (text: string): string => text.trim().replace(/[.!]+$/u, '')

/** A person pressed Deny; their reply, when they wrote one, is part of what they said. */
export function declinedByPerson(toolName: string, reply?: string): string {
  return reply?.trim()
    ? `You declined ${toolName}: ${withoutStop(reply)}`
    : `You declined ${toolName}`
}

/** The card expired with nobody at it — not a refusal anyone made. */
export const unansweredByPerson = (): string => UNANSWERED_PERSON_MESSAGE

/**
 * A rule refused the call. A built-in rule states its own person sentence (plan mode, bypass,
 * autonomous); a rule the user wrote has only its `message`, which is the user's own words and
 * so safe to show them.
 */
export function deniedByPolicy(
  toolName: string,
  rule: { message?: string; personMessage?: string } | undefined,
): string {
  if (rule?.personMessage) return rule.personMessage
  const reason = rule?.message ? withoutStop(rule.message) : ''
  return reason
    ? `${capitalized(toolName)} is not allowed here: ${reason}`
    : `${capitalized(toolName)} is not allowed here`
}

/** An `ask` on a run nobody can answer (a scheduled job, an unattended worker). */
export const needsAbsentPerson = (toolName: string): string =>
  `${capitalized(toolName)} needs approval, and nobody can give it in this run`

/** The guard no rule can lift: Localix's own install tree. */
export const hostRootByPerson = (toolName: string): string =>
  `${capitalized(toolName)} cannot reach Localix’s own files`

/** The refusal breaker ended the run; the person learns why nothing followed. */
export const breakerTripped = (refusals: number): string =>
  `Stopped after ${refusals} refused tool calls`
