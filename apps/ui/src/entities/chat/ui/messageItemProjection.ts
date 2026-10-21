import { isReasoningItem, type AgentItem } from '@localixai/agent/agents/items'
import { isTranscriptItemHidden } from '@localixai/api/item-format'

export type MessageDisplayItem =
  | { kind: 'item'; item: AgentItem; index: number }
  | { kind: 'reasoning'; key: string; text: string; lastIndex: number }

/**
 * Collapse only ADJACENT reasoning items into one display strip. Providers can
 * emit several reasoning parts for one uninterrupted thought; rendering each as
 * a separate disclosure adds DOM/measurement churn and visual noise. Tool/text/
 * plan items remain hard boundaries, and the original items stay untouched so
 * signatures, timing and persistence semantics are preserved.
 */
export function projectMessageItems(items: readonly AgentItem[]): MessageDisplayItem[] {
  const projected: MessageDisplayItem[] = []

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!
    if (isTranscriptItemHidden(item)) continue
    if (!isReasoningItem(item)) {
      projected.push({ kind: 'item', item, index })
      continue
    }

    const first = item
    const chunks: string[] = []
    let lastIndex = index
    while (lastIndex < items.length) {
      const candidate = items[lastIndex]!
      if (!isReasoningItem(candidate)) break
      if (candidate.text.trim()) chunks.push(candidate.text)
      lastIndex += 1
    }
    lastIndex -= 1

    if (chunks.length > 0) {
      projected.push({
        kind: 'reasoning',
        key: first.id,
        text: chunks.join('\n\n'),
        lastIndex,
      })
    }
    index = lastIndex
  }

  return projected
}
