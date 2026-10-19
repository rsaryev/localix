/**
 * TRIGGER — why this turn started: the person, a colleague's request or report, a reaction
 * that asks for a reply the agent may decline, or a continuation of a run already under way.
 */
import type { RunScope } from '../../runtime/run-contract'
import { defineAxis, type AxisVariant } from '../axis'

export interface TriggerFacts {
  turnTrigger?: RunScope['turnTrigger']
  /** `origin` of the row this turn answers (the last row of its history). */
  promptOrigin?: string
  continuation: boolean
}

export type TriggerKind =
  | 'continuation'
  | 'colleague-report'
  | 'colleague-request'
  | 'reaction'
  | 'message'

export interface TriggerDecision {
  kind: TriggerKind
  /** A reaction asks for a turn the agent may decline: an empty answer is silence. */
  answersReaction: boolean
  /** The colleague rows that handed this speaker the floor, and whether they report back. */
  fromColleague?: { messageIds: readonly string[]; report: boolean }
}

function decide(kind: TriggerKind) {
  return (facts: TriggerFacts): TriggerDecision => ({
    kind,
    answersReaction: facts.promptOrigin === 'reaction',
    ...(facts.turnTrigger?.kind === 'colleague-request'
      ? {
          fromColleague: {
            messageIds: facts.turnTrigger.messageIds,
            report: facts.turnTrigger.report === true,
          },
        }
      : {}),
  })
}

const trigger = (
  kind: TriggerKind,
  applies: (facts: TriggerFacts) => boolean,
): AxisVariant<TriggerFacts, TriggerDecision> => ({ id: kind, applies, decide: decide(kind) })

export const triggerAxis = defineAxis<TriggerFacts, TriggerDecision>('trigger', [
  trigger('continuation', (facts) => facts.continuation),
  trigger(
    'colleague-report',
    (facts) => facts.turnTrigger?.kind === 'colleague-request' && facts.turnTrigger.report === true,
  ),
  trigger('colleague-request', (facts) => facts.turnTrigger?.kind === 'colleague-request'),
  trigger('reaction', (facts) => facts.promptOrigin === 'reaction'),
  trigger('message', () => true),
])
