import {
  CONTEXT_PERCENT_STEPS,
  clampContextPercent,
  DEFAULT_CONTEXT_PERCENT,
} from '@localixai/agent'
import {
  clampMaxTurns,
  DEFAULT_MAX_TURNS,
  MAX_MAX_TURNS,
  MAX_TURNS_STEPS,
} from '@localixai/api/turn-budget'

/**
 * THE PER-AGENT MODEL SETTINGS' CHOICES — what "Turns per message" and "Context window" offer, and
 * what they read as. One source for the picker's controls (`MaxTurnsControl`,
 * `ContextPercentControl`) and `/model`'s settings steps, so the two can never offer different
 * values.
 */

export function maxTurnsLabel(value: number): string {
  const turns = clampMaxTurns(value)
  return turns >= MAX_MAX_TURNS ? 'No limit' : String(turns)
}

/** The default a participant inherits: the person's setting, capped by the agent's ceiling. */
export function inheritedMaxTurns(settingsMaxTurns?: number, agentLimit?: number): number {
  return Math.min(settingsMaxTurns ?? DEFAULT_MAX_TURNS, agentLimit ?? DEFAULT_MAX_TURNS)
}

/** The value in force and the steps offered, bounded by the agent's ceiling. */
export function maxTurnsChoices(value: number | undefined, inherited: number, limit?: number) {
  const ceiling = clampMaxTurns(limit)
  const current = Math.min(clampMaxTurns(value ?? inherited), ceiling)
  const options = [...new Set([...MAX_TURNS_STEPS, current, ceiling])]
    .filter((step) => step <= ceiling)
    .sort((a, b) => a - b)
  return { current, options }
}

export const contextPercentLabel = (value: number) => `${clampContextPercent(value)}%`

/** The share in force and the steps offered; a stored off-step value stays selectable. */
export function contextPercentChoices(value: number | undefined) {
  const current = clampContextPercent(value)
  const options = [...new Set([...CONTEXT_PERCENT_STEPS, current])].sort((a, b) => a - b)
  return { current, options, defaultValue: DEFAULT_CONTEXT_PERCENT }
}
