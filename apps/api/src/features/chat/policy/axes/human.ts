/**
 * HUMAN — whether a person can answer what this run asks, and where the question would show.
 *
 * Two independent "no"s meet here. The ROUTE: a card renders only in the root chat of the same
 * owner, reached through authoritative parent links (`runtime/run/hitl-reachable.ts`), and a
 * parentless automation job has no such chat. The MODE: an autonomous session has a chat nobody
 * is expected to watch. They used to be ANDed in one place and re-derived differently in four.
 */
import { TOOL } from '../../../agent-core/tool-names'
import { defineAxis, type AxisVariant } from '../axis'
import type { PermissionDecision } from './permission'

export interface HumanFacts {
  /** Where a card from this run would render, and whether anyone is there. */
  hitl: { targetSessionId: string | null; reachable: boolean }
  permission: PermissionDecision
}

export interface HumanDecision {
  /** The chat a card renders in; null when the ancestry is not verified. */
  targetSessionId: string | null
  /** A card would reach a person's screen. */
  routeReachable: boolean
  /**
   * A person can be asked and is expected to answer: `interactive` for tools, and whether the
   * permission gate raises a confirm card or refuses as unattended. One answer for both, so a
   * card is never "declined" by a person nobody showed it to.
   */
  canAnswer: boolean
  /**
   * Tools that exist only to reach a person, withheld when nobody can be reached, with the
   * capability the run lacks. `ask` and `configure` would be refused on every call; holding them
   * also told the model, through the prompt, to use them.
   */
  withheldTools: Readonly<Record<string, string>>
}

const NEEDS_A_PERSON: Readonly<Record<string, string>> = {
  [TOOL.ask]: 'human.answer',
  [TOOL.configure]: 'human.answer',
}

function decide(facts: HumanFacts): HumanDecision {
  const routeReachable = facts.hitl.reachable
  return {
    targetSessionId: facts.hitl.targetSessionId,
    routeReachable,
    canAnswer: routeReachable && facts.permission.humanExpected,
    withheldTools: routeReachable && facts.permission.humanExpected ? {} : NEEDS_A_PERSON,
  }
}

const human = (
  id: string,
  applies: (facts: HumanFacts) => boolean,
): AxisVariant<HumanFacts, HumanDecision> => ({ id, applies, decide })

export const humanAxis = defineAxis<HumanFacts, HumanDecision>('human', [
  human('unreachable', (facts) => !facts.hitl.reachable),
  human('not-expected', (facts) => !facts.permission.humanExpected),
  human('attended', () => true),
])
