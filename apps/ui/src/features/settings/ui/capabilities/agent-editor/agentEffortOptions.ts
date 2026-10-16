import { clampModelReasoning, modelReasoningOptions } from '@/features/chat/model/modelReasoning'
import { isReasoningEffort } from '@/features/chat/model/reasoning'

/**
 * The agent editor's effort choices: "Inherit" plus the levels the pinned model really offers —
 * Off only where the model honours it — through the same rule as the chat picker and `/model`.
 * A stored level the model no longer offers stays visible, saying what it runs as, so opening the
 * editor never silently rewrites the definition.
 */
export function agentEffortOptions(
  model: { reasoningEfforts?: readonly string[] } | undefined,
  effort: string,
): { value: string; label: string }[] {
  const offered = modelReasoningOptions(model?.reasoningEfforts).map((option) => ({
    value: option.value,
    label: option.label,
  }))
  const options = [{ value: '', label: 'Inherit effort' }, ...offered]
  if (!effort || !isReasoningEffort(effort) || offered.some((option) => option.value === effort))
    return options
  const runsAs = clampModelReasoning(effort, model?.reasoningEfforts)
  const label = offered.find((option) => option.value === runsAs)?.label ?? runsAs
  return [...options, { value: effort, label: `${effort} — runs as ${label}` }]
}
