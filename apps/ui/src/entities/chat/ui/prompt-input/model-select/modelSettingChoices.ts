import { contextLimitChoices, formatContextTokens, type ContextLimit } from '@localixai/agent'
import {
  clampMaxTurns,
  DEFAULT_MAX_TURNS,
  MAX_MAX_TURNS,
  MAX_TURNS_STEPS,
} from '@localixai/api/turn-budget'

/**
 * THE PER-AGENT MODEL SETTINGS' CHOICES — what "Turns per message" and "Context limit" offer, and
 * what they read as. One source for the picker's controls (`MaxTurnsControl`,
 * `ContextLimitControl`) and `/model`'s settings steps, so the two can never offer different
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

/** One context-limit row: the stored value it writes (`undefined` = Auto) and how it reads. */
export interface ContextLimitOption {
  value: ContextLimit | undefined
  label: string
  /** The `/model` argument that names it: `auto`, `400k`, `1m`, `full`. */
  arg: string
}

/**
 * What a model offers for its context limit, like its reasoning levels: Auto, the ladder steps
 * its window holds, and Full. `adjustable` is false when Auto already is the whole window —
 * the setting is then not shown at all.
 */
export function contextLimitOptions(contextWindow: number | undefined, value?: ContextLimit) {
  // A model the catalog gives no window offers nothing to choose: the runtime budgets it at Auto.
  const choices = contextLimitChoices(contextWindow && contextWindow > 0 ? contextWindow : 0, value)
  const options: ContextLimitOption[] = [
    { value: undefined, label: `Auto · ${formatContextTokens(choices.auto)}`, arg: 'auto' },
    ...choices.steps.map((step) => {
      const label = formatContextTokens(step)
      return { value: step, label, arg: label.toLowerCase() }
    }),
    { value: 'full', label: `Full · ${formatContextTokens(choices.full)}`, arg: 'full' },
  ]
  const selected =
    choices.current === undefined
      ? options[0]!
      : (options.find((option) => option.value === choices.current) ??
        // A value this model does not offer (remembered from a bigger model) reads as what it
        // gives here: its whole window is Full, anything else its own token count.
        (choices.currentTokens === choices.full ? options.at(-1) : undefined) ?? {
          value: choices.current,
          label: formatContextTokens(choices.currentTokens),
          arg: formatContextTokens(choices.currentTokens).toLowerCase(),
        })
  return { adjustable: choices.adjustable, options, selected, currentTokens: choices.currentTokens }
}
