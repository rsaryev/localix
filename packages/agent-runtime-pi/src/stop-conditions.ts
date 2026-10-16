import type { AssistantMessage as PiAssistantMessage } from '@earendil-works/pi-ai'

import type { PiTurnState } from './event-codec'

/**
 * Pi asks this after the assistant response and its tools have settled. Reaching the
 * numeric boundary is not itself abnormal: a text-only final answer on the last turn
 * completed naturally. Stop only when another provider turn is required to consume
 * tool results; user follow-ups remain eligible to start their own turn.
 */
export function shouldStopForTurnBudget(turn: PiTurnState, message: PiAssistantMessage): boolean {
  if (turn.maxTurns === undefined || turn.index < turn.maxTurns || turn.terminated) return false
  return message.content.some((part) => part.type === 'toolCall')
}

/**
 * What a stop condition may inspect at a turn boundary: the run's turn ledger — the SAME
 * mutable object event mapping reads, so writes to it are visible downstream — and the
 * assistant message that completed the turn.
 */
export interface StopConditionState {
  turn: PiTurnState
  message: PiAssistantMessage
}

/**
 * One named reason to end the loop at a turn boundary. Conditions compose as "any firing
 * condition stops the run", and the firing condition's `name` becomes the run result's
 * `stoppedBy`, so an early stop is always attributable to a specific rule.
 */
export interface StopCondition {
  name: string
  shouldStop(state: StopConditionState): boolean | Promise<boolean>
}

/**
 * The built-in budget guard — the original turn-boundary closure, verbatim. The
 * flag write is part of the contract, not bookkeeping: event mapping derives the
 * `agent_end` `max_turns` stop reason from `turn.budgetExhausted`, and the old closure
 * (re)set it on EVERY evaluation, so this condition must too.
 */
export const turnBudget: StopCondition = {
  name: 'turnBudget',
  shouldStop: ({ turn, message }) => {
    turn.budgetExhausted = shouldStopForTurnBudget(turn, message)
    return turn.budgetExhausted
  },
}

/** A host stop rule: a name and a predicate over state the host itself keeps. */
export interface HostStopCondition {
  name: string
  shouldStop: () => boolean | Promise<boolean>
}

/**
 * The run's stop list, in evaluation order.
 *
 * Order is the contract, not a preference. The budget goes first because its verdict — and
 * the `budgetExhausted` flag event mapping reads to report a `max_turns` stop — must be
 * settled before anything else can end the run for its own reason. Host conditions go last:
 * they answer from host state, so unlike the two lists before them they neither read nor
 * write the turn ledger, and running them earlier could only mask a budget stop.
 */
export function assembleStopConditions(input: {
  maxTurns?: number
  adapter?: readonly StopCondition[]
  host?: readonly HostStopCondition[]
}): StopCondition[] {
  return [
    ...(input.maxTurns === undefined ? [] : [turnBudget]),
    ...(input.adapter ?? []),
    ...(input.host ?? []).map((condition) => ({
      name: condition.name,
      shouldStop: () => condition.shouldStop(),
    })),
  ]
}

/**
 * Fold conditions into pi's `finishTurn` hook. Evaluation follows array order and
 * short-circuits on the first firing condition, whose name is reported through `onStop`
 * before the loop is told to stop. Error and aborted turns are ignored because the removed
 * `shouldStopAfterTurn` hook never saw them; preserving that boundary prevents predicates
 * with successful-response assumptions from running on terminal failures. No conditions ⇒
 * `undefined`, byte-identical to a run that never installed the hook.
 */
export function composeStopConditions(
  turn: PiTurnState,
  conditions: readonly StopCondition[],
  onStop: (name: string) => void,
):
  | ((context: { message: PiAssistantMessage }) => Promise<{ action: 'end' } | undefined>)
  | undefined {
  if (conditions.length === 0) return undefined
  return async ({ message }) => {
    if (message.stopReason === 'error' || message.stopReason === 'aborted') return undefined
    for (const condition of conditions) {
      // oxlint-disable-next-line react-doctor/async-await-in-loop -- ordered short-circuit evaluation is the contract; conditions may not run concurrently
      if (await condition.shouldStop({ turn, message })) {
        onStop(condition.name)
        return { action: 'end' }
      }
    }
    return undefined
  }
}
