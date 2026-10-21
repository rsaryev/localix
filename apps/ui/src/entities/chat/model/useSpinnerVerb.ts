import type { AgentItem } from '@localixai/agent/agents'
import { itemActionVerb } from '../ui/tool-parts/itemHelpers'

/**
 * Verb for the single bottom activity line. Tool-specific when a tool item is
 * live; otherwise a plain "Working" — never "Thinking", which is the reasoning
 * strip's vocabulary.
 */
export function useSpinnerVerb(
  isGenerating: boolean,
  activeItem: AgentItem | undefined,
): string | undefined {
  if (activeItem) return itemActionVerb(activeItem)
  if (isGenerating) return 'Working'
  return undefined
}
