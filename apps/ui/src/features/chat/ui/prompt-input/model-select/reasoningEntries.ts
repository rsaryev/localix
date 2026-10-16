import type { MenuEntry } from '@localixai/plugin-sdk/ui'
import type { ReasoningEffort } from '../../../model/reasoning'
import { clampModelReasoning, modelReasoningOptions } from '../../../model/modelReasoning'

/**
 * The reasoning level as menu rows: one `selected` row per level this model offers, its meaning
 * as the `description` under it. Every target holds an explicit level, so there is no "follow"
 * row — what the menu marks is exactly what the request carries.
 */

export interface ReasoningPick {
  /** The levels this model publishes (`CatalogModel.reasoningEfforts`); absent = full scale. */
  reasoningEfforts?: readonly string[]
  /** The level this model holds for the target being configured. */
  value: ReasoningEffort
}

/** What the trigger reads: the level the request will carry. */
export function resolveReasoningPick({ reasoningEfforts, value }: ReasoningPick) {
  const options = modelReasoningOptions(reasoningEfforts)
  const resolved = clampModelReasoning(value, reasoningEfforts) ?? value
  return {
    options,
    resolved,
    resolvedLabel: options.find((option) => option.value === resolved)?.label ?? resolved,
  }
}

export function reasoningEntries(
  pick: ReasoningPick & { onChange: (effort: ReasoningEffort) => void },
): MenuEntry[] {
  const { options, resolved } = resolveReasoningPick(pick)
  return options.map((option) => ({
    id: option.value,
    label: option.label,
    description: option.description,
    selected: option.value === resolved,
    onSelect: () => pick.onChange(option.value),
  }))
}
