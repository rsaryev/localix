/**
 * HUMAN — whether a person can answer what this run asks, and where the question would show.
 *
 * Two independent "no"s meet here. The ROUTE: a card renders only in the root chat of the same
 * owner, reached through authoritative parent links (`runtime/run/hitl-reachable.ts`), and a
 * parentless automation job has no such chat. The MODE: an autonomous session has a chat nobody
 * is expected to watch. They used to be ANDed in one place and re-derived differently in four.
 */
import { defineAxis, type AxisVariant } from '../axis'
import type { HostDecision } from './host'
import type { PermissionDecision } from './permission'

export interface HumanFacts {
  /** Where a card from this run would render, and whether anyone is there. */
  hitl: { targetSessionId: string | null; reachable: boolean }
  host: HostDecision
  permission: PermissionDecision
}

export interface HumanDecision {
  /** The chat a card renders in; null when the ancestry is not verified. */
  targetSessionId: string | null
  /** A card would reach a person's screen. */
  routeReachable: boolean
  /** A person can be asked and is expected to answer (`interactive` for tools). */
  canAnswer: boolean
  /** The permission gate may raise a confirm card instead of refusing as unattended. */
  gateMayConfirm: boolean
}

function decide(facts: HumanFacts): HumanDecision {
  const routeReachable = facts.hitl.reachable
  return {
    targetSessionId: facts.hitl.targetSessionId,
    routeReachable,
    canAnswer: routeReachable && facts.permission.humanExpected,
    gateMayConfirm:
      facts.permission.humanExpected && !(facts.host.kind === 'job' && !routeReachable),
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
