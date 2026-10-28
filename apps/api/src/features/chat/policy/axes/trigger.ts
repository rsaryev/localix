/**
 * TRIGGER — why this turn started: the person, a reaction that asks for a reply the agent may
 * decline, or a continuation of a run already under way.
 */
import { defineAxis, type AxisVariant } from '../axis'

export interface TriggerFacts {
  /** `origin` of the row this turn answers (the last row of its history). */
  promptOrigin?: string
  continuation: boolean
}

export type TriggerKind = 'continuation' | 'reaction' | 'message'

export interface TriggerDecision {
  kind: TriggerKind
  /** A reaction asks for a turn the agent may decline: an empty answer is silence. */
  answersReaction: boolean
}

const trigger = (
  kind: TriggerKind,
  applies: (facts: TriggerFacts) => boolean,
): AxisVariant<TriggerFacts, TriggerDecision> => ({
  id: kind,
  applies,
  decide: (facts) => ({ kind, answersReaction: facts.promptOrigin === 'reaction' }),
})

export const triggerAxis = defineAxis<TriggerFacts, TriggerDecision>('trigger', [
  trigger('continuation', (facts) => facts.continuation),
  trigger('reaction', (facts) => facts.promptOrigin === 'reaction'),
  trigger('message', () => true),
])
