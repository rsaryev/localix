import type { MenuEntry } from '@localixai/plugin-sdk/ui'
import { DEFAULT_REASONING_EFFORT } from '@localixai/agent'
import type { ReasoningEffort } from '../../../model/reasoning'
import { clampModelReasoning, modelReasoningOptions } from '../../../model/modelReasoning'

/**
 * The reasoning level as menu rows — ONE builder for the composer chip and the details panel.
 *
 * The defect it stops: the two pickers were built separately and drifted. One listed the levels
 * as a hand-made radio group with "Follow the conversation" as a footer button that called
 * itself "Following the session" once pressed; the other drew a single choice as checkboxes and
 * folded each level's meaning into the right-aligned `hint`, where it truncated. Built here once,
 * both menus show the same rows in the same words with the same marks.
 *
 * The shape: "Follow the conversation" heads the list as its own choice — not a level but the
 * absence of one, with the level it resolves to as its `hint` — then one `selected` row per level
 * this model offers, its meaning as the `description` under it.
 */

export interface ReasoningPick {
  /** The levels this model publishes (`CatalogModel.reasoningEfforts`); absent = full scale. */
  reasoningEfforts?: readonly string[]
  /** This model's own level, or undefined when it follows the inherited one. */
  value: ReasoningEffort | undefined
  /** The level a model with no level of its own runs at (the conversation's), when there is one. */
  inheritedEffort?: ReasoningEffort
}

/** One phrase for "no level of my own", so the chip and the panel cannot word it differently. */
export const FOLLOW_CONVERSATION_LABEL = 'Follow the conversation'

/** What the trigger reads: the level the request will carry, and whether it is inherited. */
export function resolveReasoningPick({ reasoningEfforts, value, inheritedEffort }: ReasoningPick) {
  const options = modelReasoningOptions(reasoningEfforts)
  const inherits = value === undefined && inheritedEffort !== undefined
  const resolved = clampModelReasoning(
    value ?? inheritedEffort ?? DEFAULT_REASONING_EFFORT,
    reasoningEfforts,
  )
  const labelOf = (effort: ReasoningEffort | undefined) =>
    options.find((option) => option.value === effort)?.label
  return {
    options,
    inherits,
    resolved,
    resolvedLabel: labelOf(resolved) ?? resolved ?? '',
    inheritedLabel: labelOf(clampModelReasoning(inheritedEffort, reasoningEfforts)),
  }
}

export function reasoningEntries(
  pick: ReasoningPick & { onChange: (effort: ReasoningEffort | undefined) => void },
): MenuEntry[] {
  const { options, inherits, resolved, inheritedLabel } = resolveReasoningPick(pick)
  const { inheritedEffort, onChange } = pick
  return [
    ...(inheritedEffort !== undefined
      ? [
          {
            id: 'follow-conversation',
            label: FOLLOW_CONVERSATION_LABEL,
            hint: inheritedLabel,
            selected: inherits,
            onSelect: () => onChange(undefined),
          },
          { separator: true } as const,
        ]
      : []),
    // While it follows, no level claims the check: the choice is "none of my own".
    ...options.map((option) => ({
      id: option.value,
      label: option.label,
      description: option.description,
      selected: !inherits && option.value === resolved,
      onSelect: () => onChange(option.value),
    })),
  ]
}
